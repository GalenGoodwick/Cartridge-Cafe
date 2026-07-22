import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveHolder, mintBuildToken, revalidate, hist, LEASE_MS } from '@/lib/builds'
import { mintSceneToken } from '@/app/api/engine/scene-token'
import { commonsPost } from '@/lib/commons-bus'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** POST /api/builds/:id/claim — atomically take a pending job.
 *  Returns 409 if someone else grabbed it (the thing the soft `builder_at`
 *  stamp can't do with many pollers). On success: lease + a per-world build
 *  token + the pre-build snapshot captured for rollback. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const holder = await resolveHolder(req)
  if (!holder) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const now = new Date()

  // Consent re-check at the moment of claim: a job enqueued while consent held
  // must not be claimable after it's withdrawn (or the brief finished elsewhere).
  // revalidate() cancels such jobs; the atomic guard below then 409s them.
  await revalidate(now)

  // Atomic guard: only a pending job this holder hasn't already dropped, and
  // (for volunteers) not house-escalated. count===0 → lost the race → 409.
  const guard = await prisma.buildJob.updateMany({
    where: {
      id,
      status: 'pending',
      // The house AI is the always-on fallback — it may RE-claim a job it once
      // dropped (all house instances share the "house" holder id, so excluding
      // by attemptedBy would lock the house out of that job forever). Volunteers
      // are still excluded from jobs they dropped + from house-escalated ones.
      ...(holder.isHouse ? {} : { escalatedHouse: false, NOT: { attemptedBy: { has: holder.id } } }),
    },
    data: {
      status: 'leased',
      leaseHolderId: holder.id,
      leaseExpires: new Date(now.getTime() + LEASE_MS),
      heartbeatAt: now,
      attempts: { increment: 1 },
    },
  })
  if (guard.count === 0) {
    const exists = await prisma.buildJob.findUnique({ where: { id }, select: { status: true } })
    return NextResponse.json(
      { error: exists ? 'already claimed' : 'not found' },
      { status: exists ? 409 : 404 },
    )
  }

  const job = await prisma.buildJob.findUnique({ where: { id } })
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Mint the target-scoped build token: a branch job gets a stateless scene
  // token (uc_sc_), a world job gets a uc_st_ + captures a rollback snapshot.
  let token: string
  let preSnapshot: unknown = job.preSnapshot ?? undefined
  if (job.sceneName) {
    token = mintSceneToken(job.sceneName)
  } else if (job.spaceId) {
    const space = await prisma.playerSpace.findUnique({ where: { id: job.spaceId }, select: { snapshot: true } })
    token = await mintBuildToken(job.spaceId, holder.displayName)
    preSnapshot = job.preSnapshot ?? space?.snapshot ?? undefined
  } else {
    return NextResponse.json({ error: 'job has no target' }, { status: 500 })
  }
  await prisma.buildJob.update({
    where: { id },
    data: {
      preSnapshot: (preSnapshot ?? undefined) as never,
      history: hist(job.history, { at: now.toISOString(), by: holder.id, event: 'claimed' }),
    },
  })

  // COMMONS BUS — the build's start is public heartbeat: humans see motion,
  // watcher daemons see a lane go active.
  void commonsPost({ kind: 'build', who: holder.displayName || holder.id, slug: job.spaceSlug,
    text: `⚒ build claimed: "${job.spaceSlug}" — ${holder.isHouse ? 'the house AI' : holder.displayName} is on it` })

  return NextResponse.json({
    ok: true,
    job: { id: job.id, spaceSlug: job.spaceSlug, brief: job.brief, attempts: job.attempts, spaceId: job.spaceId ?? null },
    token, // uc_st_ scoped to THIS world only
    leaseMs: LEASE_MS,
  })
}
