import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ensureBuilderTables } from '@/lib/builder-tables'

export const dynamic = 'force-dynamic'

/** GET /api/builds/status?spaceId=… — is an AI actively building this world?
 *  THE authoritative "AI is building" signal for the viewer: the client-side
 *  worldData gate (creation_brief && !brief_done) can go stale mid-adopt, but a
 *  live BuildJob can't lie. Public read — it leaks nothing but "being built". */
export async function GET(req: NextRequest) {
  const spaceId = req.nextUrl.searchParams.get('spaceId')?.trim()
  if (!spaceId) return NextResponse.json({ error: 'spaceId required' }, { status: 400 })
  try {
    await ensureBuilderTables()
    const job = await prisma.buildJob.findFirst({
      where: { spaceId, status: { in: ['pending', 'leased', 'building'] } },
      select: { status: true, heartbeatAt: true, attempts: true },
      orderBy: { updatedAt: 'desc' },
    })
    return NextResponse.json({
      active: !!job,
      status: job?.status ?? null,
      // a heartbeat in the last 2 min = a builder is ON it right now (not just queued)
      live: !!(job?.heartbeatAt && Date.now() - new Date(job.heartbeatAt).getTime() < 120_000),
    })
  } catch {
    return NextResponse.json({ active: false, status: null, live: false })
  }
}
