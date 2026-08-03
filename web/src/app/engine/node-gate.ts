// node-gate — the HARD access pathway (the piece that makes "add your own node,
// never edit the blob" a RULE the engine enforces, not a convention an AI chooses).
//
// A node may be HELD by one builder. The holder is holderOf(token) — the SHA-256 of
// the caller's bearer token (regions-store), which is un-spoofable: the client-supplied
// `author` field on a hook is NOT trusted here. While a node is held-and-fresh, any
// OTHER builder's add_step_hook / update_step_hook for that hookId is REJECTED at the
// single persist chokepoint (applyCommandToSnapshot → add_step_hook). Pushing a node
// auto-claims it (first writer holds). A hold goes STALE after NODE_HOLD_TTL so a
// vanished holder can never freeze a world — anyone may then take it. An admin token
// overrides. Legacy-neutral: a node with NO holder is free — exactly today's behavior,
// so every existing world keeps building untouched.
//
// This is a mirror of render-service/node-gate.mjs (used by the proofs). Keep in sync.

export const NODE_HOLD_TTL = 15 * 60_000 // 15 minutes of silence → the hold is stale

export interface NodeRecord {
  id?: string
  holder?: string
  heldAt?: number
  [k: string]: unknown
}

/** free = nobody holds it · mine = caller holds it · stale = held but past TTL (takeable)
 *  · held = held by someone else and fresh (locked). */
export function holdStatus(
  node: NodeRecord | undefined | null,
  caller: string,
  now: number,
  ttl: number = NODE_HOLD_TTL,
): 'free' | 'mine' | 'stale' | 'held' {
  if (!node || !node.holder) return 'free'
  if (node.holder === caller) return 'mine'
  const heldAt = Number(node.heldAt) || 0
  if (!heldAt || now - heldAt > ttl) return 'stale'
  return 'held'
}

/** Can `caller` push (overwrite) this node right now? Held-by-another-and-fresh = no. */
export function canPush(
  node: NodeRecord | undefined | null,
  caller: string,
  now: number,
  opts: { ttl?: number; override?: boolean } = {},
): { ok: boolean; status: string; reason?: string } {
  if (opts.override) return { ok: true, status: 'override' }
  const status = holdStatus(node, caller, now, opts.ttl ?? NODE_HOLD_TTL)
  if (status === 'held') {
    return {
      ok: false,
      status,
      reason:
        `node "${node!.id ?? '?'}" is HELD by ${node!.holder} — you (${caller || 'anon'}) can't overwrite it. ` +
        `Add your OWN node instead, or claim_node it once the hold goes stale (${Math.round(NODE_HOLD_TTL / 60000)}m idle).`,
    }
  }
  return { ok: true, status }
}

/** Stamp the hold onto a node (mutates). A push and an explicit claim both call this. */
export function stampHold(node: NodeRecord, caller: string, now: number): NodeRecord {
  if (!node) return node
  node.holder = caller
  node.heldAt = now
  return node
}

/** Can `caller` release this node? Only the current holder (or an override) may. */
export function canRelease(
  node: NodeRecord | undefined | null,
  caller: string,
  override = false,
): boolean {
  if (!node || !node.holder) return false
  return override || node.holder === caller
}
