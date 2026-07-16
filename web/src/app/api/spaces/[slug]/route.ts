import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { invalidateSpaceCache, getSpaceSnapshot, setSpaceSnapshot } from '../../engine/space-store'
import { loadGameSlot, saveGameSlot } from '../../engine/store'
import { getLineage } from '../../engine/lineage'

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

  return NextResponse.json({ space })
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
    select: { id: true },
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
    const snap = ((await getSpaceSnapshot(space.id)) as unknown as Record<string, unknown> | null) || { fields: [] as unknown[] }
    const wd = (snap.worldData as Record<string, unknown>) || {}
    wd.creation_brief = { prompt: body.brief.trim(), by: user.id, at: Date.now() }
    delete wd.brief_done
    snap.worldData = wd
    await setSpaceSnapshot(space.id, snap as never)
  }

  const updated = await prisma.playerSpace.update({
    where: { id: space.id },
    data: update,
    select: { id: true, slug: true, name: true, description: true, isPublic: true },
  })

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
      id: true, ownerId: true, name: true,
      _count: { select: { childSpaces: true, flags: true } },
    },
  })

  if (!space || space.ownerId !== user.id) {
    return NextResponse.json({ error: 'Space not found' }, { status: 404 })
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
  } catch { /* hygiene is best-effort */ }

  return NextResponse.json({ ok: true })
}
