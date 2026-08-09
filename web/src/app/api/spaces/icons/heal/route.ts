import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isAdmin } from '@/lib/adminAuth'
import { bakeAllUnhealthy } from '@/lib/icon-bake-queue'

export const dynamic = 'force-dynamic'
export const maxDuration = 300   // a full sweep photographs many worlds through the eye

type Snap = {
  fields?: unknown[]
  stepHooks?: unknown[]
  visualTypes?: unknown[]
  worldData?: { creation_brief?: unknown; brief_done?: unknown } & Record<string, unknown>
} | null

/** POST /api/spaces/icons/heal — the deterministic backstop for the lazy shelf
 *  heal. Walks every non-blank world, re-bakes any whose icon is missing or stale
 *  (bounded concurrency), and returns a summary. Admin/cron only. GET mirrors it
 *  so it can be wired to a scheduled fetch. */
async function run(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdmin(req.headers.get('authorization')))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const spaces = await prisma.playerSpace.findMany({
    select: { slug: true, snapshot: true },
    orderBy: { updatedAt: 'desc' },
    take: 500,
  })
  const worlds = spaces
    .map(s => ({ slug: s.slug, sn: s.snapshot as Snap }))
    .filter(({ sn }) => {
      const blank = !sn || (!(sn.fields?.length) && !(sn.stepHooks?.length) && !(sn.visualTypes?.length))
      if (blank) return false
      if (sn?.worldData?.creation_brief && !sn?.worldData?.brief_done) return false
      return true
    })
    .map(({ slug, sn }) => ({ slug, snap: sn as never }))

  // ?max=N caps how many worlds this run photographs — lets a first backfill go
  // in gentle batches instead of one long run that could strain the eye.
  const maxParam = Number(new URL(req.url).searchParams.get('max'))
  const maxBakes = Number.isFinite(maxParam) && maxParam > 0 ? maxParam : undefined
  const summary = await bakeAllUnhealthy(worlds, { maxBakes })
  return NextResponse.json({ ok: true, summary })
}

export async function POST(req: NextRequest) { return run(req) }
export async function GET(req: NextRequest) { return run(req) }
