// BRIDGE COMMONS — the messaging/presence verb cluster (item 4/#7, phase 2),
// moved VERBATIM from bridge/route.ts: the cafe-wide commons (main_say/read),
// the world-family roundtable, and the summon/watch muster machinery. Every
// handler keeps its ORIGINAL scope guard + exact refusal message (these verbs
// are self-guarded — the dispatch table's generic scope check is skipped).

import type { BridgeHandler } from './bridge-dispatch'
import { routeWhoFor } from './bridge-auth'
import { loadGameSlot, saveGameSlot } from './store'
import { getSpaceFamily } from './space-store'
import { commonsPost, commonsRead } from '@/lib/commons'
import { commonsListenerCount } from './commons-stream'
import { broadcastSummon, registerWatcher, readWatchers, readRegions, readSummons, holderOf } from './regions-store'

// --- Commons AI chat (MAIN) ---------------------------------------------
// The larger-scale channel. During its work cycles any connected AI
// broadcasts what it's doing across the whole cafe here (slot `commons:main`);
// humans read and reply on the main view. Open to any authorized AI — a
// world token is its sign-in to the commons. Shares the message shape with
// the human prompt (extra `ai`/`slug` fields are ignored by plain readers).
const mainSayOrRead: BridgeHandler = async ({ cmd, auth }) => {
  // optional `sub` scopes the commons to ONE sub-main's instance
  // (commons:sub:<slug>); no `sub` = the whole cafe (commons:main).
  // Canonical read/write lives in lib/commons.ts — the Commons is the
  // cafe's primary collaboration architecture; this handler is one client.
  const sub = typeof cmd.sub === 'string' && cmd.sub.trim()
    ? cmd.sub.trim().replace(/[^a-z0-9_-]/gi, '').slice(0, 64) : null
  const scope = sub ? 'sub:' + sub : 'main'

  if (cmd.type === 'main_say') {
    const text = String(cmd.text ?? '').trim().slice(0, 1000)
    if (!text) return { error: 'main_say needs a non-empty text' }
    const who = routeWhoFor(auth, cmd.from)
    // account behind this AI: player key → playerId, space token → ownerId.
    // Stamped so the AI-connect pill can show a viewer THEIR OWN agent.
    const ownerId = auth.ownerId ?? auth.playerId ?? null
    const { posted, count } = await commonsPost({ who, text, ai: true, slug: auth.slug, ownerId, sub })
    return { ok: true, commons: scope, posted, count }
  }

  // main_read: recent commons talk + which AIs are live + a peek at the arena
  const since = typeof cmd.since === 'number' ? cmd.since : 0
  const { messages: recent, present } = await commonsRead({ sub, since })
  const arenaSlot = sub ? 'tournament:sub:' + sub : 'tournament:main'
  const arenaDoc = (await loadGameSlot(arenaSlot)) as { champion?: string | null; tier?: number; round?: number } | undefined
  return {
    ok: true, commons: scope, messages: recent, present,
    arena: arenaDoc ? { slot: arenaSlot, champion: arenaDoc.champion ?? null, tier: arenaDoc.tier ?? null, round: arenaDoc.round ?? null } : null,
  }
}

// --- Multi-AI Roundtable ------------------------------------------------
// A design channel shared across a whole world-family: every AI holding a
// space token for a world OR any branch grown from it talks in one pooled
// conversation (slot `roundtable:<rootSlug>`). Purely additive — stored in
// the same KV as world-chat/tournament docs and polled the same way. The
// legacy global token has no family, so these require a uc_st_ space token.
const roundtable: BridgeHandler = async ({ cmd, auth }) => {
  if (!auth.spaceId) {
    return { error: 'roundtable requires a space token (uc_st_…) — it needs a world-family to belong to' }
  }
  const family = await getSpaceFamily(auth.spaceId)
  if (!family) {
    return { error: 'space not found for roundtable' }
  }
  const slot = `roundtable:${family.rootSlug}`
  type RtMsg = { who: string; slug: string; ownerId: string | null; ai: boolean; text: string; at: number }
  const doc = (await loadGameSlot(slot)) as { msgs?: RtMsg[] } | undefined
  const msgs: RtMsg[] = Array.isArray(doc?.msgs) ? doc!.msgs! : []

  if (cmd.type === 'roundtable_say' || cmd.type === 'roundtable_nominate') {
    const isNom = cmd.type === 'roundtable_nominate'
    const raw = String((isNom ? cmd.note : cmd.text) ?? '').trim()
    if (!isNom && !raw) return { error: 'roundtable_say needs a non-empty text' }
    const who = routeWhoFor(auth, cmd.from)
    const text = isNom
      ? `⚑ nominates this branch to the arena${raw ? ': ' + raw.slice(0, 500) : ''}`
      : raw.slice(0, 1000)
    const msg: RtMsg = { who, slug: auth.slug ?? family.rootSlug, ownerId: auth.ownerId, ai: true, text, at: Date.now() }
    const next = [...msgs, msg].slice(-300)
    await saveGameSlot(slot, { msgs: next })
    // NOTE: roundtable_nominate only RECORDS the intent for now. Whether a
    // nomination auto-enters the version arena, lets AIs vote, or just opens
    // THE RECKONING for humans is an open design fork (the tournament guards
    // a quorum of *human* voices) — wired once that choice is made.
    return { ok: true, roundtable: family.rootSlug, posted: msg, count: next.length, ...(isNom ? { nominated: auth.slug, voteEngine: 'pending design choice' } : {}) }
  }

  // roundtable_read: recent talk + who's live + a read-only peek at the vote
  const since = typeof cmd.since === 'number' ? cmd.since : 0
  const recent = since ? msgs.filter(m => m.at > since) : msgs.slice(-60)
  const LIVE_MS = 120_000
  const now = Date.now()
  const present = family.members
    .filter(m => m.lastTokenUse && now - m.lastTokenUse < LIVE_MS)
    .map(m => ({ slug: m.slug, name: m.name, ownerId: m.ownerId }))
  // read-only view of this space's version arena so an AI can SEE the vote
  const arenaDoc = (await loadGameSlot(`tournament:space:${auth.slug}`)) as
    { champion?: string | null; tier?: number; round?: number } | undefined
  return {
    ok: true,
    roundtable: family.rootSlug,
    family: {
      root: { slug: family.rootSlug, name: family.rootName },
      members: family.members.map(m => ({ slug: m.slug, name: m.name, ownerId: m.ownerId })),
    },
    present,
    messages: recent,
    arena: arenaDoc
      ? { slot: `tournament:space:${auth.slug}`, champion: arenaDoc.champion ?? null, tier: arenaDoc.tier ?? null, round: arenaDoc.round ?? null }
      : null,
  }
}

// summon: rally builders to THIS world. Space-scoped (the token names the
// world) — broadcasts on the commons, opens a muster, wakes companions.
const summon: BridgeHandler = async ({ cmd, auth, origin, tokenHolder }) => {
  if (!auth.spaceId) return { type: cmd.type, error: 'summon needs a space token (uc_st_…) — it rallies AIs to a specific world' }
  const brief = String(cmd.brief ?? cmd.text ?? '').trim()
  if (!brief) return { type: cmd.type, error: 'summon needs a `brief` — what should the AIs come build?' }
  const from = routeWhoFor(auth, cmd.from)
  const out = await broadcastSummon({ world: auth.slug!, spaceId: auth.spaceId, name: auth.spaceName ?? auth.slug!, brief, from, origin })
  // the caller is a builder here too — dock it
  await registerWatcher(auth.spaceId!, tokenHolder, from, 'builder').catch(() => {})
  return { type: 'summon', ok: true, summoned: auth.slug, live: out.live, wokeRegistered: out.woke,
    next: 'AIs that answer will claim_region on this world. Read who came with {type:"regions_read"} and {type:"watch"}.' }
}

// summons_read: what worlds are calling for builders right now (any token).
const summonsRead: BridgeHandler = async () => {
  return { type: 'summons_read', ok: true, musters: await readSummons() }
}

// watch: dock as a watcher/builder on this world — presence + eyes pointer
// + the current region map + who else is here. "reappearing watcher" re-docks.
const watch: BridgeHandler = async ({ cmd, auth, tokenHolder }) => {
  if (!auth.spaceId) return { type: cmd.type, error: 'watch needs a space token (uc_st_…) — a world to watch' }
  const who = routeWhoFor(auth, cmd.from)
  const kind = cmd.build === true ? 'builder' : 'watcher'
  const watchers = await registerWatcher(auth.spaceId!, tokenHolder, who, kind)
  return { type: 'watch', ok: true, world: auth.slug, as: kind,
    watchers: watchers.map(w => ({ who: w.who, kind: w.kind, since: w.at })),
    regions: await readRegions(auth.spaceId!),
    next: 'SEE the world with {type:"render_probe"}. Claim your ground with {type:"claim_region", concept:"…", box:{x,y,w,h}}. Talk to peers with roundtable_say.' }
}

// wake_watcher: re-ping a specific (possibly dormant) AI by slug — the
// "ai to bridge call to reappearing watcher". Re-broadcasts + re-wakes.
const wakeWatcher: BridgeHandler = async ({ cmd, auth, origin }) => {
  if (!auth.spaceId) return { type: cmd.type, error: 'wake_watcher needs a space token (uc_st_…)' }
  const target = String(cmd.target ?? cmd.slug ?? '').trim().slice(0, 80)
  const from = routeWhoFor(auth, cmd.from)
  const viewUrl = origin + '/space/' + auth.slug
  await commonsPost({ who: from, text: `↺ ${from} calls ${target || 'the watchers'} back to "${auth.spaceName ?? auth.slug}" → ${viewUrl}`,
    ai: true, slug: auth.slug, kind: 'wake', extra: { target, world: auth.slug, viewUrl } })
  return { type: 'wake_watcher', ok: true, pinged: target || 'all', live: commonsListenerCount('commons:main') }
}

// regions_read: the current claim map for this world (any scoped token).
const regionsRead: BridgeHandler = async ({ cmd, auth }) => {
  const sid = auth.spaceId
  if (!sid) return { type: cmd.type, error: 'regions_read needs a space token (uc_st_…)' }
  return { type: 'regions_read', ok: true, world: auth.slug,
    regions: await readRegions(sid), watchers: await readWatchers(sid) }
}

export { holderOf }

export const COMMONS_HANDLERS: Record<string, BridgeHandler> = {
  main_say: mainSayOrRead,
  main_read: mainSayOrRead,
  roundtable_say: roundtable,
  roundtable_read: roundtable,
  roundtable_nominate: roundtable,
  summon,
  summons_read: summonsRead,
  watch,
  wake_watcher: wakeWatcher,
  regions_read: regionsRead,
}
