import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** POST /api/spaces/:slug/fork — Remix a world: copy its live snapshot into a new space you own */
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

  const source = await prisma.playerSpace.findUnique({
    where: { slug },
    select: { id: true, name: true, ownerId: true, isPublic: true, snapshot: true },
  })
  if (!source || (!source.isPublic && source.ownerId !== user.id)) {
    return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  }

  const count = await prisma.playerSpace.count({ where: { ownerId: user.id } })
  if (count >= 10) {
    return NextResponse.json({ error: 'Maximum 10 spaces per account' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const name = (typeof body.name === 'string' && body.name.trim())
    ? body.name.trim().slice(0, 60)
    : `${source.name} (remix)`

  // unique slug: base + short random suffix, a few attempts
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)
  let newSlug = base
  for (let i = 0; i < 5; i++) {
    const taken = await prisma.playerSpace.findUnique({ where: { slug: newSlug }, select: { id: true } })
    if (!taken) break
    newSlug = `${base}-${Math.random().toString(36).slice(2, 6)}`
  }

  const fork = await prisma.playerSpace.create({
    data: {
      name,
      slug: newSlug,
      ownerId: user.id,
      forkOfId: source.id,
      description: `Remix of ${source.name}`,
      ...(source.snapshot ? { snapshot: source.snapshot as Prisma.InputJsonValue } : {}),
    },
    select: { id: true, slug: true, name: true, createdAt: true },
  })

  // the remix starts with its lineage recorded: version 1 = what was copied
  if (source.snapshot) {
    await prisma.spaceVersion.create({
      data: {
        spaceId: fork.id,
        version: 1,
        snapshot: source.snapshot as Prisma.InputJsonValue,
        authorId: user.id,
        note: `Remixed from ${slug}`,
      },
    })
  }

  return NextResponse.json({ space: fork }, { status: 201 })
}
