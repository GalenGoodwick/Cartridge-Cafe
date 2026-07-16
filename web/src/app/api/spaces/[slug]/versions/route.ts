import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** GET /api/spaces/:slug/versions — List a space's save-point history (metadata only) */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const space = await prisma.playerSpace.findUnique({
    where: { slug },
    select: { id: true, ownerId: true, isPublic: true },
  })
  if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 })

  if (!space.isPublic) {
    const session = await getServerSession(authOptions)
    const user = session?.user?.email
      ? await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
      : null
    if (user?.id !== space.ownerId) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 })
    }
  }

  const versions = await prisma.spaceVersion.findMany({
    where: { spaceId: space.id },
    select: {
      id: true,
      version: true,
      note: true,
      createdAt: true,
      author: { select: { id: true, name: true } },
    },
    orderBy: { version: 'desc' },
    take: 100,
  })

  return NextResponse.json({ versions })
}

/** POST /api/spaces/:slug/versions — Save the space's current snapshot as a new version (owner only) */
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

  const space = await prisma.playerSpace.findUnique({
    where: { slug },
    select: { id: true, ownerId: true, snapshot: true },
  })
  if (!space || space.ownerId !== user.id) {
    return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  }
  if (!space.snapshot) {
    return NextResponse.json({ error: 'Space has no snapshot to version yet' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : null

  const all = await prisma.spaceVersion.findMany({
    where: { spaceId: space.id },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, note: true, createdAt: true, snapshot: true },
  })

  // Dedupe: a save point byte-identical to ANY existing version is not a new
  // version — you get the matching rung back. (Player save points ARE versions —
  // but two identical ones are one, no matter how far apart they were saved.)
  const currentStr = JSON.stringify(space.snapshot)
  const match = all.find(v => JSON.stringify(v.snapshot) === currentStr)
  if (match) {
    const { snapshot: _omit, ...meta } = match
    return NextResponse.json({ version: meta, deduped: true })
  }

  const nextVersion = (all[0]?.version ?? 0) + 1

  const version = await prisma.spaceVersion.create({
    data: {
      spaceId: space.id,
      version: nextVersion,
      snapshot: space.snapshot as Prisma.InputJsonValue,
      authorId: user.id,
      note,
    },
    select: { id: true, version: true, note: true, createdAt: true },
  })

  return NextResponse.json({ version }, { status: 201 })
}
