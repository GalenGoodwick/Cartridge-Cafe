// node-dock — the PURE core of collaborative building: per-node version
// control, quarantine/reversion policy, and the dock internals-feed ring.
//
// The unit of collaboration is the NODE (a hook/subsystem in worldData.__nodes,
// gated by node-gate holds) — not a 2D region. A builder DOCKS a node (hold +
// open feed), works, and UNDOCKS with submitted code (a new version) or
// abandons. Every landed push appends a version to the node's history, so a
// node that errors can be REVERTED to its last good code without touching the
// rest of the world — the fix for the doggo-bounce class of bug, where a
// world-level quarantine silently stripped the broken piece and left a hole.
//
// History lives IN the snapshot (worldData.__nodeHist) so revert is atomic and
// offline-consistent with the world — but it is SIZE-BUDGETED, never unbounded:
// a per-node byte budget keeps small hooks deep (many revisions) and huge
// shaders shallow (at least MIN_KEEP), and a world budget evicts the oldest
// history across nodes. No I/O here — everything is testable in isolation.

export interface NodeRev {
  rev: number          // the node's rev counter at the time of the push
  code: string         // the full submitted code (the unit of revert)
  at: number           // ms timestamp
  by: string           // holderOf(token) — un-spoofable builder identity
  note?: string        // undock note ("submitted: harbor tide v2")
  bad?: true           // marked when this rev erred/was reverted away from
}

export type NodeHist = Record<string, NodeRev[]>   // nodeId → oldest..newest

/** Budgets: per-node code bytes, minimum revs always kept per node, and the
 *  whole-world history byte ceiling (across all nodes). */
export const NODE_HIST_BUDGET = 96 * 1024
export const NODE_HIST_MIN_KEEP = 2
export const WORLD_HIST_BUDGET = 512 * 1024
/** A rev that collects this many distinct error reports is quarantine-ripe. */
export const QUARANTINE_ERR_THRESHOLD = 3

const bytes = (r: NodeRev) => r.code.length + 64   // 64 ≈ metadata overhead

/** Append a landed push to a node's history chain. Dedupes an identical-code
 *  re-push (refreshes timestamp instead of growing), then enforces the
 *  per-node byte budget (oldest out first, always keeping MIN_KEEP). */
export function appendNodeRev(hist: NodeHist, nodeId: string, rev: NodeRev): NodeHist {
  const chain = hist[nodeId] ?? []
  const last = chain[chain.length - 1]
  if (last && last.code === rev.code) {
    last.at = rev.at
    if (rev.note) last.note = rev.note
    return hist
  }
  const next = [...chain, rev]
  let total = next.reduce((s, r) => s + bytes(r), 0)
  while (next.length > NODE_HIST_MIN_KEEP && total > NODE_HIST_BUDGET) {
    total -= bytes(next.shift()!)
  }
  hist[nodeId] = next
  return hist
}

/** Enforce the WORLD budget: evict oldest history entries across all nodes
 *  (never a node's newest) until under the ceiling. Mutates + returns hist. */
export function capWorldHistory(hist: NodeHist): NodeHist {
  const total = () => Object.values(hist).reduce((s, c) => s + c.reduce((x, r) => x + bytes(r), 0), 0)
  while (total() > WORLD_HIST_BUDGET) {
    // the globally oldest evictable rev = each node's head, excluding the newest rev of each node
    let oldestNode: string | null = null
    let oldestAt = Infinity
    for (const [id, chain] of Object.entries(hist)) {
      if (chain.length <= 1) continue
      if (chain[0].at < oldestAt) { oldestAt = chain[0].at; oldestNode = id }
    }
    if (!oldestNode) break   // nothing evictable — every node is at its newest only
    hist[oldestNode].shift()
  }
  return hist
}

/** History without code bodies — what node_history returns by default. */
export function historyMeta(hist: NodeHist, nodeId: string) {
  return (hist[nodeId] ?? []).map(r => ({
    rev: r.rev, at: r.at, by: r.by, note: r.note, bad: r.bad === true, codeBytes: r.code.length,
  }))
}

/** The revert target: the NEWEST rev that is neither `avoidRev` nor marked bad.
 *  Null when no good ancestor exists (nothing to revert to). */
export function findRevertTarget(hist: NodeHist, nodeId: string, avoidRev?: number): NodeRev | null {
  const chain = hist[nodeId] ?? []
  for (let i = chain.length - 1; i >= 0; i--) {
    const r = chain[i]
    if (r.bad) continue
    if (avoidRev !== undefined && r.rev === avoidRev) continue
    return r
  }
  return null
}

/** Mark a rev bad (it erred / was reverted away from) so it is never a revert target. */
export function markRevBad(hist: NodeHist, nodeId: string, rev: number): void {
  for (const r of hist[nodeId] ?? []) if (r.rev === rev) r.bad = true
}

/** Per-node error accounting → auto-revert policy. Counts are per (nodeId, rev);
 *  a new rev resets the clock (its own errors count from zero). */
export function shouldAutoRevert(errCountForCurrentRev: number): boolean {
  return errCountForCurrentRev >= QUARANTINE_ERR_THRESHOLD
}

// ── the dock internals feed (pure ring — storage is the caller's) ──

export interface FeedLine { at: number; by: string; kind: 'status' | 'dock' | 'undock' | 'error' | 'revert'; text: string }
export const FEED_CAP = 100

/** Append a line to a node's feed ring, newest last, capped. */
export function feedAppend(ring: FeedLine[], line: FeedLine): FeedLine[] {
  const next = [...ring, { ...line, text: line.text.slice(0, 500) }]
  return next.length > FEED_CAP ? next.slice(next.length - FEED_CAP) : next
}
