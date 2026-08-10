import { NextRequest, NextResponse } from 'next/server'
import { commonsPresentAI } from '@/lib/commons'

export const dynamic = 'force-dynamic'

/**
 * GET /api/engine/presence
 * Is any REAL connected AI live on the cafe commons right now? Powers the
 * "AI UNPLUGGED / AI LIVE" indicator so a viewer can see the plug-in prompt
 * actually landed an agent — independent of any one world's SSE stream.
 * Public + non-sensitive (an AI's presence is already shown in the builder UI);
 * returns just a boolean + the active names. Excludes engine/system bus noise.
 */
export async function GET() {
  try {
    const names = await commonsPresentAI()
    return NextResponse.json(
      { ai: names.length > 0, count: names.length, names },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    return NextResponse.json({ ai: false, count: 0, names: [] })
  }
}

/**
 * POST /api/engine/presence
 * Player presence: every viewing tab reports its cursor a few times a second
 * and gets back the other players in the same world — capped at 25 per
 * viewing instance. In-memory with a short TTL: presence is a live signal,
 * not a record. (On serverless this is per-instance best-effort; on the
 * persistent dev/local server it is exact.)
 * Body: { world: string, id: string, x: number, y: number, hue?: number }
 * → { others: [{ id, x, y, hue }] }
 */
type Presence = { x: number; y: number; hue: number; t: number }
const worlds = new Map<string, Map<string, Presence>>()
const TTL_MS = 6000
const CAP = 25

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { world, id, x, y, hue } = body as Record<string, unknown>
    if (typeof world !== 'string' || typeof id !== 'string' ||
        typeof x !== 'number' || typeof y !== 'number' ||
        !isFinite(x) || !isFinite(y) || world.length > 128 || id.length > 32) {
      return NextResponse.json({ error: 'Expected { world, id, x, y }' }, { status: 400 })
    }
    let room = worlds.get(world)
    if (!room) { room = new Map(); worlds.set(world, room) }
    const now = Date.now()
    room.set(id, { x, y, hue: typeof hue === 'number' ? hue : 0, t: now })

    const others: Array<{ id: string; x: number; y: number; hue: number }> = []
    for (const [k, v] of room) {
      if (now - v.t > TTL_MS) { room.delete(k); continue }
      if (k !== id && others.length < CAP) others.push({ id: k, x: v.x, y: v.y, hue: v.hue })
    }
    if (room.size === 0) worlds.delete(world)
    return NextResponse.json({ others })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}
