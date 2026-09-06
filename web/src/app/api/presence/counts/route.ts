import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/** ◉ N PLAYING NOW (Galen, Sep 6: "appears only if there are players so
 *  social proof doesn't cost us") — live human occupancy per world, one
 *  GROUP BY over the bounded presence table, 10s lambda memo + CDN cache.
 *  Zero-count worlds simply don't appear in the map. */
const g = globalThis as unknown as { __ccPresCounts?: { at: number; body: Record<string, number> } }

export async function GET() {
  const now = Date.now()
  if (g.__ccPresCounts && now - g.__ccPresCounts.at < 10_000) {
    return NextResponse.json({ counts: g.__ccPresCounts.body }, { headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' } })
  }
  let body: Record<string, number> = {}
  try {
    const rows = await prisma.$queryRawUnsafe<{ scene: string; n: bigint }[]>(
      `SELECT scene, count(*) AS n FROM cc_presence
        WHERE scene LIKE 'main/players/space:%' AND id NOT LIKE 'ai:%'
        GROUP BY scene`)
    for (const r of rows) body[r.scene.slice('main/players/space:'.length)] = Number(r.n)
  } catch { /* presence table absent/cold — empty map, badges just don't show */ }
  g.__ccPresCounts = { at: now, body }
  return NextResponse.json({ counts: body }, { headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' } })
}
