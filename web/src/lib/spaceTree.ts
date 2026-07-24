// spaceTree.ts — THE provenance walks (audit #12). PlayerSpace has TWO parent
// edges and this file owns traversal of both, with the caps in one place:
//   · parentSpaceId — the BRANCH tree (the world vote competes branches)
//   · forkOfId      — the REMIX chain (fork/remix provenance)
// Before this file the same walks were hand-written four times (children route,
// ancestry route, lineage/trail route, space-store.getSpaceFamily) with
// independent caps and selects — "what won / what's upstream" could answer
// differently per caller.
import { prisma } from '@/lib/prisma'

export const UP_CAP_BRANCH = 10   // ancestry + family root-walk guard
export const UP_CAP_REMIX = 24    // trail guard
export const FAMILY_CAP = 100     // family BFS guard

export interface TreeNode { id: string; slug: string; name: string }

/** Ancestor chain via parentSpaceId (BRANCH tree), root-first, excluding self. */
export async function walkUpBranches(startParentId: string | null): Promise<TreeNode[]> {
  const ancestors: TreeNode[] = []
  let cur = startParentId
  for (let depth = 0; cur && depth < UP_CAP_BRANCH; depth++) {
    const parent = await prisma.playerSpace.findUnique({
      where: { id: cur },
      select: { id: true, slug: true, name: true, parentSpaceId: true },
    })
    if (!parent) break
    ancestors.unshift({ id: parent.id, slug: parent.slug, name: parent.name })
    cur = parent.parentSpaceId
  }
  return ancestors
}

/** Remix chain via forkOfId, root-first, INCLUDING self (the trail shape). */
export async function walkUpRemixes(slug: string): Promise<Array<TreeNode & { kind: 'root' | 'remix' }>> {
  const trail: Array<TreeNode & { kind: 'root' | 'remix' }> = []
  let cur: string | null = slug
  const seen = new Set<string>()
  for (let i = 0; i < UP_CAP_REMIX && cur && !seen.has(cur); i++) {
    seen.add(cur)
    const s: { id: string; name: string; slug: string; forkOf: { slug: string } | null } | null =
      await prisma.playerSpace.findUnique({
        where: { slug: cur },
        select: { id: true, name: true, slug: true, forkOf: { select: { slug: true } } },
      })
    if (!s) break
    trail.unshift({ id: s.id, name: s.name, slug: s.slug, kind: s.forkOf ? 'remix' : 'root' })
    cur = s.forkOf?.slug ?? null
  }
  if (trail.length) trail[0].kind = 'root'
  return trail
}

/** Direct BRANCH children (the arena roster's source). */
export function directChildren(spaceId: string, opts: { publicOnly?: boolean } = {}) {
  return prisma.playerSpace.findMany({
    where: { parentSpaceId: spaceId, ...(opts.publicOnly ? { isPublic: true } : {}) },
    select: { id: true, slug: true, name: true, description: true, isPublic: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
}

/** Public REMIXES grown from a world (the trail's downstream side). */
export function publicRemixesOf(spaceId: string, take = 30) {
  return prisma.playerSpace.findMany({
    where: { forkOfId: spaceId, isPublic: true },
    select: { name: true, slug: true },
    orderBy: { updatedAt: 'desc' },
    take,
  })
}

export interface SpaceFamily {
  rootId: string
  rootSlug: string
  rootName: string
  members: { id: string; slug: string; name: string; ownerId: string; lastTokenUse: number | null }[]
}

/** The whole BRANCH family: up to the root, then BFS down over every
 *  descendant (moved verbatim from space-store.getSpaceFamily). */
export async function familyOf(spaceId: string): Promise<SpaceFamily | null> {
  const start = await prisma.playerSpace.findUnique({
    where: { id: spaceId },
    select: { id: true, slug: true, name: true, parentSpaceId: true, ownerId: true },
  })
  if (!start) return null

  const up = await walkUpBranches(start.parentSpaceId)
  const root = up[0] ?? start

  // breadth-first down from the root, gathering every descendant
  const members: SpaceFamily['members'] = []
  const seen = new Set<string>()
  let frontier: string[] = [root.id]
  while (frontier.length && members.length < FAMILY_CAP) {
    const rows = await prisma.playerSpace.findMany({
      where: { id: { in: frontier } },
      select: {
        id: true, slug: true, name: true, ownerId: true,
        tokens: { select: { lastUsedAt: true, revokedAt: true } },
      },
    })
    for (const r of rows) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      const lastTokenUse = r.tokens
        .filter(t => !t.revokedAt && t.lastUsedAt)
        .reduce((m, t) => Math.max(m, t.lastUsedAt!.getTime()), 0) || null
      members.push({ id: r.id, slug: r.slug, name: r.name, ownerId: r.ownerId, lastTokenUse })
    }
    const kids = await prisma.playerSpace.findMany({
      where: { parentSpaceId: { in: frontier } },
      select: { id: true },
    })
    frontier = kids.map(k => k.id).filter(id => !seen.has(id))
  }

  return { rootId: root.id, rootSlug: root.slug, rootName: root.name, members }
}
