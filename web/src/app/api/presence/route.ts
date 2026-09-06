import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { visitorId, isHeadlessUA } from '@/lib/visits'

// Who's inside each world right now. Clients heartbeat their scene every ~12s;
// anyone silent for 30s has left; a closed tab says goodbye instantly.
// One body per person — a beat moves you, never duplicates you.
//
// Backed by Postgres (one tiny additive table) so counts are correct across
// serverless instances in production; falls back to in-memory when the DB
// is unreachable (dev without a database still works).

const STALE_MS = 30_000

type Rooms = Map<string, Map<string, number>>
const g = globalThis as unknown as { __ccPresence?: Rooms; __ccPresenceTable?: boolean; __ccPlayTable?: boolean }
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

// PLAYTIME (a durable CONSUMER of the same heartbeat — not a rival occupancy
// source; see PRESENCE.md). Occupancy is cc_presence (ephemeral, 30s TTL). This
// retains how long each body actually stayed: on every beat we extend the open
// session (or start a new one after a gap), so playtime = Σ real beat intervals,
// gap-capped so a walked-away tab can't inflate it. Self-creating, like Visit.
const PLAY_GAP_S = 45   // a beat within this window continues the session
const PLAY_CAP_S = 30   // max seconds credited per beat (guards sleep/long gaps)
async function ensurePlayTable(): Promise<void> {
  if (g.__ccPlayTable) return
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS play_session (
       id bigserial PRIMARY KEY,
       sess text NOT NULL,
       scene text NOT NULL,
       vid text,
       started_at timestamptz NOT NULL DEFAULT now(),
       last_beat_at timestamptz NOT NULL DEFAULT now(),
       seconds int NOT NULL DEFAULT 0
     )`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS play_session_scene_idx ON play_session (scene, last_beat_at)`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS play_session_sess_idx ON play_session (sess, last_beat_at)`)
  g.__ccPlayTable = true
}

/** Accrue playtime for one beat. Best-effort — a failure here must NEVER affect
 *  occupancy (its own try/catch at the call site). Skips AI/dev markers and bots
 *  (they don't "play"). vid ties the session to the analytics visitor so we can
 *  ask "how long did NEWCOMERS stay?". */
async function accruePlaytime(id: string, scene: string, req: NextRequest): Promise<void> {
  if (id.startsWith('ai:') || id.startsWith('dev:')) return
  const ua = req.headers.get('user-agent') || ''
  if (isHeadlessUA(ua)) return
  await ensurePlayTable()
  const vid = visitorId(req.headers.get('x-forwarded-for')?.split(',')[0] || '', ua)
  const extended = await prisma.$executeRawUnsafe(
    `UPDATE play_session
        SET seconds = seconds + LEAST(GREATEST(EXTRACT(EPOCH FROM (now() - last_beat_at))::int, 0), ${PLAY_CAP_S}),
            last_beat_at = now()
      WHERE sess = $1 AND scene = $2 AND last_beat_at > now() - interval '${PLAY_GAP_S} seconds'`,
    id, scene)
  if (!extended) {
    await prisma.$executeRawUnsafe(`INSERT INTO play_session (sess, scene, vid) VALUES ($1, $2, $3)`, id, scene, vid)
  }
}

function memSweep() {
  const now = Date.now()
  for (const [scene, people] of mem) {
    for (const [id, seen] of people) if (now - seen > STALE_MS) people.delete(id)
    if (people.size === 0) mem.delete(scene)
  }
}

export const dynamic = 'force-dynamic'

// The on-world FocusChip's "developer live · N watching" line: `?slug=<slug>`
// asks about ONE world. devLive is TRUTHFUL BY CONSTRUCTION — the AI builder is
// docked as id `ai:<slug>` (bridge beats it on every authed build command), so a
// fresh row means real work is landing right now; when the builder stops, the
// beat goes stale and the badge drops on its own (nothing to fake). `present` =
// the human bodies on that world's /space page (scene `main/players/space:<slug>`,
// how SpaceStage keys them), excluding the ai:* dock. The chip subtracts the
// viewer themselves when they're the owner, so the developer isn't a "watcher".
const spaceScene = (slug: string) => 'main/players/space:' + slug

export async function GET(req: NextRequest) {
  const slug = new URL(req.url).searchParams.get('slug')?.trim() || null
  try {
    await ensureTable()
    await prisma.$executeRawUnsafe(`DELETE FROM cc_presence WHERE seen < now() - interval '30 seconds'`)
    const rows = await prisma.$queryRawUnsafe<{ scene: string; n: bigint }[]>(
      `SELECT scene, count(*) AS n FROM cc_presence GROUP BY scene`)
    const counts: Record<string, number> = {}
    for (const r of rows) counts[r.scene] = Number(r.n)
    if (slug) {
      // developer live = the AI builder dock (ai:<slug>) OR the owner present (dev:<slug>)
      const dev = await prisma.$queryRawUnsafe<{ live: boolean }[]>(
        `SELECT EXISTS(SELECT 1 FROM cc_presence WHERE id IN ($1, $2)) AS live`, 'ai:' + slug, 'dev:' + slug)
      const spec = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM cc_presence WHERE scene = $1 AND id NOT LIKE 'ai:%'`, spaceScene(slug))
      return NextResponse.json({ counts, slug, devLive: !!dev[0]?.live, present: Number(spec[0]?.n ?? 0) })
    }
    // No slug → the HUB read: which worlds have a developer on them right now (an AI
    // builder ai:<slug> OR the owner present dev:<slug>), so the directory can pulse
    // a "developer live" ring + DEV chip on their bubbles. Both ids carry the slug
    // after the prefix; the hub bubble keys off launch `space:<slug>`.
    const dl = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM cc_presence WHERE id LIKE 'ai:%' OR id LIKE 'dev:%'`)
    return NextResponse.json({ counts, devLive: [...new Set(dl.map(r => r.id.slice(r.id.indexOf(':') + 1)))] })
  } catch {
    memSweep()
    const counts: Record<string, number> = {}
    for (const [scene, people] of mem) counts[scene] = people.size
    if (slug) {
      const devLive = [...mem.values()].some(people => people.has('ai:' + slug) || people.has('dev:' + slug))
      let present = 0
      for (const [id] of mem.get(spaceScene(slug)) ?? []) if (!id.startsWith('ai:')) present++
      return NextResponse.json({ counts, slug, devLive: !!devLive, present })
    }
    const live = new Set<string>()
    for (const people of mem.values()) for (const id of people.keys()) if (id.startsWith('ai:') || id.startsWith('dev:')) live.add(id.slice(id.indexOf(':') + 1))
    return NextResponse.json({ counts, devLive: [...live] })
  }
}

export async function POST(req: NextRequest) {
  let body: { scene?: unknown; id?: unknown; leave?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad beat' }, { status: 400 }) }
  const { scene, id, leave } = body
  if (typeof id !== 'string' || id.length > 64) {
    return NextResponse.json({ error: 'bad beat' }, { status: 400 })
  }
  // RESERVED prefixes (audit F7): ai:<slug> is written server-side by the
  // bridge; a public beat wearing it fakes the 'developer live' badge (and a
  // spoofed leave kicks the real marker). dev:<slug> takes a signed-in session.
  if (id.startsWith('ai:')) {
    return NextResponse.json({ error: 'reserved presence id' }, { status: 403 })
  }
  if (id.startsWith('dev:')) {
    const { getServerSession } = await import('next-auth')
    const { authOptions } = await import('@/lib/auth')
    if (!(await getServerSession(authOptions))?.user?.email) {
      return NextResponse.json({ error: 'reserved presence id' }, { status: 403 })
    }
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
      // durable playtime rides the SAME beat — best-effort, isolated so a failure
      // (or the table not existing yet) can never break the occupancy heartbeat
      try { await accruePlaytime(id, scene as string, req) } catch { /* playtime is analytics, not a gate */ }
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
