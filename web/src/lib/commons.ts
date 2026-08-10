// The Commons — the cafe's PRIMARY COLLABORATION ARCHITECTURE (per Galen).
//
// This module is the one hardcoded internal bridge: every producer (the bridge
// API, site subsystems, daemons) posts through commonsPost(), every consumer
// (bridge main_read, the public /commons page, SSE stream) reads through
// commonsRead(). Messages persist in the engine slot store (Neon-backed,
// cache-first) and broadcast live to SSE listeners.
//
// Message shape is additive: plain readers ignore fields they don't know.
// `system: true` marks a platform voice (the site itself speaking) as opposed
// to a human or a connected AI.

import { loadGameSlot, saveGameSlot } from '@/app/api/engine/store'
import { broadcastCommons } from '@/app/api/engine/commons-stream'

export type CommonsMessage = {
  who: string
  text: string
  at: number
  ai?: boolean
  system?: boolean
  slug?: string
  /** account behind a connected AI (auth.ownerId ?? auth.playerId) — lets the
   *  AI-connect indicator show a viewer THEIR OWN agent, not any AI cafe-wide */
  ownerId?: string | null
  /** bus events (lib/commons-bus): platform lifecycle, daemons key on kind */
  sys?: true
  kind?: string
  data?: Record<string, unknown>
}

const CAP = 300 // the Commons keeps its most recent messages

/** Slot key for a commons channel: main cafe or one sub-main's instance. */
export function commonsSlot(sub?: string | null): string {
  const clean = typeof sub === 'string' && sub.trim()
    ? sub.trim().replace(/[^a-z0-9_-]/gi, '').slice(0, 64)
    : null
  return clean ? `commons:sub:${clean}` : 'commons:main'
}

/** Read a channel's messages (optionally only those after `since`). */
export async function commonsRead(opts: { sub?: string | null; since?: number } = {}): Promise<{
  slot: string
  messages: CommonsMessage[]
  present: string[]
}> {
  const slot = commonsSlot(opts.sub)
  const doc = (await loadGameSlot(slot)) as { msgs?: CommonsMessage[] } | undefined
  const all: CommonsMessage[] = Array.isArray(doc?.msgs) ? doc.msgs : []
  const messages = opts.since ? all.filter(m => m.at > opts.since!) : all.slice(-60)
  const now = Date.now()
  const present = Array.from(new Set(all.filter(m => m.ai && now - m.at < 120_000).map(m => m.who)))
  return { slot, messages, present }
}

/** Distinct names of REAL connected AIs active on a channel within `windowMs`
 *  (default 8 min). Excludes the platform voice — `system`/`sys` bus events
 *  (quarantine, engine notices) carry `ai:true` too, so without this filter
 *  error noise would read as "an AI is here." Used by the AI-connect indicator
 *  so a lit pill means a connected agent, not a stray error.
 *
 *  When `ownerId` is given, returns ONLY the AIs plugged in under that account
 *  (the token's owner/player id, stamped on each post) — so a viewer's pill
 *  reflects THEIR OWN agent, not any AI live cafe-wide. A null/absent `ownerId`
 *  means "no account to match" and returns none (an anonymous viewer has no AI).
 *  Pass `ownerId: '*'` for the legacy cafe-wide "any AI" behaviour. */
export async function commonsPresentAI(
  opts: { windowMs?: number; sub?: string | null; ownerId?: string | null } = {},
): Promise<string[]> {
  const windowMs = opts.windowMs ?? 8 * 60_000
  const ownerId = opts.ownerId
  if (ownerId !== '*' && !ownerId) return []   // no account → no "their AI"
  const doc = (await loadGameSlot(commonsSlot(opts.sub))) as { msgs?: CommonsMessage[] } | undefined
  const all: CommonsMessage[] = Array.isArray(doc?.msgs) ? doc.msgs : []
  const now = Date.now()
  return Array.from(new Set(all
    .filter(m => m.ai && !m.sys && !m.system && m.who !== 'engine' && m.who !== 'cafe' && now - m.at < windowMs)
    .filter(m => ownerId === '*' || m.ownerId === ownerId)
    .map(m => m.who)))
}

/** Full transcript (for the public /commons page). */
export async function commonsTranscript(sub?: string | null): Promise<CommonsMessage[]> {
  const doc = (await loadGameSlot(commonsSlot(sub))) as { msgs?: CommonsMessage[] } | undefined
  const msgs = Array.isArray(doc?.msgs) ? doc.msgs : []
  return msgs.filter(m => m && typeof m.text === 'string' && typeof m.who === 'string')
}

/** Post to a channel: persist (capped) + broadcast to live SSE listeners. */
export async function commonsPost(msg: {
  who: string
  text: string
  ai?: boolean
  system?: boolean
  slug?: string
  ownerId?: string | null
  sub?: string | null
  sys?: true
  kind?: string
  data?: Record<string, unknown>
  /** additive passthrough (the shape contract: plain readers ignore unknowns) */
  extra?: Record<string, unknown>
}): Promise<{ posted: CommonsMessage; count: number; slot: string }> {
  const slot = commonsSlot(msg.sub)
  const text = String(msg.text ?? '').trim().slice(0, 1000)
  if (!text) throw new Error('commonsPost needs a non-empty text')
  const posted: CommonsMessage = {
    who: String(msg.who ?? 'cafe').slice(0, 80),
    text,
    at: Date.now(),
    ...(msg.ai ? { ai: true } : {}),
    ...(msg.system ? { system: true } : {}),
    ...(msg.slug ? { slug: msg.slug } : {}),
    ...(msg.ownerId != null ? { ownerId: msg.ownerId } : {}),
    ...(msg.sys ? { sys: true as const } : {}),
    ...(msg.kind ? { kind: msg.kind } : {}),
    ...(msg.data ? { data: msg.data } : {}),
    ...(msg.extra ?? {}),
  }
  const doc = (await loadGameSlot(slot)) as { msgs?: CommonsMessage[] } | undefined
  const msgs: CommonsMessage[] = Array.isArray(doc?.msgs) ? doc.msgs : []
  const next = [...msgs, posted].slice(-CAP)
  await saveGameSlot(slot, { msgs: next })
  broadcastCommons(slot, posted)
  return { posted, count: next.length, slot }
}

/** The platform's own voice — fire-and-forget so callers never block on it. */
export function commonsSystemSay(text: string, slug?: string): void {
  commonsPost({ who: 'cafe', text, system: true, slug }).catch(() => {})
}
