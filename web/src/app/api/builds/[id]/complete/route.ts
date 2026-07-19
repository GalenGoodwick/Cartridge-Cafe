import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveHolder, hist } from '@/lib/builds'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** POST /api/builds/:id/complete — the first pass landed (agent set brief_done
 *  on the world via the bridge). Mark the job done and credit the builder. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const holder = await resolveHolder(req)
  if (!holder) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const now = new Date()

  const job = await prisma.buildJob.findUnique({ where: { id } })
  if (!job || job.leaseHolderId !== holder.id) {
    return NextResponse.json({ ok: false, error: 'not your lease' }, { status: 409 })
  }

  await prisma.buildJob.update({
    where: { id },
    data: {
      status: 'done',
      leaseExpires: null,
      history: hist(job.history, { at: now.toISOString(), by: holder.id, event: 'completed' }),
    },
  })
  if (!holder.isHouse) {
    await prisma.builder.updateMany({
      where: { id: holder.id },
      data: { jobsDone: { increment: 1 }, reputation: { increment: 1 } },
    }).catch(() => {})
  }
  return NextResponse.json({ ok: true })
}
