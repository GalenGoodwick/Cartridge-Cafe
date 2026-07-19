import { NextRequest, NextResponse } from 'next/server'
import { loadScene, hydrateAllScenes } from '../../store'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type Node = { name: string; by?: string | null; kind: 'root' | 'branch' | 'remix'; slug?: string }

/** GET /api/engine/lineage/trail?scene=<name>   or   ?space=<slug>
 *  Walk provenance from a world back to its origin, ROOT-first.
 *   · scene branches → follow worldData.branchedFrom (the immediate-parent stamp
 *     laid down at branch time); if a branch predates the stamp, fall back to its
 *     BASE root (the name before ' ⑂ ') so old branches still show an origin.
 *   · spaces (remixes) → walk forkOfId in the DB.
 *  Trail is [origin, …, this]; the last node is where you are. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const scene = searchParams.get('scene')?.trim()
  const space = searchParams.get('space')?.trim()

  if (space) {
    const trail: Node[] = []
    let slug: string | null = space
    const seen = new Set<string>()
    for (let i = 0; i < 24 && slug && !seen.has(slug); i++) {
      seen.add(slug)
      const s: { name: string; slug: string; forkOf: { slug: string } | null } | null =
        await prisma.playerSpace.findUnique({
          where: { slug },
          select: { name: true, slug: true, forkOf: { select: { slug: true } } },
        })
      if (!s) break
      trail.unshift({ name: s.name, slug: s.slug, kind: s.forkOf ? 'remix' : 'root' })
      slug = s.forkOf?.slug ?? null
    }
    if (trail.length) trail[0].kind = 'root'
    // downstream: the public remixes that grew FROM this world (the reverse side
    // the original never surfaced — branches show in the arena, remixes didn't)
    const self = await prisma.playerSpace.findUnique({ where: { slug: space }, select: { id: true } })
    const remixes = self
      ? (await prisma.playerSpace.findMany({
          where: { forkOfId: self.id, isPublic: true },
          select: { name: true, slug: true },
          orderBy: { updatedAt: 'desc' },
          take: 30,
        }))
      : []
    return NextResponse.json({ trail, remixes })
  }

  if (scene) {
    await hydrateAllScenes()
    const trail: Node[] = []
    let name: string | null = scene
    const seen = new Set<string>()
    for (let i = 0; i < 24 && name && !seen.has(name); i++) {
      seen.add(name)
      const sc = loadScene(name) as { worldData?: { branchedFrom?: unknown; branchedBy?: unknown } } | undefined
      const by = (typeof sc?.worldData?.branchedBy === 'string' ? sc.worldData.branchedBy : null) ?? handleFromName(name)
      trail.unshift({ name, by, kind: name.includes(' ⑂ ') ? 'branch' : 'root' })
      const parent = sc?.worldData?.branchedFrom
      if (typeof parent === 'string' && parent && parent !== name) { name = parent; continue }
      // no stamped parent: if this is still a branch, its origin is its BASE root
      if (name.includes(' ⑂ ')) {
        const root = name.split(' ⑂ ')[0]
        if (root && root !== name && !seen.has(root)) trail.unshift({ name: root, kind: 'root' })
      }
      break
    }
    if (trail.length) trail[0].kind = 'root'
    return NextResponse.json({ trail, remixes: [] })
  }

  return NextResponse.json({ error: 'scene or space required' }, { status: 400 })
}

/** pull the brancher handle out of a `BASE ⑂ handle · label · vN` scene name */
function handleFromName(name: string): string | null {
  const i = name.indexOf(' ⑂ ')
  if (i < 0) return null
  return name.slice(i + 3).split(' · ')[0] || null
}
