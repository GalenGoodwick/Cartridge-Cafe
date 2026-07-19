import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveHolder, LEASE_MS } from '@/lib/builds'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** POST /api/builds/:id/heartbeat — "still building": push the lease forward.
 *  Flips leased → building on the first beat. Only the lease holder may. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const holder = await resolveHolder(req)
  if (!holder) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const now = new Date()

  const res = await prisma.buildJob.updateMany({
    where: { id, leaseHolderId: holder.id, status: { in: ['leased', 'building'] } },
    data: { status: 'building', leaseExpires: new Date(now.getTime() + LEASE_MS), heartbeatAt: now },
  })
  if (res.count === 0) {
    // lost the lease (expired + reclaimed, or never held it) — tell the client to stop
    return NextResponse.json({ ok: false, error: 'lease lost' }, { status: 409 })
  }
  return NextResponse.json({ ok: true, leaseMs: LEASE_MS })
}
