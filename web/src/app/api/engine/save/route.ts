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
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const envToken = process.env.ENGINE_AGENT_TOKEN
    if (envToken && authHeader.slice(7) === envToken) return true
  }
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

/**
 * GET /api/engine/save?slot=xxx     — read a save slot
 * GET /api/engine/save?action=list  — list all slots
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  if (searchParams.get('action') === 'list') {
    return NextResponse.json({ slots: await listGameSlots() })
  }
  const slot = searchParams.get('slot')
  if (!slot) return NextResponse.json({ error: 'slot or action=list required' }, { status: 400 })
  const data = await loadGameSlot(slot)
  return NextResponse.json({ slot, data: data ?? null })
}

/** POST /api/engine/save  Body: { slot: string, data: unknown } */
/** The cafe's shared bubble universe: one layout, live for all players —
 *  anonymous browsers publish it too, so this single slot is writable
 *  without a session, but only when the payload is exactly the expected
 *  shape (a small map of named positions). */
function isPublicUniverseWrite(body: { slot?: unknown; data?: unknown }): boolean {
  if (body.slot !== 'cafe:universe') return false
  const d = body.data as { v?: unknown; at?: unknown; bubbles?: unknown } | null
  if (!d || d.v !== 1 || typeof d.at !== 'number' || !d.bubbles || typeof d.bubbles !== 'object') return false
  const bubbles = d.bubbles as Record<string, { x?: unknown; y?: unknown; born?: unknown }>
  const names = Object.keys(bubbles)
  if (names.length > 80) return false
  for (const n of names) {
    const b = bubbles[n]
    if (n.length > 80 || !b || typeof b.x !== 'number' || typeof b.y !== 'number' ||
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
      await saveGameSlot(body.slot, body.data)
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
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return false
  const envToken = process.env.ENGINE_AGENT_TOKEN
  return !!envToken && authHeader.slice(7) === envToken
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
