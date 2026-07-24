import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveHolder, hist } from '@/lib/builds'
import { notifyUser } from '@/lib/notify'
import { sendPushToUser, cafePush } from '@/lib/push'
import { commonsBus } from '@/lib/commons-bus'

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

  // Tell the world's owner it's ready — in-app bell (always) + OS push (if they
  // opted in). A brewed world can queue and take minutes; this is the ping.
  if (job.spaceId) {
    const space = await prisma.playerSpace.findUnique({
      where: { id: job.spaceId },
      select: { ownerId: true, name: true, slug: true },
    }).catch(() => null)
    if (space?.ownerId) {
      const nm = space.name || space.slug
      void notifyUser(space.ownerId, 'built', `✦ "${nm}" finished building — come see it.`, `/space/${space.slug}`).catch(() => {})
      void sendPushToUser(space.ownerId, cafePush.worldBuilt(nm, space.slug)).catch(() => {})
      // COMMONS BUS — a finished world is the cafe's best content: announce it
      // where everyone (and every daemon) is watching.
      void commonsBus({ kind: 'world', who: holder.isHouse ? 'house AI' : holder.displayName, slug: space.slug,
        text: `✦ world built: "${nm}" — walk in: /space/${space.slug}` })
    }
  }
  return NextResponse.json({ ok: true })
}
