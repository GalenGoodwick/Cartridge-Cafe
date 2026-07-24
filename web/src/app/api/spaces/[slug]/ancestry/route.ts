import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { walkUpBranches } from '@/lib/spaceTree'

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

  const ancestors = (await walkUpBranches(space.parentSpaceId)).map(a => ({ slug: a.slug, name: a.name }))

  return NextResponse.json({
    ancestors,
    current: { slug: space.slug, name: space.name },
  })
}
