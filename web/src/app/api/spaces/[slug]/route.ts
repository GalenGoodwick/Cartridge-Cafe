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
    select: { id: true, ownerId: true },
  })

  if (!space || space.ownerId !== user.id) {
    return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  }

  invalidateSpaceCache(space.id)

  await prisma.playerSpace.delete({ where: { id: space.id } })

  return NextResponse.json({ ok: true })
}
