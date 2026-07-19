import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveHolder, hist, HOUSE, HOUSE_ESCALATE_ATTEMPTS, REVIEW_ATTEMPTS } from '@/lib/builds'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** POST /api/builds/:id/release — a clean interrupt (the volunteer went
 *  un-idle / quit gracefully). Requeue immediately via the escalation ladder,
 *  rather than waiting for the lease to expire. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const holder = await resolveHolder(req)
  if (!holder) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const now = new Date()

  const job = await prisma.buildJob.findUnique({ where: { id } })
  if (!job || job.leaseHolderId !== holder.id) {
    return NextResponse.json({ ok: false, error: 'not your lease' }, { status: 409 })
  }

  const attemptedBy = job.attemptedBy.includes(holder.id) ? job.attemptedBy : [...job.attemptedBy, holder.id]
  const status = job.attempts >= REVIEW_ATTEMPTS ? 'needs_review' : 'pending'
  if (!holder.isHouse) {
    await prisma.builder.updateMany({ where: { id: holder.id }, data: { abandons: { increment: 1 } } }).catch(() => {})
  }
  await prisma.buildJob.update({
    where: { id },
    data: {
      status,
      leaseHolderId: null,
      leaseExpires: null,
      heartbeatAt: null,
      attemptedBy,
      escalatedHouse: holder.id !== HOUSE && job.attempts >= HOUSE_ESCALATE_ATTEMPTS,
      history: hist(job.history, { at: now.toISOString(), by: holder.id, event: 'released', note: `attempt ${job.attempts}` }),
    },
  })
  return NextResponse.json({ ok: true, requeuedAs: status })
}
