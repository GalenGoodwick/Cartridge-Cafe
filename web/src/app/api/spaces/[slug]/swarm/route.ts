import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { readSwarmMap, mapSummary } from '@/app/api/engine/swarm-store'

export const dynamic = 'force-dynamic'

/** GET /api/spaces/:slug/swarm — the world's SWARM work-graph (the game-element
 *  tree: elements, subnodes, status, who's docked, connections). Public read —
 *  the graph is not secret; it drives the BuilderBox "swarm" tab, polled live so
 *  the view reflects docked AIs + progress as workers turn nodes green. Returns
 *  { map: null } when the world has no swarm graph. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const space = await prisma.playerSpace.findUnique({ where: { slug }, select: { id: true } })
  if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  const map = await readSwarmMap(space.id)
  return NextResponse.json({ map: map ? mapSummary(map) : null })
}
