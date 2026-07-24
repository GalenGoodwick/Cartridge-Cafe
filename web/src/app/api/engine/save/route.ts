import { isAdminToken } from '@/lib/adminAuth'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { saveGameSlot, loadGameSlot, listGameSlots, deleteGameSlot } from '../store'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export const dynamic = 'force-dynamic'

/** Every slot deletion — dev or prod — lands in quarantine-log.json, the same
 *  ledger the renderer's hazard screens report to, so a wiped slot is never
 *  silent: a human sees it in the log file, an AI reads it via
 *  GET /api/engine/quarantine. Deletion is rare and destructive; the record
 *  must outlive the caller. Fire-and-forget: logging must never block a delete. */
function recordDeletion(slot: string, deleted: boolean, via: string): void {
  console.warn(`[save] DELETE slot='${slot}' deleted=${deleted} via=${via}`)
  try {
    const logPath = join(process.cwd(), 'quarantine-log.json')
    let log: unknown[] = []
    try { log = JSON.parse(readFileSync(logPath, 'utf-8')) as unknown[] } catch { /* fresh log */ }
    log.push({
      at: new Date().toISOString(),
      phase: 'slot-delete',
      hazards: [{ name: slot, reason: `slot ${deleted ? 'deleted' : 'delete attempted (did not exist)'} via ${via}` }],
    })
    if (log.length > 100) log = log.slice(-100)
    writeFileSync(logPath, JSON.stringify(log, null, 2))
  } catch { /* the delete already happened; a logging failure must not 500 it */ }
}

/** Same posture as the scene route: dev keeps the frictionless local workflow;
 *  production requires a session or the engine agent token. */
async function writeAllowed(req: NextRequest): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production') return true
  if (isAdminToken(req.headers.get('authorization'))) return true
  const session = await getServerSession(authOptions)
  return !!session?.user?.email
}

type Ban = { until: number; name?: string; by?: string }
type SubEntry = { name?: string; ownerId?: string; ownerName?: string; founded?: number; pinsLocked?: boolean; members?: Record<string, string>; shelf?: Record<string, unknown>; admins?: string[]; bans?: Record<string, Ban> }
type SubDoc = { v?: number; subs?: Record<string, SubEntry> }

/** The group registry (submains:index) is a shared last-write-wins doc, but the
 *  server is the authority on OWNERSHIP: a write may only make changes the
 *  writer is entitled to. Blocks the "rewrite everyone's groups" hole while
 *  keeping the collaborative flow (found your own · join/leave yourself · a
 *  member pins · the owner edits their group). Returns true if the delta is legal. */
function validateSubmainsWrite(prevRaw: unknown, nextRaw: unknown, userId: string | null): boolean {
  const next = nextRaw as SubDoc | null
  if (!next || next.v !== 1 || !next.subs || typeof next.subs !== 'object') return false
  if (!userId) return false
  const prev = (prevRaw as SubDoc | null)?.subs && (prevRaw as SubDoc).v === 1 ? (prevRaw as SubDoc).subs! : {}
  const nextSubs = next.subs
  const now = Date.now()
  const j = (v: unknown) => JSON.stringify(v ?? null)

  for (const slug of Object.keys(nextSubs)) {
    const g = nextSubs[slug]
    if (!g || typeof g.ownerId !== 'string') return false
    const before = prev[slug]
    if (!before) {
      if (g.ownerId !== userId) return false            // found only for yourself
      // a fresh group can't pre-bake foreign admins or any bans (co-dev sub-mains
      // are spawned through a privileged server path, not a browser save)
      if ((g.admins || []).some(a => a !== userId)) return false
      if (g.bans && Object.keys(g.bans).length) return false
      continue
    }
    if (g.ownerId !== before.ownerId || g.founded !== before.founded) return false  // ownership/birth immutable

    // the unkickable set = founder + admins. A moderator is anyone in it.
    const mods = new Set<string>([before.ownerId!, ...((before.admins as string[]) || [])])
    const isMod = mods.has(userId)

    // the admin roster is the OWNER's to set — no one else, not even another admin
    if (j(g.admins || []) !== j(before.admins || []) && before.ownerId !== userId) return false

    // an admin can never be kicked (removed from members) or banned — by ANYONE, incl. the owner
    for (const u of mods) {
      if (!g.members || !g.members[u]) return false
      if (g.bans && g.bans[u]) return false
    }

    // the ban list is moderator-only to touch
    if (j(g.bans || {}) !== j(before.bans || {}) && !isMod) return false

    if (isMod) continue   // founder/admin: full latitude on the rest (invariants above already held)

    // ── a non-moderator ── metadata frozen; may pin (member + unlocked) and join/leave self
    if (g.name !== before.name || g.pinsLocked !== before.pinsLocked || g.ownerName !== before.ownerName) return false
    const isMember = !!(before.members && before.members[userId])
    if (j(g.shelf || {}) !== j(before.shelf || {}) && !(isMember && !before.pinsLocked)) return false
    const mk = new Set([...Object.keys(before.members || {}), ...Object.keys(g.members || {})])
    for (const k of mk) {
      if (k === userId) continue                        // add/remove only YOURSELF
      if ((before.members || {})[k] !== (g.members || {})[k]) return false
    }
    // a live ban blocks re-joining
    if (g.members?.[userId] && !before.members?.[userId]) {
      const b = before.bans?.[userId]
      if (b && b.until > now) return false
    }
  }
  // a group may only be dissolved by its owner
  for (const slug of Object.keys(prev)) {
    if (!nextSubs[slug] && prev[slug].ownerId !== userId) return false
  }
  return true
}

/** Game saves are PER-PLAYER: the server — not a client-supplied string — decides
 *  whose save a slot is. A signed-in or guest session keys the slot by its user id
 *  (spoof-proof: a client can't read another player's save by guessing a name); a
 *  session-less browser falls back to a per-browser anon token it supplies (unique
 *  per browser, so still never a shared slot). Callers opt in with `scope=user`.
 *  Without it the slot is shared as before (tournaments, the group registry, chat).
 *  This is what keeps one player's save out of everyone else's. */
async function userScopedSlot(slot: string, anon: string | null): Promise<string | null> {
  const uid = (await getServerSession(authOptions))?.user?.id
  if (uid) return `usr:${uid}:${slot}`
  // A guest per-player save needs a STRONG per-browser token. The old code fell
  // back to `usr:anon-x:` when the token was empty/short — so every private-mode
  // guest (no localStorage) AND colliding short tokens shared ONE bucket and read
  // each other's saves. Refuse to scope on a weak token: no leak, just no save.
  const tok = (anon || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)
  if (tok.replace(/^anon-?/i, '').length < 8) return null
  return `usr:${tok}:${slot}`
}

/**
 * GET /api/engine/save?slot=xxx               — read a shared save slot
 * GET /api/engine/save?slot=xxx&scope=user    — read THIS player's slot (per-user)
 * GET /api/engine/save?action=list            — list all slots
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  if (searchParams.get('action') === 'list') {
    return NextResponse.json({ slots: await listGameSlots() })
  }
  const slot = searchParams.get('slot')
  if (!slot) return NextResponse.json({ error: 'slot or action=list required' }, { status: 400 })
  const key = searchParams.get('scope') === 'user'
    ? await userScopedSlot(slot, searchParams.get('anon'))
    : slot
  if (key === null) return NextResponse.json({ slot, data: null, unscoped: true })  // weak guest token → no shared bucket
  const data = await loadGameSlot(key)
  return NextResponse.json({ slot, data: data ?? null })
}

/** POST /api/engine/save  Body: { slot: string, data: unknown } */
/** The cafe's shared bubble universe: one layout per mode, live for all players
 *  — anonymous browsers publish it too, so these slots are writable without a
 *  session, but ONLY when the payload is exactly the expected shape (a small map
 *  of named positions). Covers main (`cafe:universe`) AND the per-mode variants
 *  the door scene actually writes: MY WORLDS (`cafe:universe:mine:<uid>`) and
 *  SUB-MAIN (`cafe:universe:<key>`) — so those stop flying in on every visit.
 *  Positions self-heal on the next settle, so a stray write can't do harm. */
function isPublicUniverseWrite(body: { slot?: unknown; data?: unknown }): boolean {
  const slot = body.slot
  if (typeof slot !== 'string' || !(slot === 'cafe:universe' || slot.startsWith('cafe:universe:'))) return false
  const d = body.data as { v?: unknown; at?: unknown; bubbles?: unknown } | null
  // the scene writes v2 now (was v1); accept both so old and new clients persist
  if (!d || (d.v !== 1 && d.v !== 2) || typeof d.at !== 'number' || !d.bubbles || typeof d.bubbles !== 'object') return false
  const bubbles = d.bubbles as Record<string, { x?: unknown; y?: unknown; born?: unknown }>
  const names = Object.keys(bubbles)
  if (names.length > 120) return false
  for (const n of names) {
    const b = bubbles[n]
    if (n.length > 120 || !b || typeof b.x !== 'number' || typeof b.y !== 'number' ||
        !isFinite(b.x) || !isFinite(b.y) || (b.born !== undefined && typeof b.born !== 'number')) return false
  }
  return true
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!isPublicUniverseWrite(body) && !(await writeAllowed(req))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (typeof body.slot === 'string' && 'data' in body) {
      // the group registry is ownership-enforced: a write may only change what
      // the writer owns (found your own, join/leave/pin as yourself, edit your
      // group) — never rewrite the whole registry to seize others' groups
      if (body.slot === 'submains:index' && process.env.NODE_ENV === 'production') {
        const userId = (await getServerSession(authOptions))?.user?.id ?? null
        const prev = await loadGameSlot('submains:index')
        if (!validateSubmainsWrite(prev, body.data, userId)) {
          return NextResponse.json({ error: 'Not authorized to change groups you do not own' }, { status: 403 })
        }
      }
      // per-player game saves are namespaced by the SERVER's idea of who you are,
      // never the client's — so a player's save can't land in another's slot
      const key = body.scope === 'user'
        ? await userScopedSlot(body.slot, typeof body.anon === 'string' ? body.anon : null)
        : body.slot
      if (key === null) return NextResponse.json({ ok: true, saved: false, unscoped: true })  // weak guest token → drop, don't pool
      await saveGameSlot(key, body.data)
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'slot and data required' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}

/** DELETE /api/engine/save  Body: { slot: string }
 *  Deleting is destructive in a way writing isn't — slots are shared live
 *  state (tournaments, the group registry, the universe layout) and no browser
 *  flow deletes them. So unlike POST, a session is NOT enough in production:
 *  only the engine agent token may delete. Dev stays frictionless. */
async function deleteAllowed(req: NextRequest): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production') return true
  return isAdminToken(req.headers.get('authorization'))
}

export async function DELETE(req: NextRequest) {
  if (!(await deleteAllowed(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const body = await req.json()
    if (typeof body.slot === 'string') {
      const deleted = await deleteGameSlot(body.slot)
      recordDeletion(body.slot, deleted, process.env.NODE_ENV !== 'production' ? 'dev' : 'agent-token')
      return NextResponse.json({ ok: true, deleted })
    }
    return NextResponse.json({ error: 'slot required' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}
