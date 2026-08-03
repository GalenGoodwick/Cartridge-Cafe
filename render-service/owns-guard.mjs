// node-runtime · rung 2 — advisory ownership guard.
//
// Frame-end DIFF, not per-write interception. After a node's hook runs, any
// uniform slot whose VALUE changed that is NOT in the node's declared owns.uni is
// an out-of-range write. Advisory: we log it (→ render_probe.ownershipViolations);
// we do NOT revert it. This surfaces the true write/collision map before rung 3
// flips to strict.
//
// Why diff, not a Proxy trap (spec §10): the run loop is 49–120Hz; a check on
// every array write is exactly the hot-path cost the sandbox-cadence lesson warns
// about. A frame-end value-diff is near-free. Honest tradeoff: diff catches real
// clobbers (a value actually changed out of range — including the base's
// whole-array rebuild stomping u69–79) and ignores a write that sets the identical
// value (harmless). True write-tracking is the rung-3/strict upgrade, where
// dropping the write needs the Proxy anyway.

export function inRanges(i, ranges) {
  if (!ranges) return false;
  for (let r = 0; r < ranges.length; r++) {
    const a = ranges[r][0], b = ranges[r][1];
    if (i >= a && i <= b) return true;
  }
  return false;
}

/** Cheap copy of the uniform slots, taken BEFORE a node runs, for diffing after. */
export function snapshotUni(uni) {
  if (!uni) return null;
  return uni.slice ? uni.slice() : Array.prototype.slice.call(uni);
}

/**
 * prev/next: array-likes (Float32Array | number[]) of uniform slots, before/after
 *   one node's hook ran.
 * ownsUni: [[a,b], ...] inclusive index ranges the node declared (owns.uni).
 * Returns [{ node, index, frame }] for every changed slot OUTSIDE owns.uni.
 * A whole-array rebuild that changes an out-of-range slot is caught here — that
 * IS the weapons clobber (base rebuilds the frame and stomps u69–79).
 */
export function ownershipDiff(prev, next, ownsUni, nodeId, frame) {
  const out = [];
  const pn = prev ? prev.length : 0;
  const nn = next ? next.length : 0;
  const n = pn > nn ? pn : nn;
  for (let i = 0; i < n; i++) {
    // An unset / out-of-length uniform slot reads as 0 on the GPU, so treat missing
    // as 0 — a benign array-grow that fills zeros is NOT a write; only a real value
    // change (incl. writing 0 over a non-zero, i.e. a clobber) counts.
    const before = i < pn ? prev[i] : 0;
    const after = i < nn ? next[i] : 0;
    // NaN !== NaN, so guard it: NaN→NaN is not a write.
    const changed = before !== after && !(Number.isNaN(before) && Number.isNaN(after));
    if (changed && !inRanges(i, ownsUni)) out.push({ node: nodeId, index: i, frame });
  }
  return out;
}

/**
 * Fold ownershipDiff results into a dedup Map (key `node|index`) → { node, index,
 * frame, count }. First frame is kept; count increments on repeats — so a
 * whole-array clobber recurring every tick logs ONE row per index with a count,
 * not thousands. Returns the map. (The probe runner's render_probe.ownershipViolations
 * is `[...map.values()]`.)
 */
export function recordViolations(map, prev, next, ownsUni, nodeId, frame) {
  const v = ownershipDiff(prev, next, ownsUni, nodeId, frame);
  for (let i = 0; i < v.length; i++) {
    const e = v[i], k = e.node + '|' + e.index;
    let r = map.get(k);
    if (!r) { r = { node: e.node, index: e.index, frame: e.frame, count: 0 }; map.set(k, r); }
    r.count++;
  }
  return map;
}
