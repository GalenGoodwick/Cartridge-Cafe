// BRIDGE AUTH — who is calling, and what may they touch (item 4/#7: the first
// module carved off the bridge monolith; code moved VERBATIM from
// bridge/route.ts, behavior-tested before the move). One resolver for every
// credential the bridge accepts:
//   uc_st_  space token   → build THIS world (member:<handle> keys build, never demolish)
//   uc_it_  icon token    → set_player_icon for its minting player, nothing else
//   uc_sc_  scene token   → one branch scene, isolated from main + the registry
//   uc_pt_  player key    → commons chat + create/use THIS player's own worlds
//   admin   (ENGINE_AGENT_TOKEN / legacy) → global mode

import crypto from 'crypto'
import type { NextRequest } from 'next/server'
import { isAdminToken } from '@/lib/adminAuth'
import { validateSpaceToken } from './space-store'
import { validateSceneToken } from './scene-token'
import { validatePlayerToken } from '@/lib/player-token'
import { loadGameSlot } from './store'

/** A stable, non-reversible tag for the caller's token — its TYPE plus an 8-char
 *  hash of the token itself. Lets the admin bridge-watch see per-token volume
 *  ("who is hammering") WITHOUT storing the raw token. Computed pre-auth (cheap),
 *  so it also tags callers whose token later fails validation. */
export function tokenTag(authHeader: string): string {
  const token = authHeader.slice(7)
  const type = token.startsWith('uc_st_') ? 'space'
    : token.startsWith('uc_pt_') ? 'player'
    : token.startsWith('uc_it_') ? 'icon'
    : token === process.env.ENGINE_AGENT_TOKEN ? 'house'
    : 'other'
  return `${type}:${crypto.createHash('sha256').update(token).digest('hex').slice(0, 8)}`
}

export interface BridgeAuth {
  authorized: boolean
  spaceId: string | null    // null = legacy global mode
  ownerId: string | null
  iconUserId?: string       // uc_it_ icon token — may ONLY brew this player's icon
  playerId?: string         // uc_pt_ player key — chat the commons + create/checkout YOUR OWN worlds
  slug?: string
  spaceName?: string
  sceneName?: string        // set = branch-scoped (file-store scene); read/write isolated to it
  memberHandle?: string     // set = a member:<handle> crew key (build yes, demolish no)
}

/** DISPLAY IDENTITY CARRIES ROUTE TRUTH (audit, Sep 5): the commons/
 *  roundtable `from` was purely client-chosen — any token could speak as
 *  "the keeper". A chosen name that isn't the route-derived identity gets
 *  the real tag appended, so impersonation always shows its seams. */
export function routeWhoFor(auth: BridgeAuth, chosen: unknown): string {
  const base = String(chosen ?? auth.spaceName ?? auth.slug ?? 'ai').slice(0, 60)
  const truth = auth.memberHandle ? '@' + auth.memberHandle : (auth.spaceName ?? auth.slug ?? null)
  return truth && base !== String(truth) ? `${base} ⋄ ${truth}` : base
}

// Auth: ENGINE_AGENT_TOKEN or uc_st_ space token
export async function authorize(req: NextRequest): Promise<BridgeAuth> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { authorized: false, spaceId: null, ownerId: null }
  }

  const token = authHeader.slice(7)

  // Space token path
  if (token.startsWith('uc_st_')) {
    const result = await validateSpaceToken(token)
    if (!result) return { authorized: false, spaceId: null, ownerId: null }
    const memberHandle = result.tokenName?.startsWith('member:') ? result.tokenName.slice(7) : undefined
    return { authorized: true, spaceId: result.spaceId, ownerId: result.ownerId, slug: result.slug, spaceName: result.spaceName, memberHandle }
  }

  // Icon token path — minted by the BREW YOUR ICON panel, carried in the copied
  // prompt. It authorizes exactly ONE thing: set_player_icon, landing on the
  // player who minted it. No world, no scene, no state access — the brew flow
  // needs no world creation at all.
  if (token.startsWith('uc_it_')) {
    const hash = crypto.createHash('sha256').update(token).digest('hex')
    const doc = (await loadGameSlot('icon-token:' + hash)) as { userId?: string } | undefined
    if (!doc?.userId) return { authorized: false, spaceId: null, ownerId: null }
    return { authorized: true, spaceId: null, ownerId: null, iconUserId: doc.userId }
  }

  // Branch (scene) token path — stateless, bound to ONE scene name. Read/write
  // scope to that scene only; it can never touch main or the global registry.
  if (token.startsWith('uc_sc_')) {
    const result = validateSceneToken(token)
    if (!result) return { authorized: false, spaceId: null, ownerId: null }
    const slug = result.sceneName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
    return { authorized: true, spaceId: null, ownerId: null, sceneName: result.sceneName, slug, spaceName: result.sceneName }
  }

  // Player key path — a signed-in player's personal credential (uc_pt_). It is
  // NOT world-scoped: it may chat the commons and create/checkout THIS player's
  // own worlds (each yields a uc_st_ world token that does the actual building).
  if (token.startsWith('uc_pt_')) {
    const p = await validatePlayerToken(token)
    if (!p) return { authorized: false, spaceId: null, ownerId: null }
    return { authorized: true, spaceId: null, ownerId: null, playerId: p.userId }
  }

  // Legacy global token path (admin) — THE one check (lib/adminAuth, audit #6)
  if (isAdminToken('Bearer ' + token, { allowLegacyAnthropicKey: true })) {
    return { authorized: true, spaceId: null, ownerId: null }
  }

  return { authorized: false, spaceId: null, ownerId: null }
}
