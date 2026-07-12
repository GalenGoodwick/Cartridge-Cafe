import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/** GET /api/spaces — List authenticated user's spaces */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const spaces = await prisma.playerSpace.findMany({
    where: { ownerId: user.id },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      isPublic: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { tokens: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ spaces })
}

/** POST /api/spaces — Create a new space */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const body = await req.json()
  const { name, slug: rawSlug, description } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  // Generate slug from name if not provided
  const slug = (rawSlug?.trim() || name.trim())
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)

  if (!slug) {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
  }

  // Check slug uniqueness
  const existing = await prisma.playerSpace.findUnique({ where: { slug } })
  if (existing) {
    return NextResponse.json({ error: 'Slug already taken' }, { status: 409 })
  }

  // Limit to 10 spaces per user
  const count = await prisma.playerSpace.count({ where: { ownerId: user.id } })
  if (count >= 10) {
    return NextResponse.json({ error: 'Maximum 10 spaces per account' }, { status: 400 })
  }

  const space = await prisma.playerSpace.create({
    data: {
      name: name.trim(),
      slug,
      description: description?.trim() || null,
      ownerId: user.id,
    },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      isPublic: true,
      createdAt: true,
    },
  })

  return NextResponse.json({ space }, { status: 201 })
}
