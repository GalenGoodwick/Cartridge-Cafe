// penta-core tests — the math must hold before PENTARCH stands on it.
import { SIDE, APOTHEM, attachPose, edgeMidpoint, edgeNormalAngle, vertices, overlaps, layout, contacts, freeEdges, voids } from './penta-core.mjs'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓', name) } else { fail++; console.log('  ✗ FAIL:', name) } }
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

console.log('— attachment geometry —')
{
  const base = { cx: 0, cy: 0, th: 0 }
  for (let e = 0; e < 5; e++) {
    const child = attachPose(base, e)
    ok(near(Math.hypot(child.cx, child.cy), 2 * APOTHEM, 1e-9), `edge ${e}: child sits at exactly 2·apothem`)
    // flushness: the child's edge 0 midpoint coincides with the parent's edge-e midpoint
    const mp = edgeMidpoint(base, e), mc = edgeMidpoint(child, 0)
    ok(near(mp.x, mc.x, 1e-9) && near(mp.y, mc.y, 1e-9), `edge ${e}: shared edge midpoints coincide (flush)`)
    // the child's edge-0 normal points BACK at the parent
    const diff = ((edgeNormalAngle(child, 0) - edgeNormalAngle(base, e) - Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)
    ok(diff < 1e-9 || Math.abs(diff - 2 * Math.PI) < 1e-9, `edge ${e}: child edge-0 normal opposes parent`)
    // shared VERTICES coincide too (true flushness, not just midpoints)
    const vp = vertices(base), vc = vertices(child)
    const cornersMatch = vp.filter(p => vc.some(c => near(p.x, c.x, 1e-9) && near(p.y, c.y, 1e-9))).length
    ok(cornersMatch === 2, `edge ${e}: exactly two shared vertices`)
  }
}

console.log('— overlap oracle (ghost validity) —')
{
  const base = { cx: 0, cy: 0, th: 0 }
  const flush = attachPose(base, 1)
  ok(!overlaps(base, flush), 'flush neighbor is TOUCHING, not overlap')
  ok(overlaps(base, { cx: 0.3, cy: 0.2, th: 0.7 }), 'interpenetrating pentagon detected')
  ok(overlaps(base, { cx: 0, cy: 0, th: 1.0 }), 'coincident rotated pentagon detected')
  ok(!overlaps(base, { cx: 5, cy: 5, th: 0 }), 'distant pentagon clear')
  // the sneaky case: closer than 2R but farther than 2a, corner-into-edge
  const sneaky = { cx: 2 * APOTHEM * 0.99, cy: 0.4, th: 0.63 }
  const d = Math.hypot(sneaky.cx, sneaky.cy)
  ok(d > 2 * APOTHEM * 0.9 && overlaps(base, sneaky), 'corner-into-edge overlap caught by SAT (circle test would miss)')
}

console.log('— curvature: chains curl (the pentagon frustration) —')
{
  // attach via the same relative edge repeatedly → the chain must turn
  const design = [{ part: 'hull' }]
  for (let i = 1; i <= 9; i++) design.push({ parent: i - 1, edge: 2, part: 'hull' })
  const { tiles, rejected } = layout(design)
  ok(tiles.length === 10 && rejected.length === 0, 'chain of 10 lays out clean')
  const a0 = Math.atan2(tiles[1].cy - tiles[0].cy, tiles[1].cx - tiles[0].cx)
  const a1 = Math.atan2(tiles[9].cy - tiles[8].cy, tiles[9].cx - tiles[8].cx)
  ok(Math.abs(a1 - a0) > 0.5, 'the chain TURNED (no straight pentagon lines)')
  // and a same-edge chain eventually closes on itself: the 10th step returns home
  const end = attachPose(tiles[9], 2)
  ok(Math.hypot(end.cx - tiles[0].cx, end.cy - tiles[0].cy) < 1e-6, 'same-edge chain closes into a 10-ring (rosette)')
}

console.log('— re-touch: a curled chain regains contact —')
{
  const design = [{ part: 'hull' }]
  for (let i = 1; i <= 9; i++) design.push({ parent: i - 1, edge: 2, part: 'hull' })
  const { tiles } = layout(design)
  const cs = contacts(tiles)
  const retouches = cs.filter(c => c.retouch)
  ok(cs.length === 10, `ring has 10 contacts (9 parental + closing touch) — got ${cs.length}`)
  ok(retouches.length === 1, `exactly one RE-TOUCH contact (the ring closing) — got ${retouches.length}`)
}

console.log('— ghosts & voids —')
{
  // a partial curl: 9 of the 10-ring → the mouth is one tile wide
  const design = [{ part: 'hull' }]
  for (let i = 1; i <= 8; i++) design.push({ parent: i - 1, edge: 2, part: 'hull' })
  const { tiles } = layout(design)
  const fe = freeEdges(tiles)
  ok(fe.every(f => f.legal !== undefined), 'every free edge carries a ghost verdict')
  const legalCount = fe.filter(f => f.legal).length
  ok(legalCount > 0, `open hull offers legal ghosts (${legalCount})`)
  // closing the ring: tile 9 fits in the mouth (ghost legal there)
  const mouth = fe.find(f => f.i === 8 && f.e === 2)
  ok(!!mouth && mouth.legal, 'the ring-closing ghost is LEGAL (fits the mouth)')
  // the 10-ring's central hole is LARGE — pentagons legally fit inside: not a
  // void but an INNER BUILD BAY (ring a hull → get a hangar). Assert that.
  const ring = layout([{ part: 'hull' }, ...Array.from({ length: 9 }, (_, k) => ({ parent: k, edge: 2, part: 'hull' }))])
  const rcx = ring.tiles.reduce((s, t) => s + t.cx, 0) / ring.tiles.length
  const rcy = ring.tiles.reduce((s, t) => s + t.cy, 0) / ring.tiles.length
  const innerLegal = freeEdges(ring.tiles).filter(f => f.legal && Math.hypot(f.ghost.cx - rcx, f.ghost.cy - rcy) < 1.6)
  ok(innerLegal.length > 0, `ring interior offers LEGAL inner-bay ghosts (${innerLegal.length}) — hangars, not voids`)
  // the TRUE diamonds: a FLOWER (all 5 edges of one pentagon filled) leaves a
  // 36° wedge at each of the base's vertices — blocked pockets = VOID slots
  const flower = layout([{ part: 'hull' }, ...Array.from({ length: 5 }, (_, e) => ({ parent: 0, edge: e, part: 'hull' }))])
  ok(flower.tiles.length === 6 && flower.rejected.length === 0, 'flower of 6 lays out clean (petals never overlap)')
  const fvs = voids(flower.tiles)
  ok(fvs.length === 5, `flower encloses exactly 5 wedge-voids at the base's vertices (got ${fvs.length})`)
  if (fvs.length === 5) {
    const dists = fvs.map(v => Math.hypot(v.x, v.y))
    ok(dists.every(d => d > 0.4 && d < 2.2), 'voids ring the base pentagon (not at center, not far away)')
  }
}

console.log('— determinism —')
{
  const design = [{ part: 'hull' }, { parent: 0, edge: 1 }, { parent: 1, edge: 3 }, { parent: 2, edge: 2 }, { parent: 0, edge: 3 }]
  const A = layout(design), B = layout(design)
  ok(JSON.stringify(A) === JSON.stringify(B), 'layout is a pure function')
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) Deno.exit(1)
