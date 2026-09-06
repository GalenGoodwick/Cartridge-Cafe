import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type Kin = { slug: string; name: string; owner: string; at: number; isPublic: boolean }

/** GET /api/spaces/[slug]/lineage — the world's family tree (Galen, Sep 5:
 *  "a lineage tab onto the engine"). Ancestry = the forkOf chain walked up
 *  (root first); forks = direct children. Deliberately snapshot-free — this
 *  route never touches the jsonb blob (the detoast law); the EDITS side of
 *  the panel reads __provenance from the client's already-loaded worldData. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const clean = slug.trim().toLowerCase()
  const sel = {
    slug: true, name: true, createdAt: true, isPublic: true, forkOfId: true,
    owner: { select: { name: true, email: true } },
  } as const
  const toKin = (s: { slug: string; name: string; createdAt: Date; isPublic: boolean; owner: { name: string | null; email: string | null } | null }): Kin => ({
    slug: s.slug, name: s.name, at: s.createdAt.getTime(), isPublic: s.isPublic,
    owner: s.owner?.name || (s.owner?.email ? s.owner.email.split('@')[0] : '?'),
  })
  const space = await prisma.playerSpace.findUnique({
    where: { slug: clean },
    select: { ...sel, id: true, forks: { select: sel, orderBy: { createdAt: 'asc' } } },
  })
  if (!space) return NextResponse.json({ error: 'not found' }, { status: 404 })
  // PRIVATE WORLDS ARE INVISIBLE (audit F8) — same 404 the versions routes give:
  // existence, owner, fork tree and editor handles never leak to non-owners.
  if (!space.isPublic) {
    const { getServerSession } = await import('next-auth')
    const { authOptions } = await import('@/lib/auth')
    const session = await getServerSession(authOptions)
    const me = session?.user?.email
      ? await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
      : null
    const { isAdminUserId } = await import('@/lib/adminAuth')
    const ownerRow = await prisma.playerSpace.findUnique({ where: { slug: clean }, select: { ownerId: true } })
    if (!me || (ownerRow?.ownerId !== me.id && !(await isAdminUserId(me.id)))) {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
  }

  // walk the forkOf chain up — bounded, cycle-safe
  const ancestors: Kin[] = []
  const seen = new Set<string>([space.id])
  let upId = space.forkOfId
  for (let i = 0; upId && i < 12; i++) {
    if (seen.has(upId)) break
    seen.add(upId)
    const up = await prisma.playerSpace.findUnique({ where: { id: upId }, select: { ...sel, id: true } })
    if (!up) break
    ancestors.unshift(toKin(up))   // root ends up first
    upId = up.forkOfId
  }
  // ?editors=1 → aggregate route-stamped attribution server-side. This DOES
  // read the snapshot — through the 30s getSpaceSnapshot cache (detoast law),
  // never a raw jsonb subpath query.
  let editors: Array<{ who: string; created: number; edits: number; lastAt: number; things: string[] }> | undefined
  if (req.nextUrl.searchParams.get('editors') === '1') {
    try {
      const { getSpaceSnapshot } = await import('@/app/api/engine/space-store')
      const snap = await getSpaceSnapshot(space.id) as { worldData?: Record<string, unknown> } | null
      const wd = snap?.worldData ?? {}
      const prov = (wd.__provenance ?? {}) as Record<string, { by: string; at: number; lastBy: string; lastAt: number }>
      const hist = (wd.__nodeHist ?? {}) as Record<string, Array<{ at?: number; by?: string }>>
      const acc = new Map<string, { created: string[]; edits: number; lastAt: number }>()
      const bump = (who: string) => {
        const w = who || 'anon'
        let e = acc.get(w)
        if (!e) { e = { created: [], edits: 0, lastAt: 0 }; acc.set(w, e) }
        return e
      }
      for (const [key, pr] of Object.entries(prov)) {
        if (!pr || typeof pr !== 'object') continue
        const c = bump(pr.by); c.created.push(key); c.lastAt = Math.max(c.lastAt, pr.at || 0)
        const l = bump(pr.lastBy); l.lastAt = Math.max(l.lastAt, pr.lastAt || 0)
      }
      for (const chain of Object.values(hist)) {
        if (!Array.isArray(chain)) continue
        for (const rev of chain) {
          const e = bump(String(rev?.by ?? '') || 'anon')
          e.edits++; e.lastAt = Math.max(e.lastAt, Number(rev?.at) || 0)
        }
      }
      editors = [...acc.entries()]
        .map(([who, e]) => ({ who, created: e.created.length, edits: e.edits, lastAt: e.lastAt, things: e.created.slice(0, 6) }))
        .sort((a, b) => b.lastAt - a.lastAt)
    } catch { /* editors stay undefined — the tree still serves */ }
  }
  return NextResponse.json({
    self: toKin(space),
    ancestors,                                        // root → … → direct parent
    forks: space.forks.map(toKin),                    // direct children, oldest first
    ...(editors ? { editors } : {}),
  })
}
