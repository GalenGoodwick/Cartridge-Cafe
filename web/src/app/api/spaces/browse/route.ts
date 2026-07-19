import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { composeIcon, dominantHue, IconField } from '@/lib/icon-compose'

export const dynamic = 'force-dynamic'

/** GET /api/spaces/browse — Public worlds gallery; signed-in callers also see
 *  their own private/blank worlds (fuel for the MY WORLDS submain) */
export async function GET() {
  const session = await getServerSession(authOptions).catch(() => null)
  const uid = session?.user?.id
  const spaces = await prisma.playerSpace.findMany({
    where: uid ? { OR: [{ isPublic: true }, { ownerId: uid }] } : { isPublic: true },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      isPublic: true,
      updatedAt: true,
      owner: { select: { id: true, name: true, image: true } },
      forkOf: { select: { slug: true, name: true } },
      _count: { select: { versions: true, forks: true, flags: true } },
      snapshot: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  })
  // a world is BLANK until it holds something; only unblank worlds join the door
  const out = spaces.map(({ snapshot, ...rest }) => {
    const sn = snapshot as { fields?: IconField[]; stepHooks?: unknown[]; visualTypes?: Array<{ name?: string; wgsl?: string }>; modules?: Array<{ name?: string; wgsl?: string }>; worldData?: { icon_wgsl?: unknown; creation_brief?: unknown; brief_done?: unknown } } | null
    const blank = !sn || (!(sn.fields?.length) && !(sn.stepHooks?.length) && !(sn.visualTypes?.length))
    // still being built by an AI: a creation_brief was set but never finished.
    // Such a world is "stuck in AI is working" and must NOT surface on main.
    const building = !!(sn?.worldData?.creation_brief) && !(sn?.worldData?.brief_done)
    const hue = sn?.fields?.length ? dominantHue(sn.fields) : null
    // bespoke icon (MAKE ICON) wins; else the world's own composed visual; else
    // (null) the door falls back to the color emblem.
    const iconWgsl = composeIcon(sn?.fields || [], sn?.visualTypes || [], sn?.worldData?.icon_wgsl, sn?.modules || [])
    return { ...rest, blank, building, hue, iconWgsl }
  })
  return NextResponse.json({ spaces: out })
}
