import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveHolder, reconcile } from '@/lib/builds'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** POST /api/builds/reopen { spaceId | spaceSlug | jobId }
 *
 *  Re-arm a build that the escalation ladder parked. After REVIEW_ATTEMPTS a
 *  job goes to `needs_review` (and a credit-limited or failed run counts against
 *  that), which /api/builds/next never serves — so the house AI can't resume it
 *  even though the world is half-built and its snapshot is safe. This flips such
 *  a job back to `pending` with a fresh attempt count, and the resume-aware
 *  builder continues from the saved snapshot (never restarts).
 *
 *  House-only (the engine agent token). Owners trigger it through the daemon /
 *  admin surface, not anonymously. */
export async function POST(req: NextRequest) {
  const holder = await resolveHolder(req)
  if (!holder || !holder.isHouse) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const jobId = String(body?.jobId ?? '').trim()
  const spaceId = String(body?.spaceId ?? '').trim()
  const spaceSlug = String(body?.spaceSlug ?? '').trim()
  if (!jobId && !spaceId && !spaceSlug) {
    return NextResponse.json({ error: 'jobId, spaceId, or spaceSlug required' }, { status: 400 })
  }

  const where = jobId ? { id: jobId } : spaceId ? { spaceId } : { spaceSlug }
  // only re-arm recoverable parked states — never yank a job that's mid-build,
  // and never un-block a `rejected` one (that's a deliberate hazard/abuse stop).
  const parked = await prisma.buildJob.findMany({
    where: { ...where, status: { in: ['needs_review', 'done'] } },
    select: { id: true },
  })

  const now = new Date()
  const reopened = await prisma.buildJob.updateMany({
    where: { id: { in: parked.map(j => j.id) } },
    data: {
      status: 'pending',
      attempts: 0,
      leaseHolderId: null,
      leaseExpires: null,
      heartbeatAt: null,
      escalatedHouse: true,   // let the house AI take it straight away
      updatedAt: now,
    },
  })

  // no parked job to re-arm? fall back to reconcile so a space that still has an
  // unfinished brief but somehow lost its job gets a fresh one.
  if (reopened.count === 0) await reconcile(now)

  return NextResponse.json({ ok: true, reopened: reopened.count })
}
