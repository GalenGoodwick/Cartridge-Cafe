import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { policyOf } from '@/lib/world-policy'
import { worldIsForkable } from '@/lib/fork-policy'
import { hasIpShield } from '@/lib/stripe'
import { invalidateSpaceCache, getSpaceSnapshot, setSpaceSnapshot } from '../../engine/space-store'
import { loadGameSlot, saveGameSlot, listScenes, deleteScene, hydrateAllScenes } from '../../engine/store'
import { getLineage } from '../../engine/lineage'
import { enqueueBake } from '@/lib/icon-bake-queue'
import { warmSpaceOgCard } from '@/lib/og-card'
import { logVisit } from '@/lib/visits'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

export const dynamic = 'force-dynamic'

/** GET /api/spaces/:slug — Get space details (public for visitors) */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const space = await prisma.playerSpace.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      isPublic: true,
      ownerId: true,
      createdAt: true,
      updatedAt: true,
      owner: { select: { id: true, name: true, image: true } },
      parentSpaceId: true,
      parentSpace: { select: { slug: true, name: true } },
      childSpaces: {
        select: { id: true, slug: true, name: true, isPublic: true },
        orderBy: { createdAt: 'asc' as const },
      },
    },
  })

  if (!space) {
    return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  }

  // Check visibility for non-owners
  const session = await getServerSession(authOptions)
  const user = session?.user?.email
    ? await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
    : null

  if (!space.isPublic && user?.id !== space.ownerId) {
    return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  }

  // deviceConfig (fit law) + the FORK FACTS. Read them from the CACHED snapshot
  // (getSpaceSnapshot: 30s per-lambda, kept warm by the editor's own writes),
  // NOT via `snapshot->...` subpath SQL. That "cheap jsonb read" was a trap: to
  // extract ANY subpath Postgres must DETOAST the entire ~300KB world blob, so
  // every metadata read paid the full cost of the world — measured at up to 3.9s
  // for a 595-byte response while a heavy world was being live-edited (the writes
  // churn the TOASTed value). These fields change ~never during play, so 30s of
  // cache staleness is harmless, and the detoast now happens once per 30s per
  // lambda instead of once per request.
  let deviceConfig: string | null = null
  let forkable = true
  let rReset = false
  let gridSize: number | null = null
  try {
    const snap = await getSpaceSnapshot(space.id)
    const wp = (snap?.worldParams ?? {}) as Record<string, unknown>
    const wd = (snap?.worldData ?? {}) as Record<string, unknown>
    const d = wp['deviceConfig']
    deviceConfig = d === 'mobile' ? 'mobile' : d === 'desktop' ? 'desktop' : null
    // THE GRID SIZE (Galen, Aug 30: mobile "out of frame"): the engine reads its
    // gridSize from a prop; without threading the world's declared gridSize the
    // grid mounts every space at the 512 default, clipping a 1024-tall portrait
    // world to its top half. Carry it (and the rect) so the mount frames right.
    const gsNum = wp['gridSize'] != null ? Number(wp['gridSize']) : null
    const gwNum = wp['gridW'] != null ? Number(wp['gridW']) : null
    const ghNum = wp['gridH'] != null ? Number(wp['gridH']) : null
    gridSize = Number.isFinite(gsNum) && gsNum ? gsNum : (Number.isFinite(gwNum) && Number.isFinite(ghNum) ? Math.max(gwNum as number, ghNum as number) : null)
    rReset = wd['rResetKey'] === true   // ⟲ RESET button gate — the grid reads this in play mode (eye cfg is engine-only)
    // canFork reads the AUTHORITATIVE worldData directly (the cached snapshot IS
    // the real object now — no need to rebuild a minimal copy from string extracts)
    forkable = worldIsForkable(wd, await hasIpShield(space.ownerId))
  } catch { /* absent = desktop default, forkable stays true (the default) */ }

  return NextResponse.json({ space: { ...space, deviceConfig, forkable, rReset, gridSize } })
}

/** PATCH /api/spaces/:slug — Update space metadata (owner only) */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true },
  })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const space = await prisma.playerSpace.findUnique({
    where: { slug },
    select: { id: true, ownerId: true, isPublic: true },
  })

  if (!space || space.ownerId !== user.id) {
    return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  }

  const body = await req.json()
  const update: Record<string, unknown> = {}

  if (body.name?.trim()) update.name = body.name.trim().slice(0, 60)          // caps (audit): multi-MB strings rode into every card payload
  if (body.description !== undefined) update.description = body.description?.trim().slice(0, 4000) || null
  if (typeof body.isPublic === 'boolean') update.isPublic = body.isPublic

  // wizard: once the world is truly named, trade the placeholder slug for a real one
  if (body.slugFromName && body.name?.trim()) {
    const want = body.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
    if (want) {
      const taken = await prisma.playerSpace.findUnique({ where: { slug: want } })
      if (!taken || taken.id === space.id) update.slug = want
    }
  }

  // the brief lives INSIDE the world: first thing a connected AI reads. Write it
  // THROUGH the space-store (cache + persist), not straight to prisma — a direct
  // snapshot write here races the store's cached persist and gets clobbered (an
  // AI that connects and announces `built_by` would erase the brief). Going
  // through the store keeps the bridge, the cache, and the DB one source of truth.
  if (typeof body.brief === 'string' && body.brief.trim()) {
    const snap = ((await getSpaceSnapshot(space.id, true)) as unknown as Record<string, unknown> | null) || { fields: [] as unknown[] }
    const wd = (snap.worldData as Record<string, unknown>) || {}
    wd.creation_brief = { prompt: body.brief.trim(), by: user.id, at: Date.now() }
    delete wd.brief_done
    // the cafe no longer plugs a house/borrowed AI in to build FOR players — every
    // world is built by an AI the player brings (their own connect). So the brief
    // is never marked for house scavenge; the reconcile gate (needs __house_requested)
    // stays dark. (The swarm/build framework itself remains, for dynamic agents.)
    delete wd.__house_requested
    snap.worldData = wd
    await setSpaceSnapshot(space.id, snap as never)
  }

  const updated = await prisma.playerSpace.update({
    where: { id: space.id },
    data: update,
    select: { id: true, slug: true, name: true, description: true, isPublic: true },
  })

  // WRITE-TIME BAKE: a world going public is "ready for the shelf" — warm its icon
  // now so the first visitor LOADS a photo, not a placeholder. Fire-and-forget and
  // hash-gated (skips if already fresh), so it never blocks this response and never
  // re-bakes needlessly. Ongoing edits/drift are caught by the read-time staleness
  // check + the heal sweep; this just covers the publish moment promptly.
  if (update.isPublic === true) {
    // FUNNEL: the PUBLISH stage — count only the real false→true transition, not
    // an idempotent re-save of an already-public world. Trusted (server-side),
    // so it lands as kind='publish' which the client can't forge.
    if (space.isPublic === false) {
      void logVisit({
        kind: 'publish',
        path: '/space/' + updated.slug,
        ua: req.headers.get('user-agent'),
        ip: req.headers.get('x-forwarded-for')?.split(',')[0] || null,
        who: ADMIN_EMAILS.includes(session.user.email.toLowerCase()) ? 'owner' : 'account',
      })
    }
    getSpaceSnapshot(space.id, true)
      .then(snap => {
        if (!snap) return
        enqueueBake(updated.slug, snap as never)
        // …and the OG share card, so even the FIRST share previews real pixels
        // (hash-gated + never-throws inside warmSpaceOgCard)
        void warmSpaceOgCard(updated.slug, snap, updated.name || updated.slug, user.name || 'someone')
      })
      .catch(() => {})
  }

  return NextResponse.json({ space: updated })
}

/** DELETE /api/spaces/:slug — Delete space (owner only) */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const space = await prisma.playerSpace.findUnique({
    where: { slug },
    select: {
      id: true, ownerId: true, name: true, isPublic: true, snapshot: true,
      _count: { select: { childSpaces: true, flags: true } },
    },
  })

  if (!space || space.ownerId !== user.id) {
    return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  }

  // CO-BUILT PROTECTION, STAKE-BASED (Galen, Sep 9: "delete if allowed" =
  // nobody else ever edited). The tracking is provenance we already keep:
  // member:<handle> tokens (every join door mints one) + version history rows
  // authored by non-owners. ANY world with real foreign edits refuses deletion;
  // an open world nobody else touched deletes fine.
  {
    const [memberTokens, foreignVersions] = await Promise.all([
      prisma.spaceToken.count({ where: { spaceId: space.id, revokedAt: null, name: { startsWith: 'member:' } } }),
      prisma.spaceVersion.count({ where: { spaceId: space.id, authorId: { not: user.id } } }),
    ])
    if (memberTokens > 0 || foreignVersions > 0) {
      return NextResponse.json({
        error: `Other builders have work in this world (${memberTokens} member key${memberTokens === 1 ? '' : 's'}, ${foreignVersions} foreign version${foreignVersions === 1 ? '' : 's'}). Co-built work is protected \u2014 close building and revoke member keys first, or keep it.`,
        coBuilt: true, blocked: true, memberTokens, foreignVersions,
      }, { status: 409 })
    }
  }

  // Fairness gates: a world stops being only yours once others invest in it.
  if (space._count.childSpaces > 0) {
    return NextResponse.json({
      error: `Cannot delete: ${space._count.childSpaces} branch${space._count.childSpaces > 1 ? 'es' : ''} grew from this world. Their roots live here.`,
      blocked: true,
    }, { status: 409 })
  }
  if (space._count.flags > 0) {
    return NextResponse.json({
      error: 'Cannot delete: this world has been flagged into a vote. The community holds a stake until it resolves.',
      blocked: true,
    }, { status: 409 })
  }
  // (the blanket OPEN-world refusal is retired — Sep 9: the stake gate above
  // refuses on ACTUAL foreign edits; an untouched open world is the owner's.)
  // (being live in a cell no longer blocks deletion — everything here is live
  //  state, so the cell HEALS instead: TournamentBar prunes non-roster worlds on
  //  its next beat — votes for the dead release, an emptied cell completes.)

  // the immortal original of a lineage can never be deleted
  try {
    const lin = await getLineage(space.name)
    if (lin && lin.original === 'space:' + slug) {
      return NextResponse.json({ error: 'This is the original of its lineage — it can never be deleted.', blocked: true }, { status: 409 })
    }
  } catch { /* lineage store unavailable — do not block on it */ }

  invalidateSpaceCache(space.id)

  // DELETE = CREDIT BACK, ALWAYS (Galen, Sep 9: "1 credit always returned").
  // If deletion is allowed (no foreign stake — checked above), the build
  // credit returns regardless of build state. Keeper creates free → no refund.
  let creditGranted = false
  {
    const { isAdminUserId } = await import('@/lib/adminAuth')
    if (!(await isAdminUserId(user.id))) {
      {
        const { refundGenCredit } = await import('@/lib/stripe')
        await refundGenCredit(user.id)
        creditGranted = true
      }
    }
  }

  await prisma.playerSpace.delete({ where: { id: space.id } })

  // LIVE-STATE HYGIENE — a deleted world leaves WITH its state. Its direct
  // slots die here; its seat in any bracket heals client-side (the prune law).
  // Best-effort: the deletion above already succeeded.
  try {
    const up = space.name.toUpperCase()
    await prisma.engineSlot.deleteMany({
      where: { slot: { in: [`tournament:space:${slug}`, `cell:${up}`, `world-chat:${up}`] } },
    })
    const uni = (await loadGameSlot('cafe:universe')) as { bubbles?: Record<string, unknown> } | undefined
    if (uni?.bubbles?.[up]) {
      delete uni.bubbles[up]
      await saveGameSlot('cafe:universe', uni)
    }
    // sweep the world's BRANCH scenes ("<NAME> ⑂ …" / "<slug> ⑂ …") — otherwise
    // they orphan in the scene store and haunt the shelf after the world is gone
    await hydrateAllScenes()
    for (const pre of [`${up} ⑂ `, `${slug.toLowerCase()} ⑂ `]) {
      for (const n of listScenes().filter(s => s.toLowerCase().startsWith(pre.toLowerCase()))) deleteScene(n)
    }
  } catch { /* hygiene is best-effort */ }

  return NextResponse.json({ ok: true, creditGranted })
}
