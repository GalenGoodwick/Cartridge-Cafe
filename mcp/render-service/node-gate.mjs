// node-gate (.mjs mirror of web/src/app/engine/node-gate.ts) — the HARD access
// pathway. A node is HELD by one builder (holder = holderOf(token), un-spoofable);
// while held-and-fresh, another builder's push for that hookId is REJECTED at the
// persist chokepoint. Pushing auto-claims. A hold goes STALE after NODE_HOLD_TTL so a
// vanished holder never freezes a world. Admin overrides. No holder = free (legacy).
// Keep in sync with the .ts.

export const NODE_HOLD_TTL = 15 * 60_000

export function holdStatus(node, caller, now, ttl = NODE_HOLD_TTL) {
  if (!node || !node.holder) return 'free'
  if (node.holder === caller) return 'mine'
  const heldAt = Number(node.heldAt) || 0
  if (!heldAt || now - heldAt > ttl) return 'stale'
  return 'held'
}

export function canPush(node, caller, now, opts = {}) {
  if (opts.override) return { ok: true, status: 'override' }
  const status = holdStatus(node, caller, now, opts.ttl ?? NODE_HOLD_TTL)
  if (status === 'held') {
    return {
      ok: false,
      status,
      reason:
        `node "${node.id ?? '?'}" is HELD by ${node.holder} — you (${caller || 'anon'}) can't overwrite it. ` +
        `Add your OWN node instead, or claim_node it once the hold goes stale (${Math.round(NODE_HOLD_TTL / 60000)}m idle).`,
    }
  }
  return { ok: true, status }
}

export function stampHold(node, caller, now) {
  if (!node) return node
  node.holder = caller
  node.heldAt = now
  return node
}

export function canRelease(node, caller, override = false) {
  if (!node || !node.holder) return false
  return override || node.holder === caller
}
