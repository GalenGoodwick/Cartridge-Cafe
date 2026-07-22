// SEMANTIC REGIONS + SUMMON + WATCHERS — the swarm coordination layer.
//
// The cafe's build model used to be ONE builder per world (the claim-lock in
// bridge/route.ts). This lets MANY AIs work one live world at once by carving
// the 512×512 canvas into CONCEPT regions ("the dunes", "the sky") or step-hook
// claims. An AI claims a region; the bridge runs a smart overlap check against
// everyone else's accepted claims; a clean claim is auto-accepted, an
// overlapping one is CONTESTED and pinged to the peer who already holds that
// ground — the peer decides accept/reject (AI-to-AI negotiation, no human gate).
//
// All state rides the same KV (loadGameSlot/saveGameSlot) as world-chat and the
// build console — no schema, works on Vercel serverless. Slots:
//   regions:<spaceId>   → { seq, claims: RegionClaim[] }
//   summons:open        → { musters: Muster[] }           (platform-wide)
//   watchers:<spaceId>  → { watchers: Watcher[] }
import { loadGameSlot, saveGameSlot } from './store'
import { broadcastCommons, commonsListenerCount } from './commons-stream'
import { prisma } from '@/lib/prisma'
import { sendPushToUser } from '@/lib/push'
import crypto from 'crypto'

export interface Box { x: number; y: number; w: number; h: number }
export interface RegionClaim {
  id: string
  holder: string            // sha256(token).slice(0,16) — the AI's build identity
  who: string               // display name / slug
  concept: string           // what this region IS ("the dunes")
  kind: 'region' | 'hook'
  box: Box | null           // region kind: a rect in 0..512
  hookId: string | null     // hook kind: the step-hook id claimed
  status: 'accepted' | 'contested' | 'rejected' | 'withdrawn'
  contestedWith: string[]   // ids of the accepted claims this one overlaps
  note?: string             // peer's counter-note on a rejection
  at: number
  ttl: number               // absolute expiry ms
}
export interface Muster {
  id: string
  world: string             // slug
  spaceId: string | null
  name: string
  brief: string
  from: string
  at: number
  ttl: number
  viewUrl: string
  bridgeUrl: string
}
export interface Watcher {
  holder: string
  who: string
  kind: 'watcher' | 'builder'
  at: number
  lastSeen: number
}

const CLAIM_TTL = 20 * 60_000     // a claim holds 20 min unless refreshed
const MUSTER_TTL = 30 * 60_000    // a summons stays open 30 min
const WATCHER_TTL = 10 * 60_000   // a watcher goes dormant after 10 min silent
// Two region boxes only CONTEST when they overlap by more than this fraction of
// the smaller box — a shared edge or a hair of bleed is "adjacent", not a fight.
const OVERLAP_FRACTION = 0.1

const rid = (p: string) => p + crypto.randomBytes(6).toString('hex')
const now = () => Date.now()

// ---- geometry --------------------------------------------------------------
function intersectionArea(a: Box, b: Box): number {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const r = Math.min(a.x + a.w, b.x + b.w)
  const t = Math.min(a.y + a.h, b.y + b.h)
  const iw = r - x, ih = t - y
  return iw > 0 && ih > 0 ? iw * ih : 0
}
function boxArea(b: Box): number { return Math.max(0, b.w) * Math.max(0, b.h) }
/** The smart overlap test: real conflict = intersection exceeds a tenth of the
 *  SMALLER claim (so a big backdrop and a small prop inside it DO contest, but
 *  two tiles sharing a border don't). Returns the overlap fraction, or 0. */
export function overlapFraction(a: Box, b: Box): number {
  const inter = intersectionArea(a, b)
  if (inter <= 0) return 0
  const smaller = Math.min(boxArea(a), boxArea(b)) || 1
  return inter / smaller
}
function inBox(x: number, y: number, b: Box): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h
}
function clampBox(b: Partial<Box> | undefined): Box | null {
  if (!b) return null
  const n = (v: unknown, d: number) => { const x = Number(v); return Number.isFinite(x) ? x : d }
  const x = Math.max(0, Math.min(512, n(b.x, 0)))
  const y = Math.max(0, Math.min(512, n(b.y, 0)))
  const w = Math.max(1, Math.min(512, n(b.w, 0)))
  const h = Math.max(1, Math.min(512, n(b.h, 0)))
  if (w < 1 || h < 1) return null
  return { x, y, w, h }
}

// ---- region store ----------------------------------------------------------
function regionsSlot(spaceId: string): string { return 'regions:' + spaceId }

/** Live claims only (expired dropped). */
export async function readRegions(spaceId: string): Promise<RegionClaim[]> {
  const doc = (await loadGameSlot(regionsSlot(spaceId))) as { claims?: RegionClaim[] } | undefined
  const t = now()
  return (doc?.claims ?? []).filter(c => c.ttl > t && c.status !== 'withdrawn' && c.status !== 'rejected')
}

async function writeClaims(spaceId: string, claims: RegionClaim[]): Promise<void> {
  await saveGameSlot(regionsSlot(spaceId), { claims: claims.slice(-200) })
}

export interface ClaimResult {
  ok: boolean
  claim?: RegionClaim
  status?: RegionClaim['status']
  conflicts?: Array<{ id: string; concept: string; who: string; holder: string; overlap: number }>
  error?: string
}

/** Propose a claim. Clean → accepted. Overlaps a peer's accepted ground →
 *  contested (the caller pings those holders). Re-claiming your OWN concept
 *  refreshes it in place. */
export async function claimRegion(
  spaceId: string,
  holder: string,
  who: string,
  input: { concept?: unknown; kind?: unknown; box?: Partial<Box>; hookId?: unknown },
): Promise<ClaimResult> {
  const concept = String(input.concept ?? '').trim().slice(0, 80)
  if (!concept) return { ok: false, error: 'a claim needs a `concept` — name WHAT this region is ("the dunes", "the sky")' }
  const kind: 'region' | 'hook' = input.kind === 'hook' ? 'hook' : 'region'
  const box = kind === 'region' ? clampBox(input.box) : null
  const hookId = kind === 'hook' ? String(input.hookId ?? '').trim().slice(0, 80) : null
  if (kind === 'region' && !box) return { ok: false, error: 'a region claim needs a `box` {x,y,w,h} inside the 0..512 grid' }
  if (kind === 'hook' && !hookId) return { ok: false, error: 'a hook claim needs a `hookId`' }

  const all = ((await loadGameSlot(regionsSlot(spaceId))) as { claims?: RegionClaim[] } | undefined)?.claims ?? []
  const t = now()
  const live = all.filter(c => c.ttl > t && c.status !== 'withdrawn' && c.status !== 'rejected')

  // refresh-in-place: same holder + same concept re-claims (moves/renews it)
  const mineIdx = live.findIndex(c => c.holder === holder && c.concept.toLowerCase() === concept.toLowerCase())

  // find conflicts among OTHER holders' accepted claims
  const conflicts: ClaimResult['conflicts'] = []
  for (const c of live) {
    if (c.holder === holder) continue
    if (c.status !== 'accepted') continue
    if (kind === 'hook' && c.kind === 'hook' && c.hookId === hookId) {
      conflicts.push({ id: c.id, concept: c.concept, who: c.who, holder: c.holder, overlap: 1 })
    } else if (kind === 'region' && c.kind === 'region' && box && c.box) {
      const f = overlapFraction(box, c.box)
      if (f > OVERLAP_FRACTION) conflicts.push({ id: c.id, concept: c.concept, who: c.who, holder: c.holder, overlap: Math.round(f * 100) / 100 })
    }
  }

  const status: RegionClaim['status'] = conflicts.length ? 'contested' : 'accepted'
  const claim: RegionClaim = {
    id: mineIdx >= 0 ? live[mineIdx].id : rid('rc_'),
    holder, who, concept, kind, box, hookId, status,
    contestedWith: conflicts.map(c => c.id),
    at: t, ttl: t + CLAIM_TTL,
  }
  const next = mineIdx >= 0
    ? live.map((c, i) => (i === mineIdx ? claim : c))
    : [...live, claim]
  await writeClaims(spaceId, next)
  return { ok: true, claim, status, conflicts }
}

/** A peer whose ground is contested rules on the challenger's claim.
 *  accept → both coexist (challenger becomes accepted). reject → challenger
 *  dropped. Only a holder of one of the contested-with claims may resolve. */
export async function resolveRegion(
  spaceId: string,
  resolverHolder: string,
  claimId: string,
  decision: 'accept' | 'reject',
  note?: string,
): Promise<{ ok: boolean; claim?: RegionClaim; error?: string }> {
  const all = ((await loadGameSlot(regionsSlot(spaceId))) as { claims?: RegionClaim[] } | undefined)?.claims ?? []
  const t = now()
  const target = all.find(c => c.id === claimId)
  if (!target) return { ok: false, error: `no claim ${claimId}` }
  if (target.status !== 'contested') return { ok: false, error: `claim ${claimId} is not contested (it is ${target.status})` }
  // the resolver must own one of the claims this challenger overlaps
  const ownsContested = all.some(c => c.holder === resolverHolder && target.contestedWith.includes(c.id))
  if (!ownsContested) return { ok: false, error: 'only the peer whose region is contested can resolve this claim' }

  target.status = decision === 'accept' ? 'accepted' : 'rejected'
  if (decision === 'accept') { target.contestedWith = []; target.ttl = t + CLAIM_TTL }
  if (note) target.note = String(note).slice(0, 200)
  await writeClaims(spaceId, all)
  return { ok: true, claim: target }
}

/** Withdraw one of your own claims (frees the ground). */
export async function withdrawRegion(spaceId: string, holder: string, claimId: string): Promise<boolean> {
  const all = ((await loadGameSlot(regionsSlot(spaceId))) as { claims?: RegionClaim[] } | undefined)?.claims ?? []
  const c = all.find(x => x.id === claimId && x.holder === holder)
  if (!c) return false
  c.status = 'withdrawn'
  await writeClaims(spaceId, all)
  return true
}

/** Enforcement helper (warn-mode): is point (x,y) inside any accepted claim this
 *  holder owns? Returns null if the holder has NO claims (solo builders are
 *  unaffected), else a warning string when the point is outside their ground. */
export async function regionWarningForPoint(
  spaceId: string, holder: string, x: number, y: number,
): Promise<string | null> {
  const live = await readRegions(spaceId)
  const mine = live.filter(c => c.holder === holder && c.kind === 'region' && c.box)
  if (!mine.length) return null   // not participating in the swarm — no constraint
  if (mine.some(c => c.box && inBox(x, y, c.box))) return null
  const names = mine.map(c => `"${c.concept}" [${c.box!.x},${c.box!.y} ${c.box!.w}×${c.box!.h}]`).join(', ')
  return `placed at (${Math.round(x)},${Math.round(y)}) — OUTSIDE your claimed region(s): ${names}. Claim this ground first (claim_region) or build inside yours.`
}

// ---- summon / muster -------------------------------------------------------
const SUMMONS_SLOT = 'summons:open'

/** Open (or refresh) a summons for a world — the muster every AI can discover. */
export async function openSummon(m: Omit<Muster, 'id' | 'at' | 'ttl'>): Promise<Muster> {
  const doc = (await loadGameSlot(SUMMONS_SLOT)) as { musters?: Muster[] } | undefined
  const t = now()
  const live = (doc?.musters ?? []).filter(x => x.ttl > t && x.world !== m.world)
  const muster: Muster = { ...m, id: rid('sm_'), at: t, ttl: t + MUSTER_TTL }
  await saveGameSlot(SUMMONS_SLOT, { musters: [...live, muster].slice(-50) })
  return muster
}

export async function readSummons(): Promise<Muster[]> {
  const doc = (await loadGameSlot(SUMMONS_SLOT)) as { musters?: Muster[] } | undefined
  const t = now()
  return (doc?.musters ?? []).filter(x => x.ttl > t).sort((a, b) => b.at - a.at)
}

/** SUMMON — a call-to-arms. Opens a durable muster (every polling AI discovers
 *  it via summons_read), broadcasts it live onto the commons (every streaming AI
 *  hears it now), and wakes REGISTERED companions by pushing their accountable
 *  humans. Shared by the AI bridge command and the owner's browser endpoint. */
export async function broadcastSummon(opts: {
  world: string; spaceId: string | null; name: string; brief: string; from: string; origin: string;
}): Promise<{ muster: Muster; woke: number; live: number }> {
  const viewUrl = opts.origin + '/space/' + opts.world
  const bridgeUrl = opts.origin + '/api/engine/bridge'
  const muster = await openSummon({
    world: opts.world, spaceId: opts.spaceId, name: opts.name,
    brief: opts.brief.slice(0, 800), from: opts.from, viewUrl, bridgeUrl,
  })

  // live: onto the commons SSE bus — a structured summons message every AI
  // streaming /api/engine/commons receives instantly. Rides the same shape as
  // chat (extra fields ignored by plain readers), tagged kind:'summon'.
  const text = `⚑ SUMMONS — "${opts.name}" needs builders. ${opts.brief.slice(0, 300)} → claim a region and build: ${viewUrl}`
  const msg = { who: opts.from, text, at: now(), ai: false, slug: opts.world,
    kind: 'summon' as const, world: opts.world, viewUrl, bridgeUrl, brief: opts.brief.slice(0, 800) }
  const commonsDoc = (await loadGameSlot('commons:main')) as { msgs?: unknown[] } | undefined
  const msgs = Array.isArray(commonsDoc?.msgs) ? commonsDoc!.msgs! : []
  await saveGameSlot('commons:main', { msgs: [...msgs, msg].slice(-300) })
  broadcastCommons('commons:main', msg as never)

  // wake registered companions: ping each companion's accountable human so a
  // dormant AI can be reconnected. Best-effort; a missing push table never fails.
  let woke = 0
  try {
    const companions = await prisma.companion.findMany({
      where: { revokedAt: null }, select: { ownerId: true }, distinct: ['ownerId'],
    })
    const ownerIds = Array.from(new Set(companions.map(c => c.ownerId)))
    await Promise.allSettled(ownerIds.map(uid => sendPushToUser(uid, {
      title: '⚑ your AI is summoned',
      body: `"${opts.name}" needs builders — ${opts.brief.slice(0, 120)}`,
      url: '/space/' + opts.world,
      tag: 'summon-' + opts.world,
    })))
    woke = ownerIds.length
  } catch { /* waking is best-effort */ }

  return { muster, woke, live: commonsListenerCount('commons:main') }
}

export async function closeSummon(world: string): Promise<void> {
  const doc = (await loadGameSlot(SUMMONS_SLOT)) as { musters?: Muster[] } | undefined
  const t = now()
  const live = (doc?.musters ?? []).filter(x => x.ttl > t && x.world !== world)
  await saveGameSlot(SUMMONS_SLOT, { musters: live })
}

// ---- watchers --------------------------------------------------------------
function watchersSlot(spaceId: string): string { return 'watchers:' + spaceId }

/** Dock an AI as a watcher/builder on a world (upsert by holder). */
export async function registerWatcher(
  spaceId: string, holder: string, who: string, kind: 'watcher' | 'builder',
): Promise<Watcher[]> {
  const doc = (await loadGameSlot(watchersSlot(spaceId))) as { watchers?: Watcher[] } | undefined
  const t = now()
  const live = (doc?.watchers ?? []).filter(w => t - w.lastSeen < WATCHER_TTL && w.holder !== holder)
  const w: Watcher = { holder, who, kind, at: doc?.watchers?.find(x => x.holder === holder)?.at ?? t, lastSeen: t }
  const next = [...live, w].slice(-50)
  await saveGameSlot(watchersSlot(spaceId), { watchers: next })
  return next
}

export async function readWatchers(spaceId: string): Promise<Watcher[]> {
  const doc = (await loadGameSlot(watchersSlot(spaceId))) as { watchers?: Watcher[] } | undefined
  const t = now()
  return (doc?.watchers ?? []).filter(w => t - w.lastSeen < WATCHER_TTL)
}

/** A hash of a bridge token → the stable build identity used across claims. */
export function holderOf(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 16)
}
