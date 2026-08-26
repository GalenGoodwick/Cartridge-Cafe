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
    let job = await prisma.buildJob.findFirst({
      // needs_review counts as active: the AI often keeps polishing after the
      // render check flips the job, and the build window must not vanish then.
      where: { spaceId, status: { in: ['pending', 'leased', 'building', 'needs_review'] } },
      select: { id: true, status: true, heartbeatAt: true, attempts: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    })
    // ORPHAN SELF-HEAL (Galen, Aug 26: a never-claimed job WEDGED his tab — the
    // client holds snapshot adopts while a job is active, and a pending job with
    // no builder is "active" forever). There is NO house AI: a pending job that
    // nobody touched for 10 min is an orphan — cancel it ON THE READ, lazily,
    // so every wedged world heals the next time anyone looks at it.
    if (job && job.status === 'pending' && !job.heartbeatAt &&
        Date.now() - new Date(job.updatedAt).getTime() > 10 * 60_000) {
      await prisma.buildJob.update({ where: { id: job.id }, data: { status: 'cancelled' } }).catch(() => {})
      job = null
    }
    return NextResponse.json({
      active: !!job,
      status: job?.status ?? null,
      // a heartbeat in the last 2 min = a builder is ON it right now (not just queued)
      live: !!(job?.heartbeatAt && Date.now() - new Date(job.heartbeatAt).getTime() < 120_000),
    })
  } catch {
    // DEGRADED (DB hiccup) — do NOT claim "not building". Returning active:false
    // here would vanish a live build's console + spinner mid-edit on a single
    // blip. 503 => the client's r.ok check fails => it holds its last-known state.
    return NextResponse.json({ active: null, status: null, live: false, degraded: true }, { status: 503 })
  }
}
