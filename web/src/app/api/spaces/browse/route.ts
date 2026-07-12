import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/** GET /api/spaces/browse — Public worlds gallery (no auth) */
export async function GET() {
  const spaces = await prisma.playerSpace.findMany({
    where: { isPublic: true },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      updatedAt: true,
      owner: { select: { id: true, name: true, image: true } },
      forkOf: { select: { slug: true, name: true } },
      _count: { select: { versions: true, forks: true, flags: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 60,
  })
  return NextResponse.json({ spaces })
}
