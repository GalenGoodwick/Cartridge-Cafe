import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/** GET /api/spaces/:slug/children — List child spaces (owner only) */
export async function GET(
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

  const children = await prisma.playerSpace.findMany({
    where: { parentSpaceId: space.id },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      isPublic: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({ children })
}

/** POST /api/spaces/:slug/children — Create a child space */
export async function POST(
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

  const parentSpace = await prisma.playerSpace.findUnique({
    where: { slug },
    select: { id: true, ownerId: true },
  })

  if (!parentSpace || parentSpace.ownerId !== user.id) {
    return NextResponse.json({ error: 'Parent space not found' }, { status: 404 })
  }

  const body = await req.json()
  const { name, slug: rawSlug, description } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const childSlug = (rawSlug?.trim() || name.trim())
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)

  if (!childSlug) {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
  }

  // Check slug uniqueness globally
  const existing = await prisma.playerSpace.findUnique({ where: { slug: childSlug } })
  if (existing) {
    return NextResponse.json({ error: 'Slug already taken' }, { status: 409 })
  }

  // Limit to 10 spaces total per user
  const count = await prisma.playerSpace.count({ where: { ownerId: user.id } })
  if (count >= 10) {
    return NextResponse.json({ error: 'Maximum 10 spaces per account' }, { status: 400 })
  }

  const child = await prisma.playerSpace.create({
    data: {
      name: name.trim(),
      slug: childSlug,
      description: description?.trim() || null,
      ownerId: user.id,
      parentSpaceId: parentSpace.id,
    },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      isPublic: true,
      parentSpaceId: true,
      createdAt: true,
    },
  })

  return NextResponse.json({ space: child }, { status: 201 })
}
