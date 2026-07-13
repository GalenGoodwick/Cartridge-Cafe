import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// Who's inside each world right now. Clients heartbeat their scene every ~12s;
// anyone silent for 30s has left; a closed tab says goodbye instantly.
// One body per person — a beat moves you, never duplicates you.
//
// Backed by Postgres (one tiny additive table) so counts are correct across
// serverless instances in production; falls back to in-memory when the DB
// is unreachable (dev without a database still works).

const STALE_MS = 30_000

type Rooms = Map<string, Map<string, number>>
const g = globalThis as unknown as { __ccPresence?: Rooms; __ccPresenceTable?: boolean }
const mem = (g.__ccPresence ||= new Map())

async function ensureTable(): Promise<void> {
  if (g.__ccPresenceTable) return
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS cc_presence (
       id text PRIMARY KEY,
       scene text NOT NULL,
       seen timestamptz NOT NULL DEFAULT now()
     )`)
  g.__ccPresenceTable = true
}

function memSweep() {
  const now = Date.now()
  for (const [scene, people] of mem) {
    for (const [id, seen] of people) if (now - seen > STALE_MS) people.delete(id)
    if (people.size === 0) mem.delete(scene)
  }
}

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await ensureTable()
    await prisma.$executeRawUnsafe(`DELETE FROM cc_presence WHERE seen < now() - interval '30 seconds'`)
    const rows = await prisma.$queryRawUnsafe<{ scene: string; n: bigint }[]>(
      `SELECT scene, count(*) AS n FROM cc_presence GROUP BY scene`)
    const counts: Record<string, number> = {}
    for (const r of rows) counts[r.scene] = Number(r.n)
    return NextResponse.json({ counts })
  } catch {
    memSweep()
    const counts: Record<string, number> = {}
    for (const [scene, people] of mem) counts[scene] = people.size
    return NextResponse.json({ counts })
  }
}

export async function POST(req: NextRequest) {
  let body: { scene?: unknown; id?: unknown; leave?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad beat' }, { status: 400 }) }
  const { scene, id, leave } = body
  if (typeof id !== 'string' || id.length > 64) {
    return NextResponse.json({ error: 'bad beat' }, { status: 400 })
  }
  if (!leave && (typeof scene !== 'string' || scene.length > 64)) {
    return NextResponse.json({ error: 'bad beat' }, { status: 400 })
  }
  try {
    await ensureTable()
    if (leave) {
      await prisma.$executeRawUnsafe(`DELETE FROM cc_presence WHERE id = $1`, id)
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO cc_presence (id, scene, seen) VALUES ($1, $2, now())
         ON CONFLICT (id) DO UPDATE SET scene = $2, seen = now()`, id, scene)
    }
    return NextResponse.json({ ok: true })
  } catch {
    // memory fallback — same semantics
    for (const people of mem.values()) people.delete(id)
    if (!leave) {
      const s = scene as string
      if (!mem.has(s)) mem.set(s, new Map())
      mem.get(s)!.set(id, Date.now())
    }
    return NextResponse.json({ ok: true })
  }
}
