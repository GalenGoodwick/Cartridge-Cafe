// world-create — the ONE gate every "make a world" path goes through, so the
// limits can't drift apart per-route. Before this, three paths (/api/spaces
// POST, /api/spaces/:slug/fork, bridge create_world) each re-implemented the
// cap + guest quota, and a change to one silently missed the others (the cap
// was raised to 100 on the bridge but left at 10 on the human paths).
import { prisma } from './prisma'
import { Prisma } from '@prisma/client'
import crypto from 'crypto'

export type CreateGate = { ok: true } | { ok: false; status: number; error: string }

/** May this account create ANOTHER world right now? YES — the dockstar quota
 *  system was REMOVED (Galen, Aug 26: "remove dockstar code and limit. just
 *  easy $10 to build on open building worlds"). Creating your own worlds is
 *  ungated; the $10 membership gates joining OTHERS' open build flows (the
 *  dock). The signature stays so the seven create paths that call this keep
 *  one choke-point if a gate ever returns (e.g. an anti-abuse cap). */
export async function canCreateWorld(_userId: string): Promise<CreateGate> {
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
/** THE ONE BIRTH PIPELINE (Galen's law, Aug 26: "pipelines must be universal
 *  across functionalities — too many times I have seen multiple hand-rolled
 *  routes"). EVERY world birth goes through here: unique slug, BORN WITH ITS
 *  SLOTS, and the first build key. Callers state their intent (isPublic,
 *  extra worldData); they never re-implement birth. The generate route's
 *  hand-rolled copy had drifted to born-PUBLIC "so the buyer can watch the
 *  house AI" — a house AI that does not exist; the platform law is born
 *  PRIVATE unless the caller explicitly says otherwise. */
export async function birthWorld(opts: {
  ownerId: string
  name: string
  baseSlug: string
  description?: string | null
  isPublic?: boolean                      // default FALSE — worlds are born private
  worldData?: Record<string, unknown>     // e.g. creation_brief — the first thing a connecting AI reads
  worldParams?: Record<string, unknown>   // grid shape at birth (gridW/gridH/gridSize) — merged under any snapshot's own params
  snapshot?: Prisma.InputJsonValue        // full snapshot override (brew-with-cartridge / generate-flow BASE); wins over worldData
  forkOfId?: string                       // generate-flow BASE: lineage back to the picked world
}): Promise<{ space: { id: string; slug: string; name: string; description: string | null; isPublic: boolean; createdAt: Date }; token: string }> {
  let snapshot = opts.snapshot
    ?? (opts.worldData && Object.keys(opts.worldData).length
      ? ({ fields: [], worldData: opts.worldData } as Prisma.InputJsonValue)
      : undefined)
  // birth-time grid shape (a mobile world is born PORTRAIT, not squeezed into
  // the default square) — the snapshot's own params win if it declares any
  if (opts.worldParams && Object.keys(opts.worldParams).length) {
    const snap = ((snapshot && typeof snapshot === 'object') ? snapshot : { fields: [] }) as Record<string, unknown>
    const existing = (snap.worldParams as Record<string, unknown> | undefined) ?? {}
    snapshot = { ...snap, worldParams: { ...opts.worldParams, ...existing } } as Prisma.InputJsonValue
  }
  const space = await createSpaceUniqueSlug(opts.baseSlug, (slug) => ({
    name: opts.name,
    slug,
    description: opts.description ?? null,
    ownerId: opts.ownerId,
    isPublic: opts.isPublic === true,
    ...(snapshot !== undefined ? { snapshot } : {}),
    ...(opts.forkOfId ? { forkOfId: opts.forkOfId } : {}),
  }))
  // BORN WITH ITS SLOTS: seed the blank placeholder nodes so the sandbox is
  // alive from frame one and the anatomy is named; a connecting AI builds
  // WITHIN the slots.
  {
    const { applyCommandToSnapshot } = await import('@/app/api/engine/space-store')
    const { placeholderSeedCommands, baseBackdropSeedCommands } = await import('@/app/engine/placeholder-nodes')
    for (const seed of placeholderSeedCommands(Date.now())) {
      await applyCommandToSnapshot(space.id, seed).catch(() => {})
    }
    // BORN IN CONTEXT (Galen, Aug 30): a skinned backdrop sized to the rect, so
    // the world fills the viewport from frame one — no grey square, one less
    // thing for the builder to make. Reads the world's actual params (the
    // snapshot's own rect wins over birthParams, so a base-seeded world fits its
    // seed's grid).
    const bornParams = ((snapshot && typeof snapshot === 'object')
      ? ((snapshot as Record<string, unknown>).worldParams as Record<string, unknown> | undefined)
      : undefined) ?? opts.worldParams
    for (const seed of baseBackdropSeedCommands(bornParams)) {
      await applyCommandToSnapshot(space.id, seed).catch(() => {})
    }
  }
  // connect-AI-first: the world is born with its first build key
  const token = `uc_st_${crypto.randomBytes(16).toString('hex')}`
  await prisma.spaceToken.create({
    data: {
      name: 'first build key',
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      tokenPrefix: token.slice(0, 12) + '...',
      spaceId: space.id,
    },
  })
  return { space, token }
}

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
  policy?: { build: string; play: string }   // the fork's social contract (set once here, immutable after)
}) {
  const { slugify } = await import('./slug')
  const name = (opts.label && opts.label.trim() ? opts.label.trim() : `${opts.baseName} (fork)`).slice(0, 60)
  const snap = JSON.parse(JSON.stringify(opts.snapshot)) as { worldData?: Record<string, unknown> }
  snap.worldData = { ...(snap.worldData || {}), __branchedFrom: opts.baseName }
  delete snap.worldData.policy                     // never inherit the source's contract
  delete snap.worldData.__base                     // a fork is never a base by heritage
  if (opts.policy) snap.worldData.policy = opts.policy
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

/** THE GENERATE-FLOW EXTRAS, parsed ONCE for every birth route (universal
 *  pipeline: /api/spaces and /api/generate must never drift). Reads the three
 *  creation answers from a request body — DIMENSIONS (targets → worldData.fit),
 *  PEOPLE (access; open ⇒ build:'anyone'), BASE (fork a forkable world's live
 *  snapshot, lineage via forkOfId) — and returns what birthWorld needs.
 *  Throws { status, error } on a bad base. */
export async function resolveBirthExtras(userId: string, body: Record<string, unknown>): Promise<{
  birthData: Record<string, unknown>
  birthParams: Record<string, unknown>
  baseSnapshot?: Prisma.InputJsonValue
  forkOfId?: string
}> {
  const targets = body.targets === 'desktop' || body.targets === 'mobile' ? body.targets : undefined  // universal = undeclared
  const access = body.access === 'invite' || body.access === 'open' ? body.access : undefined         // solo = undeclared
  const birthData: Record<string, unknown> = {
    ...(targets ? { fit: targets } : {}),
    ...(access ? { access } : {}),
    ...(access === 'open' ? { build: 'anyone' } : {}),   // open world = live editing for members
  }
  // MOBILE = PORTRAIT AT BIRTH (Galen, Aug 29: "mobile was selected but the
  // viewport was not auto-sized"): fit:'mobile' frames the PAGE, but a square
  // 512 grid letterboxes again inside the phone frame. A mobile world is born
  // with a portrait playable rect (base-mobile's proven 576×1024) so its canvas
  // FILLS the frame from the first field.
  // gridSize MUST hold the portrait rect (Galen, Aug 30: "not in alignment —
  // fix it at the base"). Without it gridSize defaults to 512, so a 1024-tall
  // rect never fits the render space and the camera frames the wrong point.
  // gridSize = the rect's long axis makes the space contain the rect; the camera
  // then centers on the rect (see FieldEngine restingCenter) and coverZoomFloor
  // fills the phone. This is why a mobile world was misaligned from birth.
  const birthParams: Record<string, unknown> = targets === 'mobile' ? { gridSize: 1024, gridW: 576, gridH: 1024, deviceConfig: 'mobile' } : {}
  const baseWorld = typeof body.base === 'string' && body.base.trim() ? body.base.trim() : null
  if (!baseWorld) return { birthData, birthParams }
  const src = await prisma.playerSpace.findUnique({
    where: { slug: baseWorld }, select: { id: true, ownerId: true, isPublic: true, snapshot: true },
  })
  if (!src) throw { status: 404, error: `base world "${baseWorld}" not found` }
  const wd = ((src.snapshot as { worldData?: Record<string, unknown> } | null)?.worldData) ?? {}
  // your own world, or a public world marked as a BASE/forkable (the formats)
  const mayFork = src.ownerId === userId || (src.isPublic && (wd['forkable'] === true || wd['__base'] === true))
  if (!mayFork) throw { status: 403, error: `"${baseWorld}" is not forkable — its maker has not enabled forking` }
  // SEED HYGIENE (the fork rules): a newborn must NEVER inherit base-hood or
  // build rights from its seed — deep-clone and strip __base/forkable/policy,
  // THEN lay the newborn's own declared facets on top.
  const snap = JSON.parse(JSON.stringify(
    (src.snapshot && typeof src.snapshot === 'object') ? src.snapshot : { fields: [] },
  )) as Record<string, unknown>
  const seedWd = { ...(snap.worldData as Record<string, unknown> ?? {}) }
  delete seedWd.__base; delete seedWd.forkable; delete seedWd.policy
  delete seedWd.access; delete seedWd.build; delete seedWd.fit   // seed's own facets never leak either
  // portrait grid lays over the seed too — unless the seed declares its own rect
  const seedParams = (snap.worldParams as Record<string, unknown> | undefined) ?? {}
  const mergedParams = { ...birthParams, ...seedParams }
  return {
    birthData,
    birthParams,
    baseSnapshot: { ...snap, worldData: { ...seedWd, ...birthData }, ...(Object.keys(mergedParams).length ? { worldParams: mergedParams } : {}) } as Prisma.InputJsonValue,
    forkOfId: src.id,
  }
}
