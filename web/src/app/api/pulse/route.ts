import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getWorldRev } from '@/app/api/engine/world-rev'

export const dynamic = 'force-dynamic'

/** THE PULSE (scalability ladder, rung 3): one endpoint for the "has anything
 *  changed?" poll families a tab used to ask separately (world-rev + build
 *  status — the two Neon-heaviest). One lambda invocation, one Promise.all,
 *  3s per-lambda memo. The tab's client memo (pulse.ts) dedupes further so
 *  N interested effects share ONE request. */
const memo: Map<string, { at: number; body: Record<string, unknown> }> =
  ((globalThis as unknown as { __ccPulseMemo?: Map<string, { at: number; body: Record<string, unknown> }> }).__ccPulseMemo ??= new Map())

export async function GET(req: NextRequest) {
  const spaceId = req.nextUrl.searchParams.get('space')
  if (!spaceId) return NextResponse.json({ error: 'space required' }, { status: 400 })
  // the pulse IS the tab heartbeat now (tabseen — the split-brain honesty fix)
  {
    const g = (globalThis as unknown as { __ccTabSeenP?: Map<string, number> })
    const m = g.__ccTabSeenP ??= new Map()
    const now0 = Date.now()
    if (now0 - (m.get(spaceId) ?? 0) > 10_000) {
      m.set(spaceId, now0)
      const { prisma: db } = await import('@/lib/prisma')
      void db.playerSpace.findUnique({ where: { id: spaceId }, select: { slug: true } })
        .then(async sp => { if (sp?.slug) { const { saveGameSlot } = await import('@/app/api/engine/store'); await saveGameSlot('tabseen:' + sp.slug, now0) } })
        .catch(() => {})
    }
  }
  const hit = memo.get(spaceId)
  const now = Date.now()
  if (hit && now - hit.at < 3000) return NextResponse.json(hit.body)
  const [rev, job] = await Promise.all([
    getWorldRev('space:' + spaceId),
    prisma.buildJob.findFirst({
      where: { spaceId, status: { in: ['pending', 'building'] } },
      orderBy: { updatedAt: 'desc' },
      select: { status: true, heartbeatAt: true, updatedAt: true },
    }).catch(() => null),
  ])
  const stale = job?.status === 'pending' && !job.heartbeatAt && now - new Date(job.updatedAt).getTime() > 10 * 60_000
  const body = {
    rev,
    build: {
      active: !!job && !stale,
      status: stale ? null : (job?.status ?? null),
      live: !!(job?.heartbeatAt && now - new Date(job.heartbeatAt).getTime() < 120_000),
    },
  }
  memo.set(spaceId, { at: now, body })
  if (memo.size > 2000) memo.clear()
  return NextResponse.json(body)
}
