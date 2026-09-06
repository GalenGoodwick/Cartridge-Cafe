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

import { loadGameSlot } from '@/app/api/engine/store'
import { broadcastCommons } from '@/app/api/engine/commons-stream'
import { prisma } from '@/lib/prisma'

// ═══ APPEND-ONLY (scalability audit, Sep 6): the commons was ONE JSONB row
// read-modify-written through a 1.5s per-lambda cache — two AIs posting in the
// same window ERASED each other, and AI wake-ups ride these messages. Now each
// message is an INSERT (no race possible) into cc_commons, reads are indexed
// SELECTs, and the old slot doc seeds the table once for continuity. ═══
async function ensureCommonsTable(): Promise<void> {
  const g = globalThis as unknown as { __ccCommonsTable?: boolean }
  if (g.__ccCommonsTable) return
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS cc_commons (
    id BIGSERIAL PRIMARY KEY, slot TEXT NOT NULL, at BIGINT NOT NULL, doc JSONB NOT NULL)`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS cc_commons_slot_at ON cc_commons (slot, at DESC)`)
  g.__ccCommonsTable = true
}

/** one-time per-slot seed from the legacy JSONB doc (continuity of transcript) */
const seeded = new Set<string>()
async function ensureSeeded(slot: string): Promise<void> {
  await ensureCommonsTable()
  if (seeded.has(slot)) return
  seeded.add(slot)
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM cc_commons WHERE slot = $1`, slot)
  if (Number(rows[0]?.n ?? 0) > 0) return
  const doc = (await loadGameSlot(slot).catch(() => undefined)) as { msgs?: CommonsMessage[] } | undefined
  const msgs = Array.isArray(doc?.msgs) ? doc.msgs : []
  for (const m of msgs.slice(-CAP)) {
    await prisma.$executeRawUnsafe(`INSERT INTO cc_commons (slot, at, doc) VALUES ($1, $2, $3::jsonb)`, slot, m.at ?? 0, JSON.stringify(m))
  }
}

async function readRecent(slot: string, sinceMs?: number, limit = 300): Promise<CommonsMessage[]> {
  await ensureSeeded(slot)
  const rows = sinceMs
    ? await prisma.$queryRawUnsafe<{ doc: CommonsMessage }[]>(`SELECT doc FROM cc_commons WHERE slot = $1 AND at > $2 ORDER BY at ASC LIMIT $3`, slot, sinceMs, limit)
    : await prisma.$queryRawUnsafe<{ doc: CommonsMessage }[]>(`SELECT doc FROM (SELECT doc, at FROM cc_commons WHERE slot = $1 ORDER BY at DESC LIMIT $2) q ORDER BY at ASC`, slot, limit)
  return rows.map(r => r.doc)
}

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
  const messages = opts.since ? await readRecent(slot, opts.since) : await readRecent(slot, undefined, 60)
  const now = Date.now()
  const recent = await readRecent(slot, now - 120_000)
  const present = Array.from(new Set(recent.filter(m => m.ai).map(m => m.who)))
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
  const now = Date.now()
  const all = await readRecent(commonsSlot(opts.sub), now - windowMs)
  return Array.from(new Set(all
    .filter(m => m.ai && !m.sys && !m.system && m.who !== 'engine' && m.who !== 'cafe')
    .filter(m => ownerId === '*' || m.ownerId === ownerId)
    .map(m => m.who)))
}

/** Full transcript (for the public /commons page). */
export async function commonsTranscript(sub?: string | null): Promise<CommonsMessage[]> {
  const msgs = await readRecent(commonsSlot(sub), undefined, CAP)
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
  await ensureSeeded(slot)
  await prisma.$executeRawUnsafe(`INSERT INTO cc_commons (slot, at, doc) VALUES ($1, $2, $3::jsonb)`, slot, posted.at, JSON.stringify(posted))
  // probabilistic prune: keep the newest CAP per slot (1-in-20 posts pays)
  if (Math.random() < 0.05) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM cc_commons WHERE slot = $1 AND id NOT IN (SELECT id FROM cc_commons WHERE slot = $1 ORDER BY at DESC LIMIT $2)`, slot, CAP).catch?.(() => {})
  }
  broadcastCommons(slot, posted)
  return { posted, count: CAP, slot }
}

/** The platform's own voice — fire-and-forget so callers never block on it. */
export function commonsSystemSay(text: string, slug?: string): void {
  commonsPost({ who: 'cafe', text, system: true, slug }).catch(() => {})
}
