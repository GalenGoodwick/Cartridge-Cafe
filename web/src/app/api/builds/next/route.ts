import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveHolder, reconcile, sweep } from '@/lib/builds'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET /api/builds/next — a builder peeks at one claimable job.
 *  Read-only: enqueues from briefs, requeues dead leases, then returns the next
 *  job this holder may take (or {job:null}). Claim it via POST …/:id/claim. */
export async function GET(req: NextRequest) {
  const holder = await resolveHolder(req)
  if (!holder) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const now = new Date()
  await reconcile(now)
  await sweep(now)

  // Volunteers skip house-escalated jobs and anything they've already dropped.
  // The house AI takes anything, preferring escalated jobs first.
  const job = holder.isHouse
    ? await prisma.buildJob.findFirst({
        where: { status: 'pending' },
        orderBy: [{ escalatedHouse: 'desc' }, { createdAt: 'asc' }],
      })
    : await prisma.buildJob.findFirst({
        where: { status: 'pending', escalatedHouse: false, NOT: { attemptedBy: { has: holder.id } } },
        orderBy: { createdAt: 'asc' },
      })

  if (!job) return NextResponse.json({ job: null })
  return NextResponse.json({
    job: { id: job.id, spaceSlug: job.spaceSlug, brief: job.brief, attempts: job.attempts },
  })
}
