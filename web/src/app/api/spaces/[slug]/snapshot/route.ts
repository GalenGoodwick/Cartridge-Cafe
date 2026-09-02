import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getSpaceSnapshot } from '@/app/api/engine/space-store'

export const dynamic = 'force-dynamic'

/** GET /api/spaces/:slug/snapshot — Load space's SceneSnapshot (for visitor browsers) */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const versionParam = req.nextUrl.searchParams.get('version')
  const revOnly = req.nextUrl.searchParams.get('rev') === '1'

  // Cheap identity read — do NOT select the `snapshot` jsonb column here. Selecting
  // it forces Postgres to detoast the entire ~300KB world blob on every hit, even
  // for a ?rev=1 heartbeat that needs a single integer. The body is served from the
  // warm per-lambda cache (getSpaceSnapshot) below instead.
  const space = await prisma.playerSpace.findUnique({
    where: { slug },
    select: {
      id: true,
      ownerId: true,
      isPublic: true,
    },
  })

  if (!space) {
    return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  }

  // Check visibility for non-owners
  if (!space.isPublic) {
    const session = await getServerSession(authOptions)
    const user = session?.user?.email
      ? await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
      : null

    if (user?.id !== space.ownerId) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 })
    }
  }

  // ?rev=1 — the auto-load heartbeat: just the bridge revision, no body.
  // Tabs poll this to learn an AI wrote the world under them.
  if (revOnly) {
    // Served from the warm cache (30s per-lambda, refreshed by the editor's own
    // writes) — the rev heartbeat no longer detoasts 300KB on every poll.
    const snap = await getSpaceSnapshot(space.id)
    const wd = (snap as { worldData?: { __bridge_rev?: unknown } } | null)?.worldData
    return NextResponse.json({ rev: Number(wd?.__bridge_rev) || 0 })
  }

  // ?version=N — serve a historical save point instead of the live world (demo view)
  if (versionParam) {
    const versionNum = parseInt(versionParam, 10)
    if (!Number.isFinite(versionNum)) {
      return NextResponse.json({ error: 'Invalid version' }, { status: 400 })
    }
    const version = await prisma.spaceVersion.findUnique({
      where: { spaceId_version: { spaceId: space.id, version: versionNum } },
      select: { snapshot: true, version: true },
    })
    if (!version) return NextResponse.json({ error: 'Version not found' }, { status: 404 })
    return NextResponse.json({
      spaceId: space.id,
      snapshot: version.snapshot,
      version: version.version,
    })
  }

  const snap = await getSpaceSnapshot(space.id)
  return NextResponse.json({
    spaceId: space.id,
    snapshot: snap ?? null,
  })
}
