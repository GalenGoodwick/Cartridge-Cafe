import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveHolder, mintBuildToken, hist, LEASE_MS } from '@/lib/builds'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** POST /api/builds/:id/claim — atomically take a pending job.
 *  Returns 409 if someone else grabbed it (the thing the soft `builder_at`
 *  stamp can't do with many pollers). On success: lease + a per-world build
 *  token + the pre-build snapshot captured for rollback. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const holder = await resolveHolder(req)
  if (!holder) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const now = new Date()

  // Atomic guard: only a pending job this holder hasn't already dropped, and
  // (for volunteers) not house-escalated. count===0 → lost the race → 409.
  const guard = await prisma.buildJob.updateMany({
    where: {
      id,
      status: 'pending',
      NOT: { attemptedBy: { has: holder.id } },
      ...(holder.isHouse ? {} : { escalatedHouse: false }),
    },
    data: {
      status: 'leased',
      leaseHolderId: holder.id,
      leaseExpires: new Date(now.getTime() + LEASE_MS),
      heartbeatAt: now,
      attempts: { increment: 1 },
    },
  })
  if (guard.count === 0) {
    const exists = await prisma.buildJob.findUnique({ where: { id }, select: { status: true } })
    return NextResponse.json(
      { error: exists ? 'already claimed' : 'not found' },
      { status: exists ? 409 : 404 },
    )
  }

  const job = await prisma.buildJob.findUnique({ where: { id } })
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Capture the rollback point once (first claim), then mint the world token.
  const space = await prisma.playerSpace.findUnique({ where: { id: job.spaceId }, select: { snapshot: true } })
  const token = await mintBuildToken(job.spaceId, holder.displayName)
  await prisma.buildJob.update({
    where: { id },
    data: {
      preSnapshot: job.preSnapshot ?? space?.snapshot ?? undefined,
      history: hist(job.history, { at: now.toISOString(), by: holder.id, event: 'claimed' }),
    },
  })

  return NextResponse.json({
    ok: true,
    job: { id: job.id, spaceSlug: job.spaceSlug, brief: job.brief, attempts: job.attempts },
    token, // uc_st_ scoped to THIS world only
    leaseMs: LEASE_MS,
  })
}
