// node-runtime · nodes/render3d.js — the 3D WORLD render path, with per-pixel owner.
//
// The layering insight (Galen): 3D for the WORLD, 2D for the UI, ONE owner buffer.
// render.3d runs FIRST and fills color+owner from the raymarched world; render.2d
// (the UI) runs AFTER and overwrites owner where it draws opaque. So a click reads
// owner[x,y] and gets the right source in either layer — no layer logic at the click.
//
// The manifest: each GEOMETRY node contributes an SDF + a material (color) + its own
// node.idx. render.3d marches the union; the NEAREST-hit contribution owns the pixel.
// This is the w3_map(distance, materialId) contract — but we keep the material's NODE
// so provenance resolves pixel → node → code, not just a material number.

// ---- tiny vec3 + SDF helpers (seed-scale; the live engine uses world3-lib.wgsl) ----
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sdSphere = (p, c, r) => len(sub(p, c)) - r;
const sdBox = (p, c, b) => { const d = [Math.abs(p[0] - c[0]) - b[0], Math.abs(p[1] - c[1]) - b[1], Math.abs(p[2] - c[2]) - b[2]];
  const o = [Math.max(d[0], 0), Math.max(d[1], 0), Math.max(d[2], 0)]; return len(o) + Math.min(Math.max(d[0], Math.max(d[1], d[2])), 0); };
const sdPlane = (p, h) => p[1] - h;

// The WORLD manifest — geometry nodes, each owning a material + its node.idx.
// (In the live engine these come from the node registry's `render:geometry` nodes;
//  here we declare a small scene so the owner buffer + click-to-source are provable.)
export function worldManifest(nodeIdx) {
  // nodeIdx: a map id -> node.idx so each surface carries its OWNING node.
  return [
    { id: 'w3.floor',  idx: nodeIdx['w3.floor'],  col: [70, 54, 36],  sdf: (p) => sdPlane(p, -1.0) },
    { id: 'w3.orb',    idx: nodeIdx['w3.orb'],    col: [120, 90, 60],  sdf: (p) => sdSphere(p, [-0.9, -0.2, 4.0], 0.9) },
    { id: 'w3.pillar', idx: nodeIdx['w3.pillar'], col: [150, 80, 38],  sdf: (p) => sdBox(p, [1.2, 0.0, 4.5], [0.5, 1.2, 0.5]) },
  ];
}

// march one ray; return { t, hit } where hit is the nearest contribution (owner) or null.
function march(ro, rd, man) {
  let t = 0;
  for (let s = 0; s < 64; s++) {
    const p = add(ro, mul(rd, t));
    let d = 1e9, hit = null;
    for (const m of man) { const dm = m.sdf(p); if (dm < d) { d = dm; hit = m; } }  // union + track owner
    if (d < 0.01) return { t, hit, p };
    t += d;
    if (t > 40) break;
  }
  return { t: 40, hit: null, p: null };
}

// The render.3d NODE: raymarch the world into frame.col + frame.owner.
// Runs FIRST (low order) so the 2D UI composites on top of it.
export function render3dNode(nodeIdx) {
  const man = worldManifest(nodeIdx);
  const SUN = norm([0.4, 0.8, -0.5]);
  return {
    id: 'render.3d', kind: 'render', order: 5, owns: { uni: [] },   // a render PASS owns no state; the geometry nodes own their material slots
    title: 'render · 3D world', detail: 'raymarch a geometry manifest → per-pixel OWNER = the material node hit',
    prov: { via: 'w3_map union · nearest hit', state: 'owner = SDF surface node', means: 'the 3D world', cand: null },
    run: ({ frame }) => {
      const W = frame.W, H = frame.H, col = frame.col, own = frame.owner;
      const ro = [0, 0.3, 0], asp = W / H;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const uvx = (x / W * 2 - 1) * asp, uvy = -(y / H * 2 - 1);
          const rd = norm([uvx, uvy, 1.4]);
          const { t, hit, p } = march(ro, rd, man);
          const i = y * W + x, pp = i * 4;
          if (hit) {
            // cheap lambert so the shapes read; the POINT is the owner write.
            const eps = 0.02;
            const nx = hit.sdf(add(p, [eps, 0, 0])) - hit.sdf(sub(p, [eps, 0, 0]));
            const ny = hit.sdf(add(p, [0, eps, 0])) - hit.sdf(sub(p, [0, eps, 0]));
            const nz = hit.sdf(add(p, [0, 0, eps])) - hit.sdf(sub(p, [0, 0, eps]));
            const n = norm([nx, ny, nz]);
            const lit = 0.25 + 0.75 * Math.max(0, dot(n, SUN));
            col[pp] = hit.col[0] * lit; col[pp + 1] = hit.col[1] * lit; col[pp + 2] = hit.col[2] * lit; col[pp + 3] = 255;
            own[i] = hit.idx;                        // ← THE OWNER WRITE: this pixel belongs to the surface's node
          } else {
            const sky = 18 + 30 * (uvy * 0.5 + 0.5);  // background gradient
            col[pp] = sky; col[pp + 1] = sky * 0.8; col[pp + 2] = sky * 0.6; col[pp + 3] = 255;
            own[i] = -1;                              // sky = unowned (a click here hits nothing)
          }
        }
      }
    },
  };
}
