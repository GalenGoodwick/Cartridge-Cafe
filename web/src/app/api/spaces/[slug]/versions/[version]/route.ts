import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { invalidateSpaceCache } from '../../../../engine/space-store'

export const dynamic = 'force-dynamic'

/** GET /api/spaces/:slug/versions/:version — Full snapshot of one version (for demo rendering) */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; version: string }> }
) {
  const { slug, version: versionStr } = await params
  const versionNum = parseInt(versionStr, 10)
  if (!Number.isFinite(versionNum)) {
    return NextResponse.json({ error: 'Invalid version' }, { status: 400 })
  }

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

  const version = await prisma.spaceVersion.findUnique({
    where: { spaceId_version: { spaceId: space.id, version: versionNum } },
    select: {
      id: true,
      version: true,
      note: true,
      snapshot: true,
      createdAt: true,
      author: { select: { id: true, name: true } },
    },
  })
  if (!version) return NextResponse.json({ error: 'Version not found' }, { status: 404 })

  return NextResponse.json({ version })
}

/** POST /api/spaces/:slug/versions/:version — { action: "apply" } restores this version as the live world (owner only) */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; version: string }> }
) {
  const { slug, version: versionStr } = await params
  const versionNum = parseInt(versionStr, 10)
  if (!Number.isFinite(versionNum)) {
    return NextResponse.json({ error: 'Invalid version' }, { status: 400 })
  }

  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  if (body.action !== 'apply') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  const space = await prisma.playerSpace.findUnique({
    where: { slug },
    select: { id: true, ownerId: true },
  })
  if (!space || space.ownerId !== user.id) {
    return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  }

  const version = await prisma.spaceVersion.findUnique({
    where: { spaceId_version: { spaceId: space.id, version: versionNum } },
    select: { snapshot: true },
  })
  if (!version) return NextResponse.json({ error: 'Version not found' }, { status: 404 })

  // Non-destructive restore: capture the CURRENT live state as a new save point
  // BEFORE applying the old one, so restoring can never lose progress — you can
  // always come back to where you were. (DESIGN-branch-promotion: save points.)
  const live = await prisma.playerSpace.findUnique({
    where: { id: space.id }, select: { snapshot: true },
  })
  let savedAs: number | null = null
  if (live?.snapshot) {
    const maxV = await prisma.spaceVersion.aggregate({
      where: { spaceId: space.id }, _max: { version: true },
    })
    savedAs = (maxV._max.version ?? 0) + 1
    await prisma.spaceVersion.create({
      data: {
        spaceId: space.id, version: savedAs, authorId: user.id,
        snapshot: live.snapshot as Prisma.InputJsonValue,
        note: `auto-saved before restoring v${versionNum}`,
      },
    })
  }

  await prisma.playerSpace.update({
    where: { id: space.id },
    data: { snapshot: version.snapshot as Prisma.InputJsonValue },
  })
  invalidateSpaceCache(space.id)

  return NextResponse.json({ ok: true, applied: versionNum, savedCurrentAs: savedAs })
}
