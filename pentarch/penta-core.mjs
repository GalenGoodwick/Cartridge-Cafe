// penta-core — the pentagon-hull geometry PENTARCH stands on. Pure math, no IO.
//
// A ship is a tree of regular pentagons (side 1) attached edge-to-edge, but the
// GEOMETRY is not a tree: pentagons cannot tile the plane (interior angle 108°),
// so chains curve, curl back into RE-TOUCH contacts, and enclose 36° rhombic
// VOIDS — all three are gameplay (curved hulls, adjacency mods, diamond slots).
//
// Tile pose: {cx, cy, th}. Vertex k at angle th + 90° + k·72° (radius R);
// edge k spans vertices k..k+1, outward normal at th + 90° + (k+.5)·72°,
// midpoint at apothem a. Attaching to a parent's edge e puts the child at
// 2a along that normal, rotated so the CHILD'S EDGE 0 is the shared edge.

export const SIDE = 1
export const APOTHEM = 1 / (2 * Math.tan(Math.PI / 5))     // 0.68819…
export const CIRCUM = 1 / (2 * Math.sin(Math.PI / 5))      // 0.85065…
const STEP = (2 * Math.PI) / 5

export function edgeNormalAngle(tile, e) { return tile.th + Math.PI / 2 + (e + 0.5) * STEP }
export function edgeMidpoint(tile, e) {
  const n = edgeNormalAngle(tile, e)
  return { x: tile.cx + APOTHEM * Math.cos(n), y: tile.cy + APOTHEM * Math.sin(n) }
}
export function vertices(tile) {
  const out = []
  for (let k = 0; k < 5; k++) {
    const a = tile.th + Math.PI / 2 + k * STEP
    out.push({ x: tile.cx + CIRCUM * Math.cos(a), y: tile.cy + CIRCUM * Math.sin(a) })
  }
  return out
}

/** the pose a child takes when attached across the parent's edge e —
 *  the child's edge 0 becomes the shared edge (its normal faces the parent) */
export function attachPose(parent, e, ce = 0) {
  const n = edgeNormalAngle(parent, e)
  return {
    cx: parent.cx + 2 * APOTHEM * Math.cos(n),
    cy: parent.cy + 2 * APOTHEM * Math.sin(n),
    th: n + Math.PI / 2 - Math.PI / 5 - ce * STEP,  // ce = child's mating edge (0 = canonical). A flush contact needs BOTH edges to be reproduced exactly — proved 25/25 flush + reversible.
  }
}

/** SAT polygon overlap for two pentagons — the GHOST VALIDITY oracle.
 *  Flush edge-sharing (distance exactly 2a) is TOUCHING, not overlap: we shrink
 *  each pentagon a hair (EPS_SHRINK) so legal adjacency never reads as illegal. */
const EPS_SHRINK = 1e-4
function axes(vs) {
  const out = []
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i], b = vs[(i + 1) % vs.length]
    const nx = -(b.y - a.y), ny = b.x - a.x
    const L = Math.hypot(nx, ny)
    out.push({ x: nx / L, y: ny / L })
  }
  return out
}
function shrunk(tile) {
  const vs = vertices(tile)
  return vs.map(v => ({ x: v.x + (tile.cx - v.x) * EPS_SHRINK, y: v.y + (tile.cy - v.y) * EPS_SHRINK }))
}
export function overlaps(t1, t2) {
  if (Math.hypot(t1.cx - t2.cx, t1.cy - t2.cy) > 2 * CIRCUM) return false
  const v1 = shrunk(t1), v2 = shrunk(t2)
  for (const ax of [...axes(v1), ...axes(v2)]) {
    let min1 = Infinity, max1 = -Infinity, min2 = Infinity, max2 = -Infinity
    for (const v of v1) { const p = v.x * ax.x + v.y * ax.y; if (p < min1) min1 = p; if (p > max1) max1 = p }
    for (const v of v2) { const p = v.x * ax.x + v.y * ax.y; if (p < min2) min2 = p; if (p > max2) max2 = p }
    if (max1 < min2 || max2 < min1) return false
  }
  return true
}

/** Build tile poses from a design tree. Design: [{parent, edge, part}] — tile 0
 *  is the base (pose 0,0,0); every later entry attaches to an EXISTING tile.
 *  Returns { tiles, rejected } — a placement whose ghost would overlap ANY
 *  existing tile is rejected (Galen: "if ghost would overlap … no ghost"). */
export function layout(design) {
  const tiles = [{ cx: 0, cy: 0, th: 0, part: design[0]?.part ?? 'hull', parent: -1, edge: -1 }]
  const rejected = []
  for (let i = 1; i < design.length; i++) {
    const d = design[i]
    const parent = tiles[d.parent]
    if (!parent) { rejected.push({ i, why: 'no parent' }); continue }
    const pose = attachPose(parent, d.edge, d.ce || 0)
    let bad = false
    for (const t of tiles) { if (overlaps(pose, t)) { bad = true; break } }
    if (bad) { rejected.push({ i, why: 'overlap' }); continue }
    tiles.push({ ...pose, part: d.part ?? 'hull', parent: d.parent, edge: d.edge })
  }
  return { tiles, rejected }
}

/** All edge contacts — parent links AND re-touch (a chain curled back flush).
 *  Two edges are in contact when their midpoints coincide. */
export function contacts(tiles, eps = 1e-6) {
  const out = []
  for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
    if (Math.hypot(tiles[i].cx - tiles[j].cx, tiles[i].cy - tiles[j].cy) > 2 * APOTHEM + 0.01) continue
    for (let ei = 0; ei < 5; ei++) for (let ej = 0; ej < 5; ej++) {
      const mi = edgeMidpoint(tiles[i], ei), mj = edgeMidpoint(tiles[j], ej)
      if (Math.hypot(mi.x - mj.x, mi.y - mj.y) < Math.max(eps, 1e-3)) {
        out.push({ i, j, ei, ej, retouch: !(tiles[j].parent === i && tiles[j].edge === ei) && !(tiles[i].parent === j && tiles[i].edge === ej) })
      }
    }
  }
  return out
}

/** Free edges: not in any contact. Each carries its ghost pose + whether the
 *  ghost is LEGAL (the designer shows a ghost) or blocked (maybe a void). */
export function freeEdges(tiles) {
  const used = new Set()
  for (const c of contacts(tiles)) { used.add(c.i + ':' + c.ei); used.add(c.j + ':' + c.ej) }
  const out = []
  for (let i = 0; i < tiles.length; i++) for (let e = 0; e < 5; e++) {
    if (used.has(i + ':' + e)) continue
    const ghost = attachPose(tiles[i], e)
    let legal = true
    for (const t of tiles) { if (overlaps(ghost, t)) { legal = false; break } }
    out.push({ i, e, ghost, legal })
  }
  return out
}

/** VOIDS — the diamonds. Pentagon frustration is ANGULAR: where tile corners
 *  meet at one point, each contributes its 108° interior angle. Three tiles
 *  cover 324°, leaving a 36° wedge NOTHING can ever fill (a pentagon needs
 *  108°). Those unfillable pockets are the special build slots. Returns
 *  [{x, y, gapDeg, tiles: [i…], dir}] — dir = unit vector into the gap. */
export function voids(tiles, eps = 1e-3) {
  // cluster coincident vertices across tiles
  const pts = []
  tiles.forEach((t, i) => vertices(t).forEach((v, k) => pts.push({ i, k, x: v.x, y: v.y })))
  const used = new Set()
  const out = []
  for (let a = 0; a < pts.length; a++) {
    if (used.has(a)) continue
    const cluster = [pts[a]]; used.add(a)
    for (let b = a + 1; b < pts.length; b++) {
      if (used.has(b)) continue
      if (Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y) < eps) { cluster.push(pts[b]); used.add(b) }
    }
    const distinct = [...new Set(cluster.map(p => p.i))]
    if (distinct.length < 2) continue
    const gapDeg = 360 - 108 * cluster.length
    if (gapDeg <= 1 || gapDeg >= 108) continue        // ≥108° could hold a pentagon — not a sealed void
    // the gap opens opposite the average direction of the covering tiles
    let dx = 0, dy = 0
    for (const p of cluster) { const t = tiles[p.i]; dx += t.cx - p.x; dy += t.cy - p.y }
    const L = Math.hypot(dx, dy) || 1
    const dir = { x: -dx / L, y: -dy / L }
    out.push({ x: pts[a].x + dir.x * 0.22, y: pts[a].y + dir.y * 0.22, gapDeg, tiles: distinct, dir })
  }
  return out
}
