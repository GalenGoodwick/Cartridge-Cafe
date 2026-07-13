import { NextRequest, NextResponse } from 'next/server'

// Who's inside each world right now. Clients heartbeat their scene every ~20s;
// anyone silent for 45s has left. In-memory (shared via globalThis like the
// engine store) — approximate by design, honest enough for a door count.
type Rooms = Map<string, Map<string, number>>
const g = globalThis as unknown as { __ccPresence?: Rooms }
const rooms = (g.__ccPresence ||= new Map())

const STALE_MS = 30_000

function sweep() {
  const now = Date.now()
  for (const [scene, people] of rooms) {
    for (const [id, seen] of people) if (now - seen > STALE_MS) people.delete(id)
    if (people.size === 0) rooms.delete(scene)
  }
}

export const dynamic = 'force-dynamic'

export async function GET() {
  sweep()
  const counts: Record<string, number> = {}
  for (const [scene, people] of rooms) counts[scene] = people.size
  return NextResponse.json({ counts })
}

export async function POST(req: NextRequest) {
  try {
    const { scene, id, leave } = await req.json()
    if (typeof id !== 'string' || id.length > 64) {
      return NextResponse.json({ error: 'bad beat' }, { status: 400 })
    }
    sweep()
    // one body per person: leave wherever they were before
    for (const people of rooms.values()) people.delete(id)
    if (leave) return NextResponse.json({ ok: true })   // tab closed — gone now, not in 30s
    if (typeof scene !== 'string' || scene.length > 64) {
      return NextResponse.json({ error: 'bad beat' }, { status: 400 })
    }
    if (!rooms.has(scene)) rooms.set(scene, new Map())
    rooms.get(scene)!.set(id, Date.now())
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'bad beat' }, { status: 400 })
  }
}
