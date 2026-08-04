// node-runtime · nodes/superpose.js
// Superposition + collapse — the tournament (MULTISTATE_PROCESSOR_GUIDE §7) made
// live on the seed. One node holds N candidate states AT ONCE (a real + scratch
// drafts). An evaluator scores them every frame against a drifting "truth"; the
// champion is the current collapse. superCollapse() promotes it — champion → real,
// the round respawns around it, and every winner is kept in history. Nothing is
// destroyed: the superposition can always be re-opened. This is the whole thesis,
// running: coexisting candidates, sampled but uncollapsed, until an evaluator picks.

const COLS = [[255, 122, 47], [84, 210, 221], [227, 90, 160], [127, 209, 138]];
let S = null;
const RND = () => Math.random();       // demo entropy; a seeded rng makes it replayable (rung: playback)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function superInit() {
  S = { target: { x: 120, y: 70 }, cands: [], champ: 0, history: [], round: 0, flash: 0 };
  spawn();
  return S;
}
function spawn() {
  const base = S.history.length ? S.history[S.history.length - 1] : { x: 120, y: 70 };
  S.cands = COLS.map((col) => ({
    x: clamp(base.x + (RND() - 0.5) * 150, 20, 220),
    y: clamp(base.y + (RND() - 0.5) * 90, 20, 130),
    col, score: 0,
  }));
  S.round++;
}

// the node's run: evaluate the superposition + render it (candidates coexisting).
export function superRun(ctx) {
  const { frame, node } = ctx, t = ctx.t || 0;
  // the TRUTH drifts — the target the evaluator collapses toward
  S.target.x = 120 + Math.cos(t * 0.6) * 72;
  S.target.y = 72 + Math.sin(t * 0.85) * 42;
  // EVALUATE — champion = the candidate closest to the truth (the collapse rule)
  let best = 0, bd = 1e9;
  for (let i = 0; i < S.cands.length; i++) {
    const c = S.cands[i];
    c.score = Math.hypot(c.x - S.target.x, c.y - S.target.y);
    if (c.score < bd) { bd = c.score; best = i; }
  }
  S.champ = best;
  // RENDER — every candidate is present (ghosted); the champion is solid + haloed;
  // a white cross marks the truth. Superposition you can see, collapse you can watch.
  const g = frame.painter(node.idx);
  for (let i = 0; i < S.cands.length; i++) {
    const c = S.cands[i], champ = i === best;
    if (champ) g.disc(c.x | 0, c.y | 0, 13, c.col[0], c.col[1], c.col[2], 0.18);
    g.disc(c.x | 0, c.y | 0, champ ? 8 : 6, c.col[0], c.col[1], c.col[2], champ ? 1 : 0.3);
  }
  g.rect((S.target.x | 0) - 6, S.target.y | 0, 13, 1, 245, 245, 240);
  g.rect(S.target.x | 0, (S.target.y | 0) - 6, 1, 13, 245, 245, 240);
  if (S.flash > 0) { S.flash -= (ctx.dt || 0.016); g.rect(0, 0, frame.W, frame.H, 255, 255, 255, Math.max(0, S.flash) * 1.4); }
}

// COLLAPSE — promote the champion. Losers leave the live set (kept nowhere destructive:
// history holds the winner of every round, so the lineage is never lost).
export function superCollapse() {
  if (!S) return null;
  const c = S.cands[S.champ];
  S.history.push({ x: c.x, y: c.y, col: c.col, round: S.round });
  S.flash = 0.35;
  spawn();
  return S.history[S.history.length - 1];
}
export function superState() { return S; }
