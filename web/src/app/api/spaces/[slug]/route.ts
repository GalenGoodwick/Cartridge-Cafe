import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { invalidateSpaceCache } from '../../engine/space-store'

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

  // the brief lives INSIDE the world: first thing a connected AI reads
  if (typeof body.brief === 'string' && body.brief.trim()) {
    const cur = await prisma.playerSpace.findUnique({ where: { id: space.id }, select: { snapshot: true } })
    const snap = (cur?.snapshot as Record<string, unknown>) || { fields: [] }
    const wd = (snap.worldData as Record<string, unknown>) || {}
    wd.creation_brief = { prompt: body.brief.trim(), by: user.id, at: Date.now() }
    delete wd.brief_done
    snap.worldData = wd
    update.snapshot = snap
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
  // live in a cell: the engine save store keeps cell:<NAME> slots
  try {
    const saveRes = await fetch(`${_req.nextUrl.origin}/api/engine/save?action=list`)
    const saves = await saveRes.json()
    const key = 'cell:' + space.name.toUpperCase()
    if ((saves.slots || []).some((sl: { slot: string }) => sl.slot.toUpperCase() === key)) {
      return NextResponse.json({
        error: 'Cannot delete: this world is live in a cell. Deleting a candidate mid-vote would be unfair.',
      }, { status: 409 })
    }
  } catch { /* save store unavailable — do not block on it */ }

  invalidateSpaceCache(space.id)

  await prisma.playerSpace.delete({ where: { id: space.id } })

  return NextResponse.json({ ok: true })
}
