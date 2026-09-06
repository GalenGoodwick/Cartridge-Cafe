import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { findIdenticalVersion } from '@/lib/version-dedup'

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

  // BOUNDED (audit, Sep 5): dedup compares the last 25 rungs, not all history
  // — O(all versions × blob) per save grew forever (spam re-saves match the
  // newest rungs anyway; a byte-identical state 50 versions back is a rebuild,
  // which deserves its own rung)
  const all = await prisma.spaceVersion.findMany({
    where: { spaceId: space.id },
    orderBy: { version: 'desc' },
    take: 25,
    select: { id: true, version: true, note: true, createdAt: true, snapshot: true },
  })

  // Dedupe: a save point byte-identical to ANY existing version is not a new
  // version — you get the matching rung back (ONE law: lib/version-dedup).
  const match = findIdenticalVersion(all, space.snapshot)
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

  // Version hygiene (Galen): once a WORKING version exists, versions that
  // recorded a fault are history nobody needs — auto-clean them. A version is
  // "buggy" iff its frozen snapshot carries worldData.last_compile_error (the
  // fault-telemetry pipeline writes it the moment a tab's GPU rejects a world).
  void pruneBuggyVersions(space.id, nextVersion).catch(() => {})

  return NextResponse.json({ version }, { status: 201 })
}

/** Delete older versions whose snapshot recorded a compile/GPU fault, but only
 *  when the newest version is clean — the working version is the keeper; the
 *  broken drafts under it are noise. Never touches the newest version. */
async function pruneBuggyVersions(spaceId: string, newestVersion: number): Promise<void> {
  const newest = await prisma.spaceVersion.findFirst({
    where: { spaceId, version: newestVersion },
    select: { snapshot: true },
  })
  const wd = (newest?.snapshot as { worldData?: Record<string, unknown> } | null)?.worldData
  if (wd && wd['last_compile_error']) return   // newest is itself buggy — keep history
  // jsonb-path filter — never load every blob to find the buggy ones (audit)
  const buggy = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "SpaceVersion"
     WHERE "spaceId" = ${spaceId} AND version < ${newestVersion}
       AND snapshot->'worldData' ? 'last_compile_error'`
  if (buggy.length > 0) {
    await prisma.spaceVersion.deleteMany({ where: { id: { in: buggy.map(b => b.id) } } })
  }
  // RETENTION (audit: no cap existed anywhere — the eye auto-cuts a version
  // per settled burst, so history and every dedup/save slowed forever): keep
  // the newest 40 automatic 'the eye' rungs; hand-saved points never pruned.
  const eyeOld = await prisma.spaceVersion.findMany({
    where: { spaceId, note: 'the eye — settled burst' },
    orderBy: { version: 'desc' },
    skip: 40,
    select: { id: true },
  })
  if (eyeOld.length > 0) {
    await prisma.spaceVersion.deleteMany({ where: { id: { in: eyeOld.map(v => v.id) } } })
  }
}
