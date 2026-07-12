import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/** GET /api/spaces/:slug/ancestry — Breadcrumb chain from root to current space */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const space = await prisma.playerSpace.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, parentSpaceId: true, isPublic: true },
  })

  if (!space) {
    return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  }

  // Walk up the parent chain (cap at 10 to prevent infinite loops)
  const ancestors: Array<{ slug: string; name: string }> = []
  let currentParentId = space.parentSpaceId
  let depth = 0

  while (currentParentId && depth < 10) {
    const parent = await prisma.playerSpace.findUnique({
      where: { id: currentParentId },
      select: { slug: true, name: true, parentSpaceId: true },
    })
    if (!parent) break
    ancestors.unshift({ slug: parent.slug, name: parent.name })
    currentParentId = parent.parentSpaceId
    depth++
  }

  return NextResponse.json({
    ancestors,
    current: { slug: space.slug, name: space.name },
  })
}
