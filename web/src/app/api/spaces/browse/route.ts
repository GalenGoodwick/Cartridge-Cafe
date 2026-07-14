import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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
      updatedAt: true,
      owner: { select: { id: true, name: true, image: true } },
      forkOf: { select: { slug: true, name: true } },
      _count: { select: { versions: true, forks: true, flags: true } },
      snapshot: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 60,
  })
  // the world's own palette → a single hue the door's living emblem wears, so a
  // player world's bubble carries its real color (the tidepool reads teal) with
  // no screenshot and nothing stored. Pick the most saturated field color.
  const hueOf = (fields: Array<{ color?: number[] }>): number | null => {
    let best = -1, bestHue = null as number | null
    for (const f of fields) {
      const c = f.color
      if (!Array.isArray(c) || c.length < 3) continue
      const [r, g, b] = c
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
      const sat = mx <= 0 ? 0 : d / mx
      if (sat <= best || d === 0) continue
      let h = 0
      if (mx === r) h = ((g - b) / d) % 6
      else if (mx === g) h = (b - r) / d + 2
      else h = (r - g) / d + 4
      best = sat; bestHue = ((h / 6) % 1 + 1) % 1
    }
    return bestHue
  }
  // a world is BLANK until it holds something; only unblank worlds join the door
  const out = spaces.map(({ snapshot, ...rest }) => {
    const sn = snapshot as { fields?: Array<{ color?: number[] }>; stepHooks?: unknown[]; visualTypes?: unknown[] } | null
    const blank = !sn || (!(sn.fields?.length) && !(sn.stepHooks?.length) && !(sn.visualTypes?.length))
    const hue = sn?.fields?.length ? hueOf(sn.fields) : null
    return { ...rest, blank, hue }
  })
  return NextResponse.json({ spaces: out })
}
