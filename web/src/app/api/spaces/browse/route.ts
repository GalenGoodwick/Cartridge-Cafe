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
      snapshot: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 60,
  })
  // a world is BLANK until it holds something; only unblank worlds join the door
  const out = spaces.map(({ snapshot, ...rest }) => {
    const sn = snapshot as { fields?: unknown[]; stepHooks?: unknown[]; visualTypes?: unknown[] } | null
    const blank = !sn || (!(sn.fields?.length) && !(sn.stepHooks?.length) && !(sn.visualTypes?.length))
    return { ...rest, blank }
  })
  return NextResponse.json({ spaces: out })
}
