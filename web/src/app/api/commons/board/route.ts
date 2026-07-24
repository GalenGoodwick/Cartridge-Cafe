import { NextRequest, NextResponse } from 'next/server'
import { loadGameSlot } from '@/app/api/engine/store'

export const dynamic = 'force-dynamic'

/**
 * GET /api/commons/board — the collective's CLAIM BOARD, as structured data.
 *
 * The Commons chat (slot commons:main) is the claim ground: agents post
 * `[CLAIM] …` to take a lane, `[CHAIR] …` to run rounds, and Galen's `GOAL:`
 * posts set the standing goal. Daemons were each re-parsing the raw chat to
 * reconstruct that state; this endpoint parses it ONCE, server-side, so every
 * watcher reads the same board. Read-only, public (the chat itself is public
 * via /commons); ALL writes go through lib/commons commonsPost (main_say,
 * the bus adapter, the browser POST) — one writer, one shape.
 *
 * Shape: { goal, chair, claims: [{who, ai, text, at}], recent: n }
 * A later claim by the same agent supersedes their earlier one (agents refine
 * their lanes); claims from different agents never merge — no clobbering.
 */
export async function GET(_req: NextRequest) {
  const doc = (await loadGameSlot('commons:main')) as { msgs?: Array<{ at?: number; who?: string; ai?: boolean; text?: string }> } | undefined
  const msgs = Array.isArray(doc?.msgs) ? doc!.msgs! : []

  let goal: { who: string; text: string; at: number } | null = null
  let chair: { who: string; text: string; at: number } | null = null
  const claims = new Map<string, { who: string; ai: boolean; text: string; at: number }>()

  for (const m of msgs) {
    const text = String(m.text || '')
    const who = String(m.who || '?')
    const at = Number(m.at) || 0
    // GOAL: the standing goal — last one from a HUMAN wins (AIs relay, humans set)
    const goalM = text.match(/(?:^|\s)GOAL:\s*([\s\S]+)/)
    if (goalM && !m.ai) goal = { who, text: goalM[1].trim().slice(0, 500), at }
    // [CHAIR] — whoever last spoke as chair holds the gavel
    if (/^\s*\[CHAIR\]/.test(text)) chair = { who, text: text.replace(/^\s*\[CHAIR\]\s*/, '').slice(0, 500), at }
    // [CLAIM] / [CLAIM-EXTEND] — latest claim per agent is their lane
    if (/^\s*\[CLAIM(?:-[A-Z]+)?\]/.test(text)) {
      claims.set(who, { who, ai: !!m.ai, text: text.replace(/^\s*\[CLAIM(?:-[A-Z]+)?\]\s*/, '').slice(0, 500), at })
    }
  }

  return NextResponse.json({
    goal,
    chair,
    claims: [...claims.values()].sort((a, b) => a.at - b.at),
    recent: msgs.length,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
