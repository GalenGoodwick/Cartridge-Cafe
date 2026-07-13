import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { saveGameSlot, loadGameSlot, listGameSlots, deleteGameSlot } from '../store'

export const dynamic = 'force-dynamic'

/** Same posture as the scene route: dev keeps the frictionless local workflow;
 *  production requires a session or the engine agent token. */
async function writeAllowed(req: NextRequest): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production') return true
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const envToken = process.env.ENGINE_AGENT_TOKEN
    if (envToken && authHeader.slice(7) === envToken) return true
  }
  const session = await getServerSession(authOptions)
  return !!session?.user?.email
}

/**
 * GET /api/engine/save?slot=xxx     — read a save slot
 * GET /api/engine/save?action=list  — list all slots
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  if (searchParams.get('action') === 'list') {
    return NextResponse.json({ slots: listGameSlots() })
  }
  const slot = searchParams.get('slot')
  if (!slot) return NextResponse.json({ error: 'slot or action=list required' }, { status: 400 })
  const data = loadGameSlot(slot)
  return NextResponse.json({ slot, data: data ?? null })
}

/** POST /api/engine/save  Body: { slot: string, data: unknown } */
/** The cafe's shared bubble universe: one layout, live for all players —
 *  anonymous browsers publish it too, so this single slot is writable
 *  without a session, but only when the payload is exactly the expected
 *  shape (a small map of named positions). */
function isPublicUniverseWrite(body: { slot?: unknown; data?: unknown }): boolean {
  if (body.slot !== 'cafe:universe') return false
  const d = body.data as { v?: unknown; at?: unknown; bubbles?: unknown } | null
  if (!d || d.v !== 1 || typeof d.at !== 'number' || !d.bubbles || typeof d.bubbles !== 'object') return false
  const bubbles = d.bubbles as Record<string, { x?: unknown; y?: unknown; born?: unknown }>
  const names = Object.keys(bubbles)
  if (names.length > 40) return false
  for (const n of names) {
    const b = bubbles[n]
    if (n.length > 80 || !b || typeof b.x !== 'number' || typeof b.y !== 'number' ||
        !isFinite(b.x) || !isFinite(b.y) || (b.born !== undefined && typeof b.born !== 'number')) return false
  }
  return true
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!isPublicUniverseWrite(body) && !(await writeAllowed(req))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (typeof body.slot === 'string' && 'data' in body) {
      saveGameSlot(body.slot, body.data)
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'slot and data required' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}

/** DELETE /api/engine/save  Body: { slot: string } */
export async function DELETE(req: NextRequest) {
  if (!(await writeAllowed(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const body = await req.json()
    if (typeof body.slot === 'string') {
      return NextResponse.json({ ok: true, deleted: deleteGameSlot(body.slot) })
    }
    return NextResponse.json({ error: 'slot required' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}
