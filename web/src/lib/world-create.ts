// world-create — the ONE gate every "make a world" path goes through, so the
// limits can't drift apart per-route. Before this, three paths (/api/spaces
// POST, /api/spaces/:slug/fork, bridge create_world) each re-implemented the
// cap + guest quota, and a change to one silently missed the others (the cap
// was raised to 100 on the bridge but left at 10 on the human paths).
import { prisma } from './prisma'
import { Prisma } from '@prisma/client'
import crypto from 'crypto'

/** Runaway backstop, not a product limit (Galen raised 20→100, Jul 23 2026). */
export const WORLD_CAP = 100

export type CreateGate = { ok: true } | { ok: false; status: number; error: string }

/** May this account create ANOTHER world right now? Enforces the world cap and,
 *  for guests, the 3-build taste limit. Create-only — never gate reads on this. */
export async function canCreateWorld(
  userId: string,
  opts: { isGuest?: boolean; email?: string | null } = {},
): Promise<CreateGate> {
  const owned = await prisma.playerSpace.count({ where: { ownerId: userId } })
  if (owned >= WORLD_CAP) {
    return { ok: false, status: 400, error: `world limit reached (${WORLD_CAP} per account) — delete one first` }
  }
  if (opts.isGuest && opts.email) {
    const { guestBuildCount, GUEST_BUILDS } = await import('./guest-quota')
    const { hydrateAllScenes, listScenes } = await import('@/app/api/engine/store')
    await hydrateAllScenes()
    const have = await guestBuildCount(userId, opts.email, listScenes())
    if (have >= GUEST_BUILDS) {
      return { ok: false, status: 403, error: `${GUEST_BUILDS} builds per guest — sign in to keep building (everything you made comes with you).` }
    }
  }
  return { ok: true }
}

/** True for a Prisma unique-constraint violation (P2002). */
export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}

/** Retire a user's OWN abandoned draft worlds so they don't hoard slugs + the
 *  world cap forever. A draft brew creates a private row up front (so the AI key
 *  has something to hang on); if the wizard is abandoned it lingers with no real
 *  content. Conservative on purpose — deleting user data, so ALL must hold:
 *  the caller's own, PRIVATE, UNTOUCHED for a week (updatedAt, not just created —
 *  so anything opened/edited is spared even if old), no built content
 *  (fields/hooks/visuals), and no saved versions. A real private world, or one
 *  someone came back to, is never touched. Best-effort; opportunistic; never
 *  blocks the create it rides on. */
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export async function sweepAbandonedDrafts(userId: string): Promise<number> {
  const cutoff = new Date(Date.now() - DRAFT_TTL_MS)
  const stale = await prisma.playerSpace.findMany({
    where: { ownerId: userId, isPublic: false, updatedAt: { lt: cutoff } },
    select: { id: true, snapshot: true, _count: { select: { versions: true } } },
  })
  const dead: string[] = []
  for (const s of stale) {
    if (s._count.versions > 0) continue                 // it was saved at least once — real work
    const snap = s.snapshot as { fields?: unknown[]; stepHooks?: unknown[]; visualTypes?: unknown[] } | null
    const built = !!(snap && (snap.fields?.length || snap.stepHooks?.length || snap.visualTypes?.length))
    if (built) continue                                 // has real content — not an abandoned draft
    dead.push(s.id)
  }
  if (!dead.length) return 0
  await prisma.playerSpace.deleteMany({ where: { id: { in: dead }, ownerId: userId } })
  return dead.length
}

/** Create a PlayerSpace with a guaranteed-unique slug, RACE-SAFE. The old
 *  findUnique-then-create pattern is a TOCTOU: a concurrent create with the same
 *  derived slug slips between the check and the insert and throws the unique
 *  violation uncaught (→ 500). Here the DB's unique constraint is the arbiter —
 *  we just retry with a fresh suffix when it fires. `baseSlug` should already be
 *  slugified. `data(slug)` returns the create payload for a candidate slug.
 *  Returns the created row (whatever slug it landed on).
 */
export async function createSpaceUniqueSlug(
  baseSlug: string,
  data: (slug: string) => Prisma.PlayerSpaceUncheckedCreateInput,
) {
  const base = baseSlug || 'world'
  let slug = base
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await prisma.playerSpace.create({ data: data(slug) })
    } catch (e) {
      if (isUniqueViolation(e)) { slug = `${base}-${crypto.randomBytes(2).toString('hex')}`; continue }
      throw e
    }
  }
  throw new Error('could not mint a unique slug after 8 attempts')
}
