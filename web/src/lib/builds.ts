import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import type { NextRequest } from 'next/server'
import { ensureBuilderTables } from '@/lib/builder-tables'

// ── Builder swarm coordination (DESIGN-builder-swarm.md) ────────────────────
// Shared helpers for the BuildJob queue: who's asking (holder auth), enqueue
// from creation briefs (reconcile), and the interrupt/escalation sweeper.

export const LEASE_MS = 90_000 // a claim dies this long after the last heartbeat
export const HOUSE_ESCALATE_ATTEMPTS = 3 // N: volunteer fails → hand to house AI
export const REVIEW_ATTEMPTS = 5 // K: total fails → poison brief → human review
export const HOUSE = 'house' // opaque holder id for the studio daemon (admin token)

export type Holder = { id: string; isHouse: boolean; displayName: string }

/** Resolve the caller from its Bearer token: the admin engine token is the
 *  house AI; a `uc_bt_` token is a volunteer Builder. Null = not a builder. */
export async function resolveHolder(req: NextRequest): Promise<Holder | null> {
  await ensureBuilderTables()   // self-create Builder/BuildJob on prod (no migration)
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.slice(7)

  const admin = process.env.ENGINE_AGENT_TOKEN
  if (admin && token === admin) return { id: HOUSE, isHouse: true, displayName: 'cafe house AI' }

  if (token.startsWith('uc_bt_')) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const b = await prisma.builder.findUnique({ where: { tokenHash } })
    if (b && !b.revokedAt && b.enabled) {
      await prisma.builder.update({ where: { id: b.id }, data: { lastSeenAt: new Date() } })
      return { id: b.id, isHouse: false, displayName: b.displayName }
    }
  }
  return null
}

/** Mint a per-world `uc_st_` build token scoped to one space (mirrors
 *  api/spaces/[slug]/token). Returned once; only the hash is stored. */
export async function mintBuildToken(spaceId: string, holderName: string): Promise<string> {
  const raw = `uc_st_${crypto.randomBytes(16).toString('hex')}`
  await prisma.spaceToken.create({
    data: {
      name: `build:${holderName}`.slice(0, 60),
      tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
      tokenPrefix: raw.slice(0, 12) + '...',
      spaceId,
    },
  })
  return raw
}

type HistEntry = { at: string; by: string; event: string; note?: string }
export function hist(prev: unknown, e: HistEntry): HistEntry[] {
  const arr = Array.isArray(prev) ? (prev as HistEntry[]) : []
  return [...arr, e].slice(-50) // bounded audit trail
}

/** Enqueue a pending BuildJob for every world with an unfinished creation
 *  brief that has no live job. Idempotent — safe to call on every poll. */
export async function reconcile(now: Date): Promise<number> {
  await ensureBuilderTables()
  const spaces = await prisma.playerSpace.findMany({
    select: { id: true, slug: true, name: true, snapshot: true },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  })
  let made = 0
  for (const s of spaces) {
    const wd = (s.snapshot as { worldData?: { creation_brief?: { prompt?: string }; brief_done?: unknown } } | null)?.worldData
    const brief = wd?.creation_brief?.prompt
    if (!brief || wd?.brief_done) continue
    // Dedup on (space, brief text) including `done` — so a finished build whose
    // brief_done didn't persist can't spawn a rebuild loop, while a genuinely
    // new/edited brief (different text) still enqueues fresh.
    const seen = await prisma.buildJob.findFirst({
      where: { spaceId: s.id, brief, status: { in: ['pending', 'leased', 'building', 'needs_review', 'done'] } },
      select: { id: true },
    })
    if (seen) continue
    await prisma.buildJob.create({
      data: {
        spaceId: s.id,
        spaceSlug: s.slug,
        brief,
        history: [{ at: now.toISOString(), by: 'system', event: 'enqueued' }],
      },
    })
    made++
  }
  return made
}

/** Requeue jobs whose lease expired (crashed/abandoned builder), applying the
 *  escalation ladder: pool → house AI (N) → needs_review (K). */
export async function sweep(now: Date): Promise<number> {
  await ensureBuilderTables()
  const dead = await prisma.buildJob.findMany({
    where: { status: { in: ['leased', 'building'] }, leaseExpires: { lt: now } },
  })
  for (const j of dead) {
    const attemptedBy = j.leaseHolderId && !j.attemptedBy.includes(j.leaseHolderId)
      ? [...j.attemptedBy, j.leaseHolderId]
      : j.attemptedBy
    // stat the dropped holder (volunteers only)
    if (j.leaseHolderId && j.leaseHolderId !== HOUSE) {
      await prisma.builder.updateMany({ where: { id: j.leaseHolderId }, data: { abandons: { increment: 1 } } }).catch(() => {})
    }
    const status = j.attempts >= REVIEW_ATTEMPTS ? 'needs_review' : 'pending'
    await prisma.buildJob.update({
      where: { id: j.id },
      data: {
        status,
        leaseHolderId: null,
        leaseExpires: null,
        heartbeatAt: null,
        attemptedBy,
        escalatedHouse: j.attempts >= HOUSE_ESCALATE_ATTEMPTS,
        history: hist(j.history, {
          at: now.toISOString(),
          by: j.leaseHolderId ?? 'unknown',
          event: status === 'needs_review' ? 'poison-review' : 'lease-expired-requeue',
          note: `attempt ${j.attempts}`,
        }),
      },
    })
  }
  return dead.length
}
