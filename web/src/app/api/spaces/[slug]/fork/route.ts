import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { slugify } from '@/lib/companion'
import { canCreateWorld, createSpaceUniqueSlug } from '@/lib/world-create'
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

  // one gate for every create path — fork used to skip the guest quota, letting
  // a guest remix past their 3-build limit
  const gate = await canCreateWorld(user.id, { isGuest: session.user.isTemp, email: session.user.email })
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  // The copied snapshot must NOT inherit house-AI consent: __house_requested is
  // the source owner's explicit "have the house AI build it" — carried into a
  // remix it would auto-enroll the fork with the daemon (which then builds a
  // world nobody asked it to). Everything else (brief, brief_done) stays as
  // provenance; brief_done already blocks enrollment on finished worlds.
  if (source.snapshot && typeof source.snapshot === 'object') {
    const wd = (source.snapshot as { worldData?: Record<string, unknown> }).worldData
    if (wd && '__house_requested' in wd) delete wd.__house_requested
  }

  const body = await req.json().catch(() => ({}))
  const name = (typeof body.name === 'string' && body.name.trim())
    ? body.name.trim().slice(0, 60)
    : `${source.name} (remix)`

  // race-safe unique slug (the old findUnique-then-create raced on the final
  // insert). A fork of a PRIVATE world stays private — the default `true` used
  // to publish a copy of a world its owner kept hidden.
  const fork = await createSpaceUniqueSlug(slugify(name), (newSlug) => ({
    name,
    slug: newSlug,
    ownerId: user.id,
    forkOfId: source.id,
    isPublic: source.isPublic,
    description: `Remix of ${source.name}`,
    ...(source.snapshot ? { snapshot: source.snapshot as Prisma.InputJsonValue } : {}),
  }))

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

  // shape the response (the create returns the full row — don't leak snapshot)
  return NextResponse.json({ space: { id: fork.id, slug: fork.slug, name: fork.name, createdAt: fork.createdAt } }, { status: 201 })
}
