// world-policy — the world's SOCIAL CONTRACT, pure core (DESIGN-multiplayer-
// worldbuilding §2-3, Galen's rulings). Set ONCE at fork/creation, IMMUTABLE
// forever after ("that isn't fair to people"). Policy decides who gets keys
// and who gets through doors — enforcement is key-minting + gates, not vibes.

export interface WorldPolicy {
  build: 'anyone' | 'invited' | 'owner'       // who may ADD to the world
  play: 'everyone' | 'invited' | 'builders'   // who may ENTER and play
}

/** Today's default — exactly the platform's current behavior (owner builds,
 *  everyone plays) so every existing world keeps its meaning unchanged. */
export const DEFAULT_POLICY: WorldPolicy = { build: 'owner', play: 'everyone' }

/** The fork-dialog presets (§2) — names are product language, used verbatim. */
export const POLICY_PRESETS: Record<string, WorldPolicy> = {
  'open-ground':   { build: 'anyone',  play: 'everyone' },
  'crew-world':    { build: 'invited', play: 'everyone' },
  'private-table': { build: 'invited', play: 'invited' },
  'solo':          { build: 'owner',   play: 'everyone' },
}

const BUILD = new Set(['anyone', 'invited', 'owner'])
const PLAY = new Set(['everyone', 'invited', 'builders'])

/** Parse an untrusted candidate → a valid policy, or null if malformed.
 *  (A preset name is also accepted — the dialog sends either.) */
export function normalizePolicy(raw: unknown): WorldPolicy | null {
  if (typeof raw === 'string') return POLICY_PRESETS[raw.trim().toLowerCase().replace(/\s+/g, '-')] ?? null
  if (!raw || typeof raw !== 'object') return null
  const b = (raw as { build?: unknown }).build
  const p = (raw as { play?: unknown }).play
  if (typeof b !== 'string' || !BUILD.has(b)) return null
  if (typeof p !== 'string' || !PLAY.has(p)) return null
  return { build: b as WorldPolicy['build'], play: p as WorldPolicy['play'] }
}

/** Read a world's policy off worldData — absent/malformed = the default, so
 *  every pre-policy world behaves exactly as it always has. */
export function policyOf(wd: Record<string, unknown> | null | undefined): WorldPolicy {
  return normalizePolicy(wd?.policy) ?? DEFAULT_POLICY
}

/** THE IMMUTABILITY LAW: may `incoming` write worldData.policy given what the
 *  world already holds? Only the FIRST set (nothing valid there yet) may land.
 *  Everything after is refused — including by the owner. */
export function mayWritePolicy(existingWd: Record<string, unknown> | null | undefined, incoming: unknown):
  { ok: true; policy: WorldPolicy } | { ok: false; error: string } {
  const next = normalizePolicy(incoming)
  if (!next) return { ok: false, error: 'malformed policy — {build: anyone|invited|owner, play: everyone|invited|builders} or a preset name' }
  if (normalizePolicy(existingWd?.policy)) {
    return { ok: false, error: 'the social contract is IMMUTABLE — policy was set when this world was forked and cannot change (fork the world to start a new contract)' }
  }
  return { ok: true, policy: next }
}

/** Who may BUILD (mint a member key / land bridge writes)?
 *  membership = holds a member key or is in the members roster (#5). */
export function canBuild(policy: WorldPolicy, who: { isOwner: boolean; isMember: boolean }): boolean {
  if (who.isOwner) return true
  if (policy.build === 'anyone') return true
  if (policy.build === 'invited') return who.isMember
  return false
}

/** Who may PLAY (pass the space-page door)? */
export function canPlay(policy: WorldPolicy, who: { isOwner: boolean; isMember: boolean }): boolean {
  if (who.isOwner) return true
  if (policy.play === 'everyone') return true
  return who.isMember   // 'invited' and 'builders' both resolve to the roster
}
