import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type Kin = { slug: string; name: string; owner: string; at: number; isPublic: boolean }

/** GET /api/spaces/[slug]/lineage — the world's family tree (Galen, Sep 5:
 *  "a lineage tab onto the engine"). Ancestry = the forkOf chain walked up
 *  (root first); forks = direct children. Deliberately snapshot-free — this
 *  route never touches the jsonb blob (the detoast law); the EDITS side of
 *  the panel reads __provenance from the client's already-loaded worldData. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
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
  return NextResponse.json({
    self: toKin(space),
    ancestors,                                        // root → … → direct parent
    forks: space.forks.map(toKin),                    // direct children, oldest first
  })
}
