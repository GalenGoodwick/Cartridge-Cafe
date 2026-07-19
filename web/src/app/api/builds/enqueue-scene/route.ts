import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { mayWriteScene } from '@/app/api/engine/scene-auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** POST /api/builds/enqueue-scene { sceneName, brief } — queue a BRANCH (scene)
 *  for the house-AI swarm. Branches aren't PlayerSpaces, so reconcile() never
 *  sees them; this is how the branch panel's "have the house AI build it" button
 *  gets a branch into the queue. Authorized by the same rule that guards writing
 *  the branch. Dedups against a live job for the same scene. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const sceneName = String(body?.sceneName ?? '').trim()
  const brief = String(body?.brief ?? '').trim()

  if (!sceneName.includes(' ⑂ ')) {
    return NextResponse.json({ error: 'only branches can be queued' }, { status: 400 })
  }
  if (brief.length < 20) {
    return NextResponse.json({ error: 'brief too short' }, { status: 400 })
  }
  if (!(await mayWriteScene(req, sceneName))) {
    return NextResponse.json({ error: 'not authorized for this branch' }, { status: 403 })
  }

  const live = await prisma.buildJob.findFirst({
    where: { sceneName, status: { in: ['pending', 'leased', 'building', 'needs_review'] } },
    select: { id: true },
  })
  if (live) return NextResponse.json({ ok: true, jobId: live.id, already: true })

  const job = await prisma.buildJob.create({
    data: {
      sceneName,
      spaceSlug: sceneName,
      brief,
      history: [{ at: new Date().toISOString(), by: 'owner', event: 'enqueued (branch)' }],
    },
    select: { id: true },
  })
  return NextResponse.json({ ok: true, jobId: job.id })
}
