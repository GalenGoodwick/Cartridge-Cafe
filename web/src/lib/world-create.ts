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

/** May this account create ANOTHER world right now? Enforces the world cap.
 *  Create-only — never gate reads on this. (The guest 3-build quota died with
 *  the guest door: every creator is a signed-in account now.) */
export async function canCreateWorld(userId: string): Promise<CreateGate> {
  const owned = await prisma.playerSpace.count({ where: { ownerId: userId } })
  if (owned >= WORLD_CAP) {
    return { ok: false, status: 400, error: `world limit reached (${WORLD_CAP} per account) — delete one first` }
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

/** Guard against SILENT same-name twins. Repeated create with a name whose slug
 *  is already taken made createSpaceUniqueSlug mint a differently-suffixed copy
 *  carrying the IDENTICAL display name (the VEILFIRE-3D duplicates, Aug 2026 —
 *  five "VEILFIRE 3D" rows in /admin). Returns the owner's existing world of this
 *  name (case-insensitive) so the caller can point them at it — open it / use_world
 *  it — instead of quietly duplicating. Scoped to the SAME owner: two different
 *  people may share a name, and that legitimately gets a suffixed slug. */
export async function findOwnWorldByName(userId: string, name: string) {
  const n = (name || '').trim()
  if (!n) return null
  return prisma.playerSpace.findFirst({
    where: { ownerId: userId, name: { equals: n, mode: 'insensitive' } },
    select: { slug: true, name: true },
  })
}

/** BRANCH→FORK (the fork paradigm): land a scene snapshot as a PRIVATE owned
 *  playerSpace — the one way a remix of open ground becomes yours. Replaces the
 *  old fork-on-overwrite branch mint (`BASE ⑂ handle · v1`), which produced an
 *  ownerless scene that could never wear its maker's tag or reach the shelf.
 *  Stamps `__branchedFrom` (display lineage) and links `forkOfId` when the base
 *  is a real playerSpace. Caller must have passed canCreateWorld already. */
export async function forkSnapshotToSpace(opts: {
  userId: string
  baseName: string                       // the world it came from (display name / scene name)
  snapshot: Prisma.InputJsonValue        // the world content to land
  label?: string                         // optional fork name; defaults to "<base> (fork)"
}) {
  const { slugify } = await import('./slug')
  const name = (opts.label && opts.label.trim() ? opts.label.trim() : `${opts.baseName} (fork)`).slice(0, 60)
  const snap = JSON.parse(JSON.stringify(opts.snapshot)) as { worldData?: Record<string, unknown> }
  snap.worldData = { ...(snap.worldData || {}), __branchedFrom: opts.baseName }
  const baseSpace = await prisma.playerSpace.findUnique({
    where: { slug: slugify(opts.baseName) }, select: { id: true },
  }).catch(() => null)
  const space = await createSpaceUniqueSlug(slugify(name), (slug) => ({
    name,
    slug,
    ownerId: opts.userId,
    isPublic: false,                     // born private; publishing is the owner's explicit act
    forkOfId: baseSpace?.id ?? null,
    description: `Forked from ${opts.baseName}`,
    snapshot: snap as unknown as Prisma.InputJsonValue,
  }))
  // lineage rung: version 1 = what was forked (provenance, never load-bearing)
  await prisma.spaceVersion.create({
    data: { spaceId: space.id, version: 1, snapshot: snap as unknown as Prisma.InputJsonValue, authorId: opts.userId, note: `Forked from ${opts.baseName}` },
  }).catch(() => {})
  return space
}
