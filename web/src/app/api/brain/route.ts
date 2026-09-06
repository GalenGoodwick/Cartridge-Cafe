import { NextRequest, NextResponse } from 'next/server'
import { think, brainDirective } from '@/lib/worldbrain'

export const dynamic = 'force-dynamic'

/** THE IMAGINATION BRAIN, reachable by a connecting AI or the ◧ BRAIN panel.
 *  A CHOSEN helper (never a gate). It threads in excellent authors matched to
 *  the concept's themes and returns the PHYSICS their words encode, a node
 *  plan, the coherence grammar, and a ready build directive.
 *
 *  It feeds the ONE HELD communal brain (a Railway service) and reads its hot
 *  communal state on top of the local, deterministic read — so using the panel
 *  or the endpoint warms the shared brain for everyone. If the held brain is
 *  unreachable, it degrades cleanly to the local read alone.
 *
 *  GET  /api/brain?concept=…&writer=…
 *  POST /api/brain   {"concept":"…","writer":"…"}
 */
const BRAIN_URL = process.env.CAFE_BRAIN_URL || 'https://cartridge-brain-production.up.railway.app'

async function heldRead(concept: string, writer: string) {
  // 9s tolerates a Railway cold-start: the brain SLEEPS when idle to save
  // compute (state survives on its /data volume), so the first call after idle
  // waits for the wake rather than falling back to the local read.
  const j = (path: string, body?: unknown) => fetch(BRAIN_URL + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(9000),
    cache: 'no-store',
  })
  // calling the endpoint IS the opt-in to think onto the shared brain
  await j('/consent', { writer, decision: 'allow' })
  await j('/ink', { writer, concept })
  const r = await j('/read')
  if (!r.ok) throw new Error('read ' + r.status)
  return r.json() as Promise<{ champion: string; warm_motifs: string[]; node_plan: string[]; physics_hints: string[]; themes_hot_now: string[]; active_writers: string[] }>
}

async function respond(concept: string, writer: string) {
  const c = (concept || '').trim()
  if (!c) {
    return NextResponse.json({
      error: 'stream a fragment of your coded imagination — a form, a material, a motion, the light; ink it and read the champion back, then stream the next',
      example: '/api/brain?concept=brushed-steel revolving door, chamfered mullions, one cold overhead light, glass fresnel, wings turning at 0.2rad/s&writer=you',
    }, { status: 400 })
  }
  const local = think(c)                       // deterministic gift: authors, physics, plan, grammar
  let held: Awaited<ReturnType<typeof heldRead>> | null = null
  try { held = await heldRead(c, writer || 'cafe-anon') } catch { /* held brain down — local still stands */ }

  return NextResponse.json({
    ...local,
    directive: brainDirective(local),
    held: !!held,
    communal: held ? {
      champion: held.champion,
      warmMotifs: held.warm_motifs,
      nodePlan: held.node_plan,
      physics: held.physics_hints,
      heatThemes: held.themes_hot_now,
      activeWriters: held.active_writers,
    } : null,
    note: held
      ? 'you thought this onto the shared cartridge brain — the communal block is its current hot state; build under the physics + grammar and it reads as one coherent world'
      : 'chosen guidance, not a gate — build under the physics + grammar; the shared brain is momentarily unreachable so this is the local read',
  })
}

export async function GET(req: NextRequest) {
  const { ipThrottled } = await import('@/lib/ip-throttle')
  if (ipThrottled(req, 'brain', 12)) return NextResponse.json({ error: 'slow down' }, { status: 429 })
  return respond(req.nextUrl.searchParams.get('concept') || '', req.nextUrl.searchParams.get('writer') || '')
}

export async function POST(req: NextRequest) {
  const { ipThrottled } = await import('@/lib/ip-throttle')
  if (ipThrottled(req, 'brain', 12)) return NextResponse.json({ error: 'slow down' }, { status: 429 })
  let body: { concept?: string; writer?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  return respond(body.concept || '', body.writer || '')
}
