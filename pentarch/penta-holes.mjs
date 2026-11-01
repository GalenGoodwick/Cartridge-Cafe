// penta-holes — negative space as SHAPE. The free (unmated) edges of a hull form
// a planar graph whose bounded faces are the holes. Faces are traced the way a
// doubly-connected edge list does it: each corner keeps its outgoing edges
// sorted by bearing, and a walk arriving at a corner leaves by the first edge
// clockwise from the direction it came back along — so the empty region stays
// on the walker's right and every face is visited exactly once. Holes are then
// classified by their corner angles: DIAMOND (small rhomb), MOON (two horns),
// STAR (five spikes — the super-weapon shape), BAY (a roomy interior).
import { vertices, freeEdges } from './penta-core.mjs'

const FULL_TURN = Math.PI * 2
const NODE_GRID = 1e-3
const nodeOf = (p) => Math.round(p.x / NODE_GRID) + '|' + Math.round(p.y / NODE_GRID)

/** every enclosed hole of the hull, classified */
export function holes(tiles) {
  // half-edges: each free edge oriented by its tile's winding (material on the left)
  const half = freeEdges(tiles).map(f => {
    const vs = vertices(tiles[f.i])
    const a = vs[f.e], b = vs[(f.e + 1) % 5]
    return { a, b, bearing: Math.atan2(b.y - a.y, b.x - a.x), face: -1 }
  })
  // corner → outgoing half-edges, sorted by bearing (ascending, −π..π)
  const outgoing = new Map()
  half.forEach((h, id) => {
    const k = nodeOf(h.a)
    if (!outgoing.has(k)) outgoing.set(k, [])
    outgoing.get(k).push(id)
  })
  for (const ids of outgoing.values()) ids.sort((p, q) => half[p].bearing - half[q].bearing)

  // the DCEL step: from the reversed arrival bearing, the next edge clockwise
  // is the one with the largest bearing below it (wrapping to the top)
  const leaveBy = (h) => {
    const ids = outgoing.get(nodeOf(h.b))
    if (!ids) return -1
    let back = h.bearing + Math.PI
    if (back > Math.PI) back -= FULL_TURN
    let pick = -1
    for (const id of ids) { if (half[id].bearing < back - 1e-12) pick = id; else break }
    return pick >= 0 ? pick : ids[ids.length - 1]
  }

  const found = []
  half.forEach((h0, start) => {
    if (h0.face >= 0) return
    const ring = []
    let cur = start
    while (cur >= 0 && half[cur].face < 0) {
      half[cur].face = start
      ring.push(half[cur].a)
      cur = leaveBy(half[cur])
    }
    if (cur !== start || ring.length < 3) return                // broken or degenerate — not a face
    let twice = 0
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length]
      twice += p.x * q.y - q.x * p.y
    }
    if (twice >= -2e-6) return                                  // counter-clockwise = the outer boundary
    found.push(classify(ring.reverse()))                        // clockwise face = a hole; hand over CCW
  })
  return found
}

/** shape metrics + verdict for one hole polygon (CCW) */
export function classify(poly) {
  const n = poly.length
  let twice = 0, sx = 0, sy = 0
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n]
    twice += p.x * q.y - q.x * p.y
    sx += p.x; sy += p.y
  }
  const area = Math.abs(twice) / 2, cx = sx / n, cy = sy / n
  // corner angles from the two edge vectors: a left turn is a convex corner,
  // a right turn a reflex one; interior = 180° − signed turn
  let spikes = 0, reflex = 0
  for (let i = 0; i < n; i++) {
    const p = poly[(i + n - 1) % n], c = poly[i], q = poly[(i + 1) % n]
    const ux = c.x - p.x, uy = c.y - p.y, vx = q.x - c.x, vy = q.y - c.y
    const turn = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
    const interior = 180 - (turn * 180) / Math.PI
    if (interior < 100) spikes++
    else if (interior > 185) reflex++
  }
  const shape = spikes >= 4 && reflex >= 4 ? 'star'
    : spikes === 2 && reflex >= 1 ? 'moon'
    : area < 0.75 && n <= 6 ? 'diamond'
    : 'bay'
  return { shape, area: +area.toFixed(3), verts: n, spikes, reflex, cx, cy, poly }
}
