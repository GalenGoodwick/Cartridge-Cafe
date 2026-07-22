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
  sub?: string | null
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
