import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/** GET /api/spaces/:slug/snapshot — Load space's SceneSnapshot (for visitor browsers) */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const versionParam = req.nextUrl.searchParams.get('version')

  const space = await prisma.playerSpace.findUnique({
    where: { slug },
    select: {
      id: true,
      ownerId: true,
      isPublic: true,
      snapshot: true,
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

  return NextResponse.json({
    spaceId: space.id,
    snapshot: space.snapshot ?? null,
  })
}
