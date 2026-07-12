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
export async function POST(req: NextRequest) {
  if (!(await writeAllowed(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const body = await req.json()
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
