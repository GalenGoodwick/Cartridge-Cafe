import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { loadGameSlot, saveGameSlot } from '../store'

export const dynamic = 'force-dynamic'

// Server-authoritative play time — the substrate for XP and the Vote's factory
// order. It gates a violation and, ultimately, account deletion, so it can NEVER
// live in client storage the player can edit. The client sends a heartbeat while
// genuinely playing; the server accrues a FIXED amount per beat and rate-limits
// how often a beat counts, so a spammed heartbeat can't inflate time.
type PT = { total: number; worlds: Record<string, number>; last: number; xp?: number }

const BEAT_MS = 10_000        // client heartbeats ~every 10s
const MIN_GAP = 8_000         // a beat only counts if ≥8s since the last — anti-spam
const GRANT = 10              // seconds granted per valid beat

function xpOf(totalSec: number): number { return Math.min(60, Math.floor(totalSec / 60)) }  // XP caps at 60

async function read(userId: string): Promise<PT> {
  const d = (await loadGameSlot('playtime:' + userId)) as PT | undefined
  return d && typeof d.total === 'number' ? d : { total: 0, worlds: {}, last: 0 }
}

/** GET — this player's play time + XP (0–60) + per-world breakdown. */
export async function GET() {
  const session = await getServerSession(authOptions)
  const uid = session?.user?.id
  if (!uid) return NextResponse.json({ total: 0, xp: 0, worlds: {}, anon: true })
  const pt = await read(uid)
  return NextResponse.json({ total: pt.total, xp: xpOf(pt.total), worlds: pt.worlds })
}

/** POST { world } — a heartbeat from a live, playing tab. Accrues server-side. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const uid = session?.user?.id
  if (!uid) return NextResponse.json({ ok: false, anon: true })   // anon play doesn't accrue — voting needs an account
  try {
    const { world } = await req.json()
    if (!world || typeof world !== 'string' || world === 'CAFE' || world === 'SUB-MAIN') {
      return NextResponse.json({ ok: false })   // hubs aren't play
    }
    const pt = await read(uid)
    const now = Date.now()
    // rate-limit: a beat older than MIN_GAP since the last counts; anything faster
    // is dropped, so you can't spam beats to farm time. Cap a huge gap (idle/return)
    // so a tab left open then refocused can't dump a windfall.
    if (now - pt.last >= MIN_GAP && now - pt.last <= BEAT_MS * 3) {
      pt.total += GRANT
      pt.worlds[world] = (pt.worlds[world] || 0) + GRANT
    }
    pt.last = now
    await saveGameSlot('playtime:' + uid, pt)
    return NextResponse.json({ ok: true, total: pt.total, xp: xpOf(pt.total) })
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
}
