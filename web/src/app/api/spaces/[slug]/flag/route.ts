import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** GET /api/spaces/:slug/flag — List this space's flags and their resolutions */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const space = await prisma.playerSpace.findUnique({
    where: { slug },
    select: { id: true },
  })
  if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 })

  const flags = await prisma.spaceFlag.findMany({
    where: { spaceId: space.id },
    select: {
      id: true,
      reason: true,
      status: true,
      candidateVersions: true,
      resolvedVersion: true,
      deliberationId: true,
      createdAt: true,
      resolvedAt: true,
      raisedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  return NextResponse.json({ flags })
}

/**
 * POST /api/spaces/:slug/flag — Call for a resolution.
 * Freezes the dispute into two versions and spawns a fastCell deliberation whose
 * ideas ARE the candidate versions, each carrying a live demo link. Cells look
 * at running worlds, then vote. Body: { reason, versionA?, versionB? }
 * Defaults: A = latest saved version, B = the one before it.
 */
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
    select: { id: true, name: true, ownerId: true, isPublic: true, snapshot: true },
  })
  if (!space || (!space.isPublic && space.ownerId !== user.id)) {
    return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  }

  // one open flag per space at a time — the tool is for resolution, not pile-ons
  const open = await prisma.spaceFlag.findFirst({
    where: { spaceId: space.id, status: 'OPEN' },
    select: { id: true, deliberationId: true },
  })
  if (open) {
    return NextResponse.json(
      { error: 'A resolution is already in progress for this space', flag: open },
      { status: 409 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const reason = typeof body.reason === 'string' && body.reason.trim()
    ? body.reason.trim().slice(0, 500)
    : null
  if (!reason) return NextResponse.json({ error: 'reason is required' }, { status: 400 })

  // resolve candidate versions — default: the two most recent save points.
  // If the live world is newer than the last save point, freeze it as a version first
  // so "what's there right now" is always one of the candidates.
  const latest = await prisma.spaceVersion.findFirst({
    where: { spaceId: space.id },
    orderBy: { version: 'desc' },
    select: { version: true, snapshot: true },
  })
  let latestVersion = latest?.version ?? 0
  if (space.snapshot && (!latest || JSON.stringify(latest.snapshot) !== JSON.stringify(space.snapshot))) {
    latestVersion += 1
    await prisma.spaceVersion.create({
      data: {
        spaceId: space.id,
        version: latestVersion,
        snapshot: space.snapshot as Prisma.InputJsonValue,
        authorId: user.id,
        note: 'Frozen at flag time',
      },
    })
  }

  const versionA: number = Number.isFinite(body.versionA) ? body.versionA : latestVersion
  const versionB: number = Number.isFinite(body.versionB) ? body.versionB : latestVersion - 1

  const candidates = await prisma.spaceVersion.findMany({
    where: { spaceId: space.id, version: { in: [versionA, versionB] } },
    select: { version: true, note: true },
  })
  if (candidates.length < 2) {
    return NextResponse.json(
      { error: 'Need at least two saved versions to dispute. Save a version first.' },
      { status: 400 }
    )
  }

  // v1: record the dispute — the vote/tournament module wires in here later
  const deliberationId: string | null = null

  const flag = await prisma.spaceFlag.create({
    data: {
      spaceId: space.id,
      raisedById: user.id,
      reason,
      deliberationId,
      candidateVersions: [versionA, versionB],
    },
    select: { id: true, deliberationId: true, candidateVersions: true, status: true },
  })

  return NextResponse.json({ flag, deliberationId }, { status: 201 })
}
