import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { policyOf } from '@/lib/world-policy'
import { worldIsForkable } from '@/lib/fork-policy'
import { hasIpControl } from '@/lib/stripe'
import { invalidateSpaceCache, getSpaceSnapshot, setSpaceSnapshot } from '../../engine/space-store'
import { loadGameSlot, saveGameSlot, listScenes, deleteScene, hydrateAllScenes } from '../../engine/store'
import { getLineage } from '../../engine/lineage'
import { enqueueBake } from '@/lib/icon-bake-queue'
import { warmSpaceOgCard } from '@/lib/og-card'

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

  // deviceConfig (fit law) + the FORK FACTS in one cheap jsonb read (no snapshot
  // download): device gate, and the worldData paths canFork needs so the client
  // learns the AUTHORITATIVE forkability (fork off by default — Galen, Aug 30).
  let deviceConfig: string | null = null
  let forkable = true
  try {
    const rows = await prisma.$queryRaw<Array<{
      d: string | null; premium_usd: string | null; build: string | null
      forkable: string | null; base: string | null; proprietary: string | null; closed: string | null
    }>>`
      SELECT snapshot->'worldParams'->>'deviceConfig'            AS d,
             snapshot->'worldData'->'premium'->>'usd'           AS premium_usd,
             snapshot->'worldData'->'policy'->>'build'          AS build,
             snapshot->'worldData'->>'forkable'                 AS forkable,
             snapshot->'worldData'->>'__base'                   AS base,
             snapshot->'worldData'->>'proprietary'              AS proprietary,
             snapshot->'worldData'->>'closed'                   AS closed
      FROM "PlayerSpace" WHERE id = ${space.id}`
    const r = rows[0]
    deviceConfig = r?.d === 'mobile' ? 'mobile' : r?.d === 'desktop' ? 'desktop' : null
    // rebuild a minimal worldData so the ONE truth (canFork) reads it, not a
    // second copy of the rule living here
    const wd: Record<string, unknown> = {
      premium: r?.premium_usd != null ? { usd: Number(r.premium_usd) } : undefined,
      policy: r?.build ? { build: r.build } : undefined,
      forkable: r?.forkable === 'true' ? true : r?.forkable === 'false' ? false : undefined,
      __base: r?.base === 'true',
      proprietary: r?.proprietary === 'true',
      closed: r?.closed === 'true',
    }
    forkable = worldIsForkable(wd, await hasIpControl(space.ownerId))
  } catch { /* absent = desktop default, forkable stays true (the default) */ }

  return NextResponse.json({ space: { ...space, deviceConfig, forkable } })
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
    select: { id: true, ownerId: true },
  })

  if (!space || space.ownerId !== user.id) {
    return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  }

  const body = await req.json()
  const update: Record<string, unknown> = {}

  if (body.name?.trim()) update.name = body.name.trim()
  if (body.description !== undefined) update.description = body.description?.trim() || null
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

  // DELETE PROTECTION for public open-building worlds (Galen, Aug 27): once a
  // public world invites anyone to build, other people's work lives in it --
  // it can't be one-click destroyed while co-builders hold a stake. The owner
  // can close building or unpublish first (both reversible), then delete.
  {
    const wd = ((space.snapshot as { worldData?: Record<string, unknown> } | null)?.worldData) ?? {}
    if (space.isPublic && policyOf(wd).build === 'anyone') {
      const [memberTokens, foreignVersions] = await Promise.all([
        prisma.spaceToken.count({ where: { spaceId: space.id, revokedAt: null, name: { startsWith: 'member:' } } }),
        prisma.spaceVersion.count({ where: { spaceId: space.id, authorId: { not: user.id } } }),
      ])
      if (memberTokens > 0 || foreignVersions > 0) {
        return NextResponse.json({
          error: 'Cannot delete: this is a public open-building world with co-builders\u2019 work in it. Close building or unpublish it first \u2014 then delete.',
        }, { status: 409 })
      }
    }
  }

  // Fairness gates: a world stops being only yours once others invest in it.
  if (space._count.childSpaces > 0) {
    return NextResponse.json({
      error: `Cannot delete: ${space._count.childSpaces} branch${space._count.childSpaces > 1 ? 'es' : ''} grew from this world. Their roots live here.`,
    }, { status: 409 })
  }
  if (space._count.flags > 0) {
    return NextResponse.json({
      error: 'Cannot delete: this world has been flagged into a vote. The community holds a stake until it resolves.',
    }, { status: 409 })
  }
  // CO-BUILT PROTECTION (Galen, Aug 27: "multiple edit worlds are protected").
  // An OPEN world invited members to build in it — their work lives here too,
  // so a single click can't erase it. Close the world (make it solo) first;
  // a deliberate second step, not a wall.
  const openRows = await prisma.$queryRaw<{ b: string | null; a: string | null }[]>`
    SELECT snapshot->'worldData'->>'build' AS b, snapshot->'worldData'->>'access' AS a
    FROM "PlayerSpace" WHERE id = ${space.id}`
  if (openRows[0]?.b === 'anyone' || openRows[0]?.a === 'open') {
    return NextResponse.json({
      error: 'Cannot delete: this is an OPEN world — members may have built here, and co-built work is protected. Close it (make it solo) first, then delete.',
      coBuilt: true,
    }, { status: 409 })
  }
  // (being live in a cell no longer blocks deletion — everything here is live
  //  state, so the cell HEALS instead: TournamentBar prunes non-roster worlds on
  //  its next beat — votes for the dead release, an emptied cell completes.)

  // the immortal original of a lineage can never be deleted
  try {
    const lin = await getLineage(space.name)
    if (lin && lin.original === 'space:' + slug) {
      return NextResponse.json({ error: 'This is the original of its lineage — it can never be deleted.' }, { status: 409 })
    }
  } catch { /* lineage store unavailable — do not block on it */ }

  invalidateSpaceCache(space.id)

  // CANCEL BUILD = CREDIT BACK (Galen, Aug 29: no $5 refunds — the credit
  // returns instead): deleting a PAID creation that never got built (has a
  // creation_brief, brief never done, no fields) puts ONE generation credit
  // back on the account. A world that was actually built earns no credit on
  // delete; the keeper creates free so gets none either.
  let creditGranted = false
  {
    const snap = space.snapshot as { fields?: unknown[]; worldData?: Record<string, unknown> } | null
    const wd = snap?.worldData ?? {}
    const unbuilt = !!wd['creation_brief'] && wd['brief_done'] !== true && !(Array.isArray(snap?.fields) && snap!.fields!.length > 0)
    if (unbuilt) {
      const { isAdminUserId } = await import('@/lib/adminAuth')
      if (!(await isAdminUserId(user.id))) {
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
