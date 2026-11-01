// penta-core — regular-pentagon tile geometry for PENTARCH. Pure math, no IO.
//
// Model: a tile is a pose {cx, cy, th}. Its five corners are the canonical
// unit pentagon (corner 0 straight "up" at th = 0, corners numbered counter-
// clockwise) rotated by th and carried to (cx, cy). Edge k joins corners k and
// k+1 and faces outward along bearing th + EDGE_BEARING[k]. Two tiles MATE when
// an edge of each coincides corner-for-corner. Because 108° does not divide
// 360°, mated chains bend, bend back into RE-TOUCH contacts, and leave 36°
// wedge VOIDS at shared corners — curved hulls, adjacency, diamond slots.

const SQRT5 = Math.sqrt(5)
const SIDES = 5
const STEP = (2 * Math.PI) / SIDES
export const SIDE = 1
// closed forms for the unit-side regular pentagon (√5 only, no trig at load)
export const APOTHEM = Math.sqrt(1 + 2 / SQRT5) / 2         // inradius      0.68819…
export const CIRCUM = Math.sqrt(50 + 10 * SQRT5) / 10       // circumradius  0.85065…

// the canonical tile, built once: corner k and the outward bearing of edge k
const UNIT_CORNER = Array.from({ length: SIDES }, (_, k) => {
  const a = Math.PI / 2 + k * STEP
  return [CIRCUM * Math.cos(a), CIRCUM * Math.sin(a)]
})
const EDGE_BEARING = Array.from({ length: SIDES }, (_, k) => Math.PI / 2 + (k + 0.5) * STEP)
const edgeNo = (e) => ((e % SIDES) + SIDES) % SIDES

/** absolute bearing of edge e's outward normal */
export function edgeNormalAngle(tile, e) { return tile.th + EDGE_BEARING[edgeNo(e)] }
/** a point `r` out from the tile centre along one of its edge bearings */
function polarPoint(tile, r, e) {
  const a = edgeNormalAngle(tile, e)
  return { x: tile.cx + r * Math.cos(a), y: tile.cy + r * Math.sin(a) }
}
export function edgeMidpoint(tile, e) { return polarPoint(tile, APOTHEM, e) }
/** the five corners: canonical table rotated by th, carried to (cx, cy) */
export function vertices(tile) {
  const c = Math.cos(tile.th), s = Math.sin(tile.th)
  return UNIT_CORNER.map(([x, y]) => ({ x: tile.cx + c * x - s * y, y: tile.cy + s * x + c * y }))
}

/** The pose that mates a new tile's edge `ce` onto `parent`'s edge `e`, the new
 *  tile on the far side. Solved from two constraints: the child centre lies one
 *  apothem beyond the shared edge's midpoint along the parent's normal, and the
 *  child's edge `ce` must bear exactly back at the parent (normal + π). */
export function attachPose(parent, e, ce = 0) {
  const n = edgeNormalAngle(parent, e)
  const m = edgeMidpoint(parent, e)
  return {
    cx: m.x + APOTHEM * Math.cos(n),
    cy: m.y + APOTHEM * Math.sin(n),
    th: n + Math.PI - EDGE_BEARING[edgeNo(ce)],
  }
}

/** Do two tiles share interior area? Mated neighbours TOUCH along an edge and
 *  must read false, so the exact test runs on tiles a hair under full size.
 *  Three stages: circumcircles apart → false; incircles crossing → true;
 *  otherwise exact convex geometry — a corner of one strictly inside the
 *  other, or a pair of edges properly crossing. */
const SHRINK = 1 - 1e-4
const TOUCH = 2 * APOTHEM * (1 - SHRINK)
function insetCorners(tile) {
  return vertices(tile).map(v => ({ x: tile.cx + (v.x - tile.cx) * SHRINK, y: tile.cy + (v.y - tile.cy) * SHRINK }))
}
const sideOf = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
function strictlyInside(p, poly) {
  for (let i = 0; i < poly.length; i++) if (sideOf(poly[i], poly[(i + 1) % poly.length], p) <= 0) return false
  return true
}
function segmentsCross(a, b, c, d) {
  const s1 = sideOf(a, b, c), s2 = sideOf(a, b, d), s3 = sideOf(c, d, a), s4 = sideOf(c, d, b)
  return s1 * s2 < 0 && s3 * s4 < 0
}
export function overlaps(t1, t2) {
  const d = Math.hypot(t1.cx - t2.cx, t1.cy - t2.cy)
  if (d > 2 * CIRCUM) return false
  if (d < 2 * APOTHEM - TOUCH) return true
  const A = insetCorners(t1), B = insetCorners(t2)
  if (A.some(p => strictlyInside(p, B)) || B.some(p => strictlyInside(p, A))) return true
  for (let i = 0; i < SIDES; i++) for (let j = 0; j < SIDES; j++) {
    if (segmentsCross(A[i], A[(i + 1) % SIDES], B[j], B[(j + 1) % SIDES])) return true
  }
  return false
}
/** true when `pose` overlaps none of `tiles` */
function fitsAmong(pose, tiles) { return !tiles.some(t => overlaps(pose, t)) }

/** Tile poses from a design tree. Design: [{parent, edge, part, ce?}] — entry
 *  0 is the base at the origin; each later entry mates onto an already-laid
 *  tile. Folds the design into { tiles, rejected }: a placement that would
 *  overlap anything already laid is refused, never nudged. */
export function layout(design) {
  const rejected = []
  const tiles = design.slice(1).reduce((laid, d, k) => {
    const onto = laid[d.parent]
    const pose = onto && attachPose(onto, d.edge, d.ce || 0)
    const why = !onto ? 'no parent' : fitsAmong(pose, laid) ? null : 'overlap'
    if (why) rejected.push({ i: k + 1, why })
    else laid.push({ ...pose, part: d.part ?? 'hull', parent: d.parent, edge: d.edge })
    return laid
  }, [{ cx: 0, cy: 0, th: 0, part: design[0]?.part ?? 'hull', parent: -1, edge: -1 }])
  return { tiles, rejected }
}

// ── spatial index: points on a coarse grid, queried with their 3×3 neighbours
//    so a point straddling a cell boundary is never missed ───────────────────
const CELL = 1e-3
function gridIndex() {
  const cells = new Map()
  const cellOf = (x, y) => Math.round(x / CELL) + '|' + Math.round(y / CELL)
  return {
    add(x, y, item) { const k = cellOf(x, y); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(item) },
    near(x, y, eps, accept) {
      const gx = Math.round(x / CELL), gy = Math.round(y / CELL)
      const out = []
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const it of cells.get((gx + dx) + '|' + (gy + dy)) || []) {
          if (accept(it) && Math.hypot(it.x - x, it.y - y) < eps) out.push(it)
        }
      }
      return out
    },
  }
}
/** every edge of every tile, with its midpoint, indexed */
function edgeTable(tiles) {
  const index = gridIndex()
  const edges = []
  tiles.forEach((t, i) => {
    for (let e = 0; e < SIDES; e++) {
      const m = edgeMidpoint(t, e)
      const rec = { i, e, x: m.x, y: m.y }
      edges.push(rec)
      index.add(m.x, m.y, rec)
    }
  })
  const mates = (rec, eps) => index.near(rec.x, rec.y, eps, o => o.i !== rec.i)
  return { edges, mates }
}

/** Edge contacts — parent links AND re-touches (a chain curled back flush).
 *  Two edges are in contact when their midpoints coincide. */
export function contacts(tiles, eps = 1e-6) {
  const tol = Math.max(eps, 1e-3)
  const { edges, mates } = edgeTable(tiles)
  const out = []
  for (const a of edges) for (const b of mates(a, tol)) {
    if (b.i < a.i) continue                                  // each pair once, from the lower tile
    const parental = (tiles[b.i].parent === a.i && tiles[b.i].edge === a.e) || (tiles[a.i].parent === b.i && tiles[a.i].edge === b.e)
    out.push({ i: a.i, j: b.i, ei: a.e, ej: b.e, retouch: !parental })
  }
  return out.sort((p, q) => p.i - q.i || p.j - q.j || p.ei - q.ei || p.ej - q.ej)
}

/** Free edges: unmated. Each carries the ghost pose a new tile would take there
 *  and whether that ghost is LEGAL (fits) or blocked. */
export function freeEdges(tiles) {
  const { edges, mates } = edgeTable(tiles)
  const out = []
  for (const r of edges) {
    if (mates(r, 1e-3).length) continue
    const ghost = attachPose(tiles[r.i], r.e)
    out.push({ i: r.i, e: r.e, ghost, legal: fitsAmong(ghost, tiles) })
  }
  return out
}

/** VOIDS — the unfillable wedges. Where tiles meet at one shared corner each
 *  takes 108° of it; the leftover (360 − 108·n) is a void when it is too narrow
 *  for another tile (< 108°). The void's direction is found explicitly: sort
 *  the covering tiles' centre bearings around the corner and bisect the widest
 *  empty arc. Returns [{x, y, gapDeg, tiles: [i…], dir}], dir a unit vector. */
export function voids(tiles, eps = 1e-3) {
  const index = gridIndex()
  const corners = []
  tiles.forEach((t, i) => vertices(t).forEach((v, k) => {
    const rec = { i, k, x: v.x, y: v.y, seen: false }
    corners.push(rec)
    index.add(v.x, v.y, rec)
  }))
  const out = []
  for (const c of corners) {
    if (c.seen) continue
    const cluster = index.near(c.x, c.y, eps, o => !o.seen)
    for (const o of cluster) o.seen = true
    const covering = [...new Set(cluster.map(o => o.i))].sort((p, q) => p - q)
    if (covering.length < 2) continue
    const gapDeg = 360 - 108 * cluster.length
    if (gapDeg <= 1 || gapDeg >= 108) continue               // ≥108° could seat a tile — not a sealed void
    const bearings = cluster.map(o => Math.atan2(tiles[o.i].cy - c.y, tiles[o.i].cx - c.x)).sort((p, q) => p - q)
    let widest = -1, open = 0
    for (let b = 0; b < bearings.length; b++) {
      const from = bearings[b], to = b + 1 < bearings.length ? bearings[b + 1] : bearings[0] + 2 * Math.PI
      if (to - from > widest) { widest = to - from; open = (from + to) / 2 }
    }
    const dir = { x: Math.cos(open), y: Math.sin(open) }
    out.push({ x: c.x + dir.x * 0.22, y: c.y + dir.y * 0.22, gapDeg, tiles: covering, dir })
  }
  return out
}
