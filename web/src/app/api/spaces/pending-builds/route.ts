import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/** GET /api/spaces/pending-builds — the house AI's work queue (admin token).
 *  Worlds whose owner left a creation brief that no AI has finished: the
 *  resident builder polls this, builds each brief, and marks brief_done.
 *  Newest first, small page — the builder works one at a time anyway. */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  const token = process.env.ENGINE_AGENT_TOKEN
  if (!token || auth !== `Bearer ${token}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const spaces = await prisma.playerSpace.findMany({
    select: { slug: true, name: true, snapshot: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  })
  const pending: Array<{ slug: string; name: string; brief: string; briefAt: number | null; builderAt: number | null; createdAt: Date }> = []
  for (const s of spaces) {
    const sn = s.snapshot as { worldData?: { creation_brief?: { prompt?: string; at?: number }; brief_done?: unknown; builder_at?: number } } | null
    const brief = sn?.worldData?.creation_brief
    if (!brief?.prompt || sn?.worldData?.brief_done) continue
    pending.push({
      slug: s.slug,
      name: s.name,
      brief: brief.prompt,
      briefAt: brief.at ?? null,
      builderAt: sn?.worldData?.builder_at ?? null,   // when a builder last took it
      createdAt: s.createdAt,
    })
  }
  return NextResponse.json({ pending })
}
