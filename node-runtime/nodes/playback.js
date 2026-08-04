// node-runtime · nodes/playback.js
// Pixel playback — the non-destructive floor. Every frame (color + the per-pixel
// OWNER buffer) is recorded into a ring. Scrub back and the live sim freezes and
// you see any past frame — and because the owner buffer is recorded too,
// PROVENANCE still works on it: click a pixel in a replayed frame and it tells you
// which node drew it THEN. Nothing is lost; the world can always be replayed.
// (Determinism note: with a seeded rng the same seed reproduces the same series;
//  here we record frames directly, which is the pixel-truth version of that.)

const CAP = 180;               // ~3s at 60fps
let buf = [];                  // { col: Uint8ClampedArray, owner: Int16Array, t }
let scrub = -1;                // -1 = LIVE ; else index into buf

export function record(frame, t) {
  buf.push({ col: frame.col.slice(), owner: frame.owner.slice(), t });
  if (buf.length > CAP) buf.shift();
  if (scrub >= buf.length) scrub = buf.length - 1;   // keep a held scrub valid as the ring rolls
}
export function len() { return buf.length; }
export function isLive() { return scrub < 0; }
export function goLive() { scrub = -1; }
export function setScrub(i) { scrub = Math.max(0, Math.min(i | 0, buf.length - 1)); }
export function scrubIndex() { return scrub < 0 ? buf.length - 1 : scrub; }
export function frameAt() { return scrub < 0 ? null : buf[Math.min(scrub, buf.length - 1)]; }
export function scrubT() { const f = frameAt(); return f ? f.t : null; }
// the owner buffer provenance should read: the recorded one when scrubbed, else live.
export function activeOwner(liveOwner) { const f = frameAt(); return f ? f.owner : liveOwner; }
