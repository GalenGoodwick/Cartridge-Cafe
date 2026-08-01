// penta-holes — the negative-space SHAPE GRAMMAR. Enclosed holes in a hull are
// extracted as boundary loops and classified: DIAMOND (small rhomb), MOON
// (two-horned crescent), STAR (5-spiked pentagram hole — the super-weapon
// shape), BAY (large open interior, ring hangars). The rarer the shape, the
// bigger the unlock — hardness is inherent in pentagon frustration.
import { vertices, freeEdges } from './penta-core.mjs'

const Q = (v) => Math.round(v * 2000) / 2000            // vertex quantization key
const key = (p) => Q(p.x) + ',' + Q(p.y)

/** All enclosed holes: walk the free-edge segments (material on the LEFT by
 *  tile winding); loops with NEGATIVE signed area enclose a hole. */
export function holes(tiles) {
  const segs = []
  for (const f of freeEdges(tiles)) {
    const vs = vertices(tiles[f.i])
    const a = vs[f.e], b = vs[(f.e + 1) % 5]
    segs.push({ a, b, used: false })
  }
  const byStart = new Map()
  for (const s of segs) { const k = key(s.a); if (!byStart.has(k)) byStart.set(k, []); byStart.get(k).push(s) }
  const out = []
  for (const s0 of segs) {
    if (s0.used) continue
    const loop = []
    let cur = s0
    for (let guard = 0; guard < segs.length + 2; guard++) {
      cur.used = true
      loop.push(cur)
      const nexts = (byStart.get(key(cur.b)) || []).filter(s => !s.used)
      if (!nexts.length) break
      if (nexts.length === 1) { cur = nexts[0]; continue }
      // pinch vertex: take the sharpest right turn (keeps material on the left)
      const inD = Math.atan2(cur.b.y - cur.a.y, cur.b.x - cur.a.x)
      let best = null, bestTurn = Infinity
      for (const n of nexts) {
        const outD = Math.atan2(n.b.y - n.a.y, n.b.x - n.a.x)
        let turn = (inD - outD + Math.PI * 3) % (2 * Math.PI)   // right-turn magnitude
        if (turn < bestTurn) { bestTurn = turn; best = n }
      }
      cur = best
    }
    if (loop.length < 3) continue
    if (key(loop[loop.length - 1].b) !== key(loop[0].a)) continue   // open walk — outer notch, not a loop
    const poly = loop.map(s => s.a)
    let A2 = 0
    for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; A2 += p.x * q.y - q.x * p.y }
    if (A2 / 2 >= -1e-6) continue                                  // positive = the outer boundary
    out.push(classify(poly.slice().reverse()))                     // reverse → CCW hole polygon
  }
  return out
}

/** shape metrics + verdict for one hole polygon (CCW) */
export function classify(poly) {
  const n = poly.length
  let A2 = 0, cx = 0, cy = 0
  for (let i = 0; i < n; i++) { const p = poly[i], q = poly[(i + 1) % n]; A2 += p.x * q.y - q.x * p.y; cx += p.x; cy += p.y }
  const area = Math.abs(A2 / 2); cx /= n; cy /= n
  // interior angles → spikes (sharp convex tips of the hole: star points, moon horns)
  let spikes = 0, reflex = 0
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i + n - 1) % n], p1 = poly[i], p2 = poly[(i + 1) % n]
    const a1 = Math.atan2(p0.y - p1.y, p0.x - p1.x), a2 = Math.atan2(p2.y - p1.y, p2.x - p1.x)
    let int = (a1 - a2 + Math.PI * 4) % (2 * Math.PI)              // CCW interior angle
    const deg = int * 180 / Math.PI
    if (deg < 100) spikes++
    if (deg > 185) reflex++
  }
  // elongation via bounding radii
  let rMax = 0, rMin = Infinity
  for (const p of poly) { const r = Math.hypot(p.x - cx, p.y - cy); if (r > rMax) rMax = r; if (r < rMin) rMin = r }
  let shape = 'bay'
  if (spikes >= 4 && reflex >= 4) shape = 'star'
  else if (spikes === 2 && reflex >= 1) shape = 'moon'
  else if (area < 0.75 && n <= 6) shape = 'diamond'
  return { shape, area: +area.toFixed(3), verts: n, spikes, reflex, cx, cy, poly }
}
