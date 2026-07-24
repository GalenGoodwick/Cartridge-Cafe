// GROW — building growth algorithm for cartridge.cafe 3D worlds.
// Buildings construct themselves from a seed under structural GUIDELINES
// (ranges, not taste): every element springs from existing nodes, arches meet
// at shared apexes, tissue is proportional to member radius, open tops get
// capped. Gaps and bad proportions are impossible by construction.
//
// One truth, three callers:
//   growArcade()/growGable() -> graph
//   sdGraph(graph, p)        -> JS signed distance (CPU preview renderer)
//   emitWGSL(graph, name)    -> WGSL fn for the uber-shader (identical math)

// ---------- seeded rng ----------
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (rng, range) => Array.isArray(range) ? range[0] + rng() * (range[1] - range[0]) : range

// ---------- vector helpers ----------
const V = (x, y, z) => [x, y, z]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a) => Math.sqrt(dot(a, a))
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))

// ---------- primitive distances (exact ports of the WGSL) ----------
export function sdStrut(p, a, b, r1, r2) {
  const pa = sub(p, a), ba = sub(b, a)
  const h = clamp(dot(pa, ba) / dot(ba, ba), 0, 1)
  return len(sub(pa, scl(ba, h))) - (r1 + (r2 - r1) * h)
}
export function sdBox(p, c, hb) {
  const q = [Math.abs(p[0] - c[0]) - hb[0], Math.abs(p[1] - c[1]) - hb[1], Math.abs(p[2] - c[2]) - hb[2]]
  const o = [Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)]
  return len(o) + Math.min(Math.max(q[0], Math.max(q[1], q[2])), 0)
}
// exact closed-form quadratic bezier tube (IQ cubic solve) — unit-proven Jul 23
export function sdBez(pos, S, Ctl, E, r) {
  const a = sub(Ctl, S), b = add(sub(S, scl(Ctl, 2)), E), c = scl(a, 2), d = sub(S, pos)
  const bb = dot(b, b)
  if (bb < 1e-9) {
    const pa = sub(pos, S), ba = sub(E, S)
    const h = clamp(dot(pa, ba) / dot(ba, ba), 0, 1)
    return len(sub(pa, scl(ba, h))) - r
  }
  const kk = 1 / bb
  const kx = kk * dot(a, b)
  const ky = kk * (2 * dot(a, a) + dot(d, b)) / 3
  const kz = kk * dot(d, a)
  const pp = ky - kx * kx
  const qq = kx * (2 * kx * kx - 3 * ky) + kz
  const h = qq * qq + 4 * pp * pp * pp
  let res
  if (h >= 0) {
    const hs = Math.sqrt(h)
    const x1 = (hs - qq) / 2, x2 = (-hs - qq) / 2
    const cbrt = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1 / 3)
    const t = clamp(cbrt(x1) + cbrt(x2) - kx, 0, 1)
    const g = add(d, scl(add(c, scl(b, t)), t))
    res = dot(g, g)
  } else {
    const z = Math.sqrt(-pp)
    const v = Math.acos(qq / (pp * z * 2)) / 3
    const m = Math.cos(v), n = Math.sin(v) * 1.7320508
    const t1 = clamp((m + m) * z - kx, 0, 1)
    const t2 = clamp((-n - m) * z - kx, 0, 1)
    const g1 = add(d, scl(add(c, scl(b, t1)), t1))
    const g2 = add(d, scl(add(c, scl(b, t2)), t2))
    res = Math.min(dot(g1, g1), dot(g2, g2))
  }
  return Math.sqrt(res) - r
}
export const smin = (a, b, k) => {
  if (k <= 0) return Math.min(a, b)
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1)
  return b + (a - b) * h - k * h * (1 - h)
}
// 2D pointed-arch opening (TWO-CIRCLE construction — the historically true one).
// Open-bottom: region extends down forever (no sill edge). z is bay-local
// (0 at opening center). k = arc-center offset, R = k + hw (arcs pass through
// the springing points); apex rise = sqrt(R^2 - k^2).
export function sdOpening2D(z, y, hw, springY, k, R) {
  // rect overlaps the head by ov so the shared boundary can't materialize as
  // a crease (a zero-crossing inside the union would grow a phantom rim bar);
  // the arcs pull in only quadratically so the poke is ~ov^2/2R (invisible)
  const ov = 0.1 * Math.sqrt(Math.max(0, R * R - k * k))
  const rect = Math.max(Math.abs(z) - hw, y - (springY + ov))
  const dy = y - springY
  const head = Math.max(springY - y,
    Math.hypot(z + k, dy) - R,
    Math.hypot(z - k, dy) - R)
  return Math.min(rect, head)
}
// arc-center offset for a desired rise: (k+hw)^2 - k^2 = rise^2
export const archK = (hw, rise) => Math.max(0, (rise * rise - hw * hw) / (2 * hw))

// ---------- the grower ----------
// graph = { nodes: Map(id->[x,y,z]), statics: [el], repeats: [{origin, cellW, count, elements, rhythm}], cuts: [el], bounds, meta }
// element = { kind:'strut'|'bez'|'box', ...coords (node ids or literals), tissue:k (0 = crisp min) }
// Repeat elements use z RELATIVE to the cell's low boundary (zb).

class Builder {
  constructor(rng) { this.rng = rng; this.nodes = new Map(); this.n = 0; this.acts = 0 }
  node(p) { const id = 'n' + (this.n++); this.nodes.set(id, p.slice()); return id }
}

// Resolve every guideline range ONCE per building (a building is self-consistent).
export function resolveGuidelines(g, rng) {
  const r = {}
  for (const [k, v] of Object.entries(g)) {
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number') r[k] = pick(rng, v)
    else if (v && typeof v === 'object' && !Array.isArray(v)) r[k] = resolveGuidelines(v, rng)
    else r[k] = v
  }
  return r
}

// ARCADE WALL grammar: a wall running along z at x = g.line.x, PIERCED by
// pointed-arch openings (two-circle construction) — the arch is the rim of a
// void, not a floating tube. Stages: bays -> wall slab -> opening cuts ->
// rim moldings -> engaged columns at jambs -> cornice -> buttress piers +
// pinnacles (rhythm) -> finalize. Budget in acts.
export function growArcade(guidelines) {
  const rng = mulberry32(guidelines.seed ?? 1)
  const g = resolveGuidelines(guidelines, rng)
  const B = new Builder(rng)
  const budget = g.budget ?? Infinity

  const z0 = g.plot.z0, z1 = g.plot.z1, X = g.line.x
  const span = z1 - z0
  // bays: integer count fitted to the width guideline -> uniform, no remainder
  const nBays = Math.max(1, Math.round(span / g.bay.width))
  const bayW = span / nBays

  // canon ratios -> concrete dimensions (this is where proportion lives)
  const springH = g.spring.ratio * bayW                    // springing height of the arches
  const colRB = springH / (2 * g.column.slenderness)       // canon: slenderness = height / base diameter
  const colRT = colRB * g.column.taper
  const wallThick = g.wall.thickness * bayW                // real cloister walls are THIN vs bay
  const clearSpan = bayW - 2 * colRT
  const archR = colRT * g.arch.rRatio                      // rim molding roll radius
  const hw = clearSpan / 2 - archR                         // opening half-width
  const rise = g.arch.pointiness * 2 * hw                  // equilateral ~ 0.87 x span
  const kArc = archK(hw, rise), RArc = kArc + hw
  const apexH = springH + rise
  const spandrelH = g.spandrel.ratio * bayW
  const wallTop = apexH + spandrelH
  const corniceR = colRT * g.cornice.rRatio

  const k = (ra, rb) => g.tissue.ratio * Math.min(ra, rb)  // proportional tissue

  // per-cell elements, z relative to cell low boundary zb
  const cell = [], cellCuts = []
  const act = () => (++B.acts <= budget)

  // wall slab: full bay length, ground to cornice line
  if (act()) cell.push({ kind: 'box', c: V(X, wallTop / 2, bayW / 2), h: V(wallThick / 2, wallTop / 2, bayW / 2 + 0.005), tissue: 0 })

  // pointed-arch OPENING pierces the slab (two-circle construction, open-bottom)
  const opening = { hw, springY: springH, k: kArc, R: RArc, X, zc: bayW / 2 }
  if (act()) cellCuts.push({ kind: 'lancetcut', ...opening, cutHalf: wallThick / 2 + 0.4 })

  // rim molding: an edge roll along the whole reveal (jambs + arch head)
  if (act()) cell.push({ kind: 'lancetrim', ...opening, faceHalf: wallThick / 2, r: archR, tissue: k(archR, colRT) })

  // engaged columns at BOTH boundaries, shafts proud of the street face
  // (neighbors draw identical boundary geometry -> seamless by construction)
  const colX = X - wallThick * 0.25
  if (act()) cell.push({ kind: 'strut', a: V(colX, 0, 0), b: V(colX, springH, 0), r1: colRB, r2: colRT, tissue: k(colRT, archR) * 1.5 })
  if (act()) cell.push({ kind: 'strut', a: V(colX, 0, bayW), b: V(colX, springH, bayW), r1: colRB, r2: colRT, tissue: k(colRT, archR) * 1.5 })

  // cornice strut riding the wall top between shared boundary nodes
  if (act()) cell.push({ kind: 'strut', a: V(X - wallThick * 0.3, wallTop, 0), b: V(X - wallThick * 0.3, wallTop, bayW), r1: corniceR, r2: corniceR, tissue: k(corniceR, corniceR) * 1.2 })

  // buttress at rhythm boundaries: VERTICAL pier + weathering slope back to
  // the wall + pinnacle sharing the pier-top node (piers, not props)
  const rhythm = []
  const btDepth = g.buttress.depthRatio * bayW * 0.5
  const btRB = colRB * 1.5, btRT = btRB * g.buttress.taper
  const btX = X + wallThick / 2 + btDepth * 0.5
  const pierTopY = wallTop * 0.88
  const pierT = V(btX, pierTopY, 0)
  const pinH = g.pinnacle.hRatio * springH
  if (act()) rhythm.push({ kind: 'strut', a: V(btX, 0, 0), b: pierT, r1: btRB, r2: btRT, tissue: k(btRT, colRT) * 1.4 })
  if (act()) rhythm.push({ kind: 'strut', a: pierT, b: V(X, wallTop * 0.97, 0), r1: btRT * 0.9, r2: btRT * 0.55, tissue: k(btRT, btRT) })
  if (act()) rhythm.push({ kind: 'strut', a: pierT, b: V(btX, pierTopY + pinH, 0), r1: btRT * 0.75, r2: 0.02, tissue: k(btRT, btRT) })

  // finalize: if budget stopped before the openings were cut, cap the wall
  // with a plain coping so partial growth reads deliberate, never broken
  if (!cell.some(e => e.kind === 'lancetrim')) {
    cell.push({ kind: 'strut', a: V(X, wallTop, 0), b: V(X, wallTop, bayW), r1: wallThick * 0.45, r2: wallThick * 0.45, tissue: 0 })
  }

  const pad = wallThick / 2 + btDepth + btRB + 1
  return {
    kind: 'arcade', rngState: null,
    repeats: [{ origin: z0, cellW: bayW, count: nBays, elements: cell, cellCuts, rhythm, rhythmEvery: g.buttress.rhythm }],
    statics: [], cuts: [],
    bounds: { lo: V(X - pad, -2, z0 - 1.5), hi: V(X + pad, wallTop + pinH + 1.5, z1 + 1.5) },
    meta: { nBays, bayW, springH, colRB, colRT, clearSpan, hw, rise, kArc, RArc, apexH, archR, spandrelH, wallTop, corniceR, wallThick, btDepth, pinH, resolved: g },
  }
}

// GABLE FACADE grammar: stepped masses closing the end of the street at z = g.line.z,
// crowned by a spire; pinnacles at each step shoulder; central lancet cut for the door.
export function growGable(guidelines) {
  const rng = mulberry32(guidelines.seed ?? 2)
  const g = resolveGuidelines(guidelines, rng)
  const Z = g.line.z
  const W = g.plot.width
  const steps = Math.max(2, Math.round(g.steps))
  const H = g.heightRatio * W
  const statics = [], cuts = []
  const thick = g.thicknessRatio * W

  // crow-step gable: base storey then shrinking steps on a height curve —
  // first storey tall, upper steps tighten (silhouette reads as a gable,
  // not a wedding cake); pinnacle on every exposed shoulder
  let prevTopY = 0
  let prevHalfW = W / 2
  for (let s = 0; s < steps; s++) {
    const hf = Math.pow((s + 1) / steps, 0.72)          // height curve: big base, tight crown
    const wf = 1 - s / steps
    const halfW = (W / 2) * Math.pow(wf, g.stepShrink)
    const topY = H * hf
    statics.push({ kind: 'box', c: V(0, topY / 2, Z), h: V(halfW, topY / 2, thick / 2), tissue: s === 0 ? 0 : 0.2 })
    if (s > 0) {
      // pinnacle rides the SHOULDER of the step below (engaged pier + spike)
      const px = (halfW + prevHalfW) / 2
      const base = V(px, prevTopY, Z)
      const tip = V(px, prevTopY + g.pinnacleRatio * (topY - prevTopY) + 1.2, Z)
      statics.push({ kind: 'strut', a: V(px, prevTopY * 0.55, Z), b: base, r1: 0.42, r2: 0.36, tissue: 0.22, mirrorX: true })
      statics.push({ kind: 'strut', a: base, b: tip, r1: 0.36, r2: 0.02, tissue: 0.18, mirrorX: true })
    }
    // the facade gets the SAME opening language as the arcades (axis 'x'):
    // lower steps carry blind arcature (shallow niches — gothic paneling);
    // upper steps get THROUGH-lancets so the sky burns in the crown
    const stepBase = s === 0 ? 0 : prevTopY
    const stepH = topY - stepBase
    if (s < 2 && stepH > 2.2) {
      const nW = Math.min(1.05, halfW * 0.16)
      const nSpring = stepBase + stepH * 0.42
      const nRise = 0.9 * 2 * nW
      const nOff = s === 0 ? halfW * 0.55 : halfW * 0.5   // flanks (center stays clear for the door)
      for (const side of [nOff]) {
        cuts.push({ kind: 'lancetcut', axis: 'x', mirrorX: true, zc: side, X: Z - thick / 2, cutHalf: 0.16, hw: nW, springY: nSpring, k: archK(nW, nRise), R: archK(nW, nRise) + nW })
      }
    }
    if (s >= 2 && stepH > 1.4 && halfW > 1.6) {
      const wW = Math.min(0.8, halfW * 0.22)
      const wSill = stepBase + stepH * 0.15
      const wSpring = stepBase + stepH * 0.55
      const wRise = 0.9 * 2 * wW
      cuts.push({ kind: 'lancetcut', axis: 'x', zc: 0, X: Z, cutHalf: thick, sill: wSill, hw: wW, springY: wSpring, k: archK(wW, wRise), R: archK(wW, wRise) + wW })
    }
    prevTopY = topY; prevHalfW = halfW
  }
  // spire crowns the top step — slim, tall
  statics.push({ kind: 'strut', a: V(0, prevTopY - 0.4, Z), b: V(0, prevTopY + g.spireRatio * H, Z), r1: prevHalfW * 0.42, r2: 0.02, tissue: 0.3 })
  return {
    kind: 'gable',
    repeats: [], statics, cuts,
    bounds: { lo: V(-W / 2 - 1, -2, Z - thick - 1), hi: V(W / 2 + 1, prevTopY + g.spireRatio * H + 1, Z + thick + 1) },
    meta: { W, H, steps, thick, topY: prevTopY, resolved: g },
  }
}

// ---------- unroll (shared truth for eval + validation) ----------
export function unroll(graph) {
  // rhythm elements are per-BOUNDARY (0..count inclusive): a buttress belongs
  // to the shared boundary line, not to a cell — both neighbors must see it
  const els = []
  for (const e of graph.statics) els.push(e)
  for (const rp of graph.repeats) {
    for (let i = 0; i < rp.count; i++) {
      const zb = rp.origin + i * rp.cellW
      for (const e of rp.elements) els.push(shiftZ(e, zb))
    }
    for (let i = 0; i <= rp.count; i++) {
      if (i % rp.rhythmEvery !== 0) continue
      const zb = rp.origin + i * rp.cellW
      for (const e of rp.rhythm) els.push(shiftZ(e, zb))
    }
  }
  return els
}
const shiftZ = (e, zb) => {
  const mv = (p) => [p[0], p[1], p[2] + zb]
  const o = { ...e }
  if (e.a) o.a = mv(e.a)
  if (e.b && e.kind !== 'box') o.b = mv(e.b)
  if (e.ctl) o.ctl = mv(e.ctl)
  if (e.c) o.c = mv(e.c)
  if (e.zc !== undefined && e.axis !== 'x') o.zc = e.zc + zb  // axis-x profile centers live on x, not z
  return o
}

// ---------- JS evaluator (mirror of emitted WGSL) ----------
export function sdElement(e, p) {
  const q = e.mirrorX ? [Math.abs(p[0]), p[1], p[2]] : p
  if (e.kind === 'strut') return sdStrut(q, e.a, e.b, e.r1, e.r2)
  if (e.kind === 'bez') return sdBez(q, e.a, e.ctl, e.b, e.r)
  if (e.kind === 'box') return sdBox(q, e.c, e.h)
  if (e.kind === 'lancetrim') {
    // axis 'z': wall runs along z (profile z, faces x) — default, arcade walls
    // axis 'x': wall runs along x (profile x, faces z) — facades
    const pr = e.axis === 'x' ? q[0] - e.zc : q[2] - e.zc
    const fa = e.axis === 'x' ? q[2] - e.X : q[0] - e.X
    const op = sdOpening2D(pr, q[1], e.hw, e.springY, e.k, e.R)
    const fc = Math.max(Math.abs(fa) - e.faceHalf, 0)
    // floor clamp: the open-bottom profile would run the roll below ground
    return Math.max(Math.hypot(op, fc) - e.r, -q[1] - 0.05)
  }
  if (e.kind === 'lancetcut') {
    const pr = e.axis === 'x' ? q[0] - e.zc : q[2] - e.zc
    const fa = e.axis === 'x' ? q[2] - e.X : q[0] - e.X
    let op = sdOpening2D(pr, q[1], e.hw, e.springY, e.k, e.R)
    if (e.sill !== undefined) op = Math.max(op, e.sill - q[1])  // windows have sills; doors/panels stay open-bottom
    return Math.max(op, Math.abs(fa) - e.cutHalf)
  }
  throw new Error('unknown element ' + e.kind)
}
export function sdGraph(graph, p, unrolled) {
  const els = unrolled || unroll(graph)
  let d = 1e9
  for (const e of els) d = smin(d, sdElement(e, p), e.tissue || 0)
  for (const rp of graph.repeats) {
    for (const c of rp.cellCuts || []) {
      for (let i = 0; i < rp.count; i++) d = Math.max(d, -sdElement(shiftZ(c, rp.origin + i * rp.cellW), p))
    }
  }
  for (const c of graph.cuts) d = Math.max(d, -sdElement(c, p))
  return d
}

// ---------- WGSL emitter (repeat-compressed; identical math) ----------
const f = (x) => {
  const s = (Math.round(x * 10000) / 10000).toString()
  return s.includes('.') || s.includes('e') ? s : s + '.0'
}
const v3 = (p) => `vec3f(${f(p[0])}, ${f(p[1])}, ${f(p[2])})`
let emitN = 0
function emitEl(e, pv, dv, zvar, helper, gv) {
  const mv = (p) => zvar ? `vec3f(${f(p[0])}, ${f(p[1])}, ${zvar} + ${f(p[2])})` : v3(p)
  const zAt = (zc) => zvar ? `(${zvar} + ${f(zc)})` : f(zc)
  const P = e.mirrorX ? `vec3f(abs(${pv}.x), ${pv}.y, ${pv}.z)` : pv
  const px = e.mirrorX ? `abs(${pv}.x)` : `${pv}.x`
  const gr = (x) => gv ? `(${f(x)} * ${gv})` : f(x)   // live growth: radii swell with progress
  let call
  if (e.kind === 'strut') call = `GPRIM_strut(${P}, ${mv(e.a)}, ${mv(e.b)}, ${gr(e.r1)}, ${gr(e.r2)})`
  else if (e.kind === 'bez') call = `GPRIM_bez(${P}, ${mv(e.a)}, ${mv(e.ctl)}, ${mv(e.b)}, ${gr(e.r)})`
  else if (e.kind === 'box') call = `GPRIM_box(${P} - ${zvar ? `vec3f(${f(e.c[0])}, ${f(e.c[1])}, ${zvar} + ${f(e.c[2])})` : v3(e.c)}, ${gv ? `(${v3(e.h)} * ${gv})` : v3(e.h)})`
  else if (e.kind === 'lancetrim') {
    const n = ++emitN
    const pr = e.axis === 'x' ? `${px} - ${f(e.zc)}` : `${pv}.z - ${zAt(e.zc)}`
    const fa = e.axis === 'x' ? `${pv}.z - ${f(e.X)}` : `${px} - ${f(e.X)}`
    const op = `${helper}(${pr}, ${pv}.y, ${f(e.hw)}, ${f(e.springY)}, ${f(e.k)}, ${f(e.R)})`
    const lines = [
      `let go${n} = ${op};`,
      `let gf${n} = max(abs(${fa}) - ${f(e.faceHalf)}, 0.0);`,
    ]
    call = `max(sqrt(go${n} * go${n} + gf${n} * gf${n}) - ${gr(e.r)}, -${pv}.y - 0.05)`
    const t = e.tissue || 0
    const fin = t > 0 ? `${dv} = GPRIM_smin(${dv}, ${call}, ${f(t)});` : `${dv} = min(${dv}, ${call});`
    return [...lines, fin].join(' ')
  }
  else if (e.kind === 'lancetcut') {
    const pr = e.axis === 'x' ? `${px} - ${f(e.zc)}` : `${pv}.z - ${zAt(e.zc)}`
    const fa = e.axis === 'x' ? `${pv}.z - ${f(e.X)}` : `${px} - ${f(e.X)}`
    let op = `${helper}(${pr}, ${pv}.y, ${f(e.hw)}, ${f(e.springY)}, ${f(e.k)}, ${f(e.R)})`
    if (e.sill !== undefined) op = `max(${op}, ${f(e.sill)} - ${pv}.y)`
    return `${dv} = max(${dv}, -max(${op}, abs(${fa}) - ${f(e.cutHalf)}));`
  }
  const t = e.tissue || 0
  return t > 0 ? `${dv} = GPRIM_smin(${dv}, ${call}, ${f(t)});` : `${dv} = min(${dv}, ${call});`
}
// prims: names of the WGSL fns to call, e.g. {strut:'mod_vf3_strut', bez:'mod_vf3_bez', box:'mod_vf3_box', smin:'opSmoothUnion'}
// opts.growUniform: whiteboard index -> LIVE GROWTH. uni(i) in [0,1] becomes
// construction progress: elements swell in, in construction order, bays
// staggered down the street (opts.cellStagger acts per bay, default 0.6).
// A step hook animating that uniform makes the building BUILD ITSELF in-world.
export function emitWGSL(graph, name, prims, opts = {}) {
  emitN = 0
  const L = []
  const helper = `${name}_op`
  const G = opts.growUniform
  const grow = G !== undefined && G !== null
  const STAG = opts.cellStagger ?? 0.6
  let gN = 0
  const nEls = graph.statics.length + graph.repeats.reduce((a, r) => a + r.elements.length + r.rhythm.length, 0)
  const maxCells = Math.max(0, ...graph.repeats.map(r => r.count))
  const TOTAL = nEls + (grow ? STAG * maxCells : 0)
  const emitG = (e, pv, dv, zvar, baseVar, indent, idx) => {
    if (!grow || e.kind === 'lancetcut') return indent + emitEl(e, pv, dv, zvar, helper)
    const n = ++gN
    const s = emitEl(e, pv, dv, zvar, helper, `gw${n}`)
    return `${indent}let gw${n} = clamp(${baseVar} - ${f(idx)}, 0.0, 1.0); if (gw${n} > 0.001) { ${s} }`
  }
  const hasLancet = [...graph.statics, ...graph.repeats.flatMap(r => [...r.elements, ...(r.cellCuts || []), ...r.rhythm])]
    .some(e => e.kind === 'lancetrim' || e.kind === 'lancetcut')
  if (hasLancet) {
    L.push(`// 2D pointed-arch opening (two-circle construction, open-bottom)`)
    L.push(`fn ${helper}(z: f32, y: f32, hw: f32, sy: f32, k: f32, R: f32) -> f32 {`)
    L.push(`  let ov = 0.1 * sqrt(max(R * R - k * k, 0.0));`)
    L.push(`  let rect = max(abs(z) - hw, y - sy - ov);`)
    L.push(`  let dy = y - sy;`)
    L.push(`  let head = max(sy - y, max(length(vec2f(z + k, dy)) - R, length(vec2f(z - k, dy)) - R));`)
    L.push(`  return min(rect, head);`)
    L.push(`}`)
  }
  const bl = graph.bounds.lo, bh = graph.bounds.hi
  const bc = [(bl[0] + bh[0]) / 2, (bl[1] + bh[1]) / 2, (bl[2] + bh[2]) / 2]
  const bhh = [(bh[0] - bl[0]) / 2, (bh[1] - bl[1]) / 2, (bh[2] - bl[2]) / 2]
  L.push(`fn ${name}(p: vec3f) -> f32 {`)
  // AABB early-out MUST return the distance to the box, never a constant:
  // a constant makes the SDF discontinuous and rays tunnel through geometry
  // just past the boundary (the VEILFIRE clipping bug, Jul 24)
  L.push(`  let gqb = abs(p - ${v3(bc)}) - ${v3(bhh)};`)
  L.push(`  let gdb = length(max(gqb, vec3f(0.0)));`)
  // generous margin: early-out only when comfortably far — returning ~0 at the
  // face would stall the marcher into false hits ON the invisible AABB
  L.push(`  if (gdb > 0.5) { return gdb; }`)
  if (grow) L.push(`  let gbf = clamp(uni(${G}), 0.0, 1.0) * ${f(TOTAL)};`)
  L.push(`  var d = 1e5;`)
  let idx = 0
  for (const e of graph.statics) L.push(emitG(e, 'p', 'd', null, 'gbf', '  ', idx++))
  for (const rp of graph.repeats) {
    const cellBase = idx
    L.push(`  {`)
    L.push(`    let ci = clamp(floor((p.z - ${f(rp.origin)}) / ${f(rp.cellW)}), 0.0, ${f(rp.count - 1)});`)
    L.push(`    let zb = ${f(rp.origin)} + ci * ${f(rp.cellW)};`)
    if (grow) L.push(`    let gbc = gbf - ci * ${f(STAG)};`)
    L.push(`    var s = 1e5;`)
    let j = cellBase
    for (const e of rp.elements) L.push(emitG(e, 'p', 's', 'zb', 'gbc', '    ', j++))
    // neighbor cell pass: boundary geometry is shared, but the next cell's
    // interior can be closer -> evaluate neighbor too (proved exact by T3)
    L.push(`    let zf = (p.z - ${f(rp.origin)}) / ${f(rp.cellW)} - ci;`)
    L.push(`    let cn = select(ci + 1.0, ci - 1.0, zf < 0.5);`)
    L.push(`    let zn = ${f(rp.origin)} + cn * ${f(rp.cellW)};`)
    if (grow) L.push(`    let gbn = gbf - cn * ${f(STAG)};`)
    L.push(`    let nOk = cn >= 0.0 && cn <= ${f(rp.count - 1)};`)
    L.push(`    if (nOk) {`)
    j = cellBase
    for (const e of rp.elements) L.push(emitG(e, 'p', 's', 'zn', 'gbn', '      ', j++))
    L.push(`    }`)
    idx = cellBase + rp.elements.length
    if (rp.rhythm.length) {
      // rhythm boundaries once each over [ci-1, ci+2] — duplicates would
      // fatten tissue joints (smin(x,x,k) = x - k/4)
      L.push(`    for (var bo: i32 = -1; bo <= 2; bo++) {`)
      L.push(`      let bi = i32(ci) + bo;`)
      L.push(`      if (bi < 0 || bi > ${rp.count} || bi % ${rp.rhythmEvery} != 0) { continue; }`)
      L.push(`      let zr = ${f(rp.origin)} + f32(bi) * ${f(rp.cellW)};`)
      if (grow) L.push(`      let gbr = gbf - f32(bi) * ${f(STAG)};`)
      let k2 = idx
      for (const e of rp.rhythm) L.push(emitG(e, 'p', 's', 'zr', 'gbr', '      ', k2++))
      L.push(`    }`)
      idx += rp.rhythm.length
    }
    // opening cuts LAST, for both visited cells (max is idempotent; cuts are
    // never growth-gated — an opening only bites where wall already grew)
    for (const e of rp.cellCuts || []) {
      L.push('    ' + emitEl(e, 'p', 's', 'zb', helper))
      L.push(`    if (nOk) {`)
      L.push('      ' + emitEl(e, 'p', 's', 'zn', helper))
      L.push(`    }`)
    }
    L.push(`    d = min(d, s);`)
    L.push(`  }`)
  }
  for (const c of graph.cuts) L.push('  ' + emitEl({ ...c, tissue: 0 }, 'p', 'd', null, helper).replace(/^d = min\(d, (.*)\);$/, 'd = max(d, -$1);'))
  L.push(`  return d;`)
  L.push(`}`)
  let src = L.join('\n')
  src = src.replaceAll('GPRIM_strut', prims.strut).replaceAll('GPRIM_bez', prims.bez)
    .replaceAll('GPRIM_box', prims.box).replaceAll('GPRIM_smin', prims.smin)
  return src
}

// ---------- validators ----------
export function validate(graph) {
  const errs = []
  const els = unroll(graph)
  const m = graph.meta

  // V1 support: every element must touch the ground or another element (BFS)
  const touching = (e1, e2) => {
    const pts = (e) => e.kind === 'box'
      ? [e.c, add(e.c, [0, -e.h[1], 0]), add(e.c, [0, e.h[1], 0])]
      : e.kind === 'lancetrim'
        ? [[e.X, e.springY + Math.sqrt(Math.max(0, e.R * e.R - e.k * e.k)), e.zc], [e.X, e.springY, e.zc - e.hw], [e.X, e.springY, e.zc + e.hw]]
        : [e.a, e.b, mid(e)]
    const near = (p, e) => sdElement(e, p) < 0.08
    return pts(e1).some(p => near(p, e2)) || pts(e2).some(p => near(p, e1))
  }
  const mid = (e) => e.kind === 'bez'
    ? [0.25 * e.a[0] + 0.5 * e.ctl[0] + 0.25 * e.b[0], 0.25 * e.a[1] + 0.5 * e.ctl[1] + 0.25 * e.b[1], 0.25 * e.a[2] + 0.5 * e.ctl[2] + 0.25 * e.b[2]]
    : e.kind === 'box' ? e.c : scl(add(e.a, e.b), 0.5)
  const grounded = (e) => {
    if (e.kind === 'box') return e.c[1] - e.h[1] < 0.1
    if (e.kind === 'lancetrim') return false
    return Math.min(e.a[1], e.b[1]) < 0.1
  }
  const seen = new Set()
  const queue = []
  els.forEach((e, i) => { if (grounded(e)) { seen.add(i); queue.push(i) } })
  while (queue.length) {
    const i = queue.pop()
    els.forEach((e, j) => {
      if (!seen.has(j) && touching(els[i], e)) { seen.add(j); queue.push(j) }
    })
  }
  els.forEach((e, i) => { if (!seen.has(i)) errs.push(`V1 unsupported element #${i} (${e.kind})`) })

  // V2 arch halves share their apex exactly (same coordinates)
  const bez = els.filter(e => e.kind === 'bez')
  for (let i = 0; i < bez.length; i += 2) {
    const a = bez[i], b = bez[i + 1]
    if (!b) { errs.push('V2 odd bezier count'); break }
    if (len(sub(a.b, b.b)) > 1e-9) errs.push(`V2 arch pair ${i} apexes differ by ${len(sub(a.b, b.b))}`)
  }

  // V3 canon proportions (only for arcade graphs with meta)
  if (graph.kind === 'arcade') {
    const slender = m.springH / (2 * ((m.colRB + m.colRT) / 2))
    if (slender < 3.0) errs.push(`V3 columns squat: slenderness ${slender.toFixed(2)} < 3`)
    const riseRatio = m.rise / m.clearSpan
    if (riseRatio < 0.5) errs.push(`V3 arch flat: rise/span ${riseRatio.toFixed(2)} < 0.5 (lintel territory)`)
    if (m.archR > m.colRT) errs.push('V3 arch tube fatter than column top')
  }

  // V4 open tops: growth must close its tops — arches, tapered caps, or a coping
  if (graph.kind === 'arcade') {
    const hasArch = els.some(e => e.kind === 'bez' || e.kind === 'lancetrim')
    const hasCap = els.some(e => e.kind === 'strut' && e.r2 <= 0.05)
    const hasCoping = els.some(e => e.kind === 'strut' && Math.abs(e.a[1] - e.b[1]) < 1e-9 && Math.abs(e.a[1] - Math.max(...els.filter(x => x.kind === 'strut').flatMap(x => [x.a[1], x.b[1]]))) < 0.5)
    if (!hasArch && !hasCap && !hasCoping) errs.push('V4 open tops: no arches, caps, or coping')
  }

  // V5 SDF sanity: points on strut axes are inside; points far outside bounds are outside
  const un = els
  for (const e of un.slice(0, 40)) {
    if (e.kind !== 'strut') continue
    const c = scl(add(e.a, e.b), 0.5)
    const dv = sdGraph(graph, c, un)
    if (dv > -Math.min(e.r1, e.r2) * 0.2) { errs.push(`V5 axis midpoint not inside (d=${dv.toFixed(3)})`); break }
  }
  const far = [graph.bounds.hi[0] + 5, graph.bounds.hi[1] + 5, graph.bounds.hi[2] + 5]
  if (sdGraph(graph, far, un) < 1) errs.push('V5 far point not outside')

  // V6 bounds conservative: sample shell just outside AABB -> all positive
  const bl = graph.bounds.lo, bh = graph.bounds.hi
  const rng = mulberry32(99)
  for (let i = 0; i < 200; i++) {
    const axis = Math.floor(rng() * 3)
    const side = rng() < 0.5
    const p = [bl[0] + rng() * (bh[0] - bl[0]), bl[1] + rng() * (bh[1] - bl[1]), bl[2] + rng() * (bh[2] - bl[2])]
    p[axis] = side ? bl[axis] - 0.05 : bh[axis] + 0.05
    if (sdGraph(graph, p, un) < -0.001) { errs.push(`V6 bounds leak at ${p.map(x => x.toFixed(1))}`); break }
  }
  return errs
}

// V7 (emitter vs unrolled truth): compare cell-repeat evaluation against full
// unroll at random points — the emitted WGSL uses the cell+neighbor scheme, so
// prove that scheme exact in JS first.
export function sdGraphCellScheme(graph, p) {
  // identical AABB early-out to the emitted WGSL (distance, never a constant)
  const bl = graph.bounds.lo, bh = graph.bounds.hi
  const qx = Math.max(Math.abs(p[0] - (bl[0] + bh[0]) / 2) - (bh[0] - bl[0]) / 2, 0)
  const qy = Math.max(Math.abs(p[1] - (bl[1] + bh[1]) / 2) - (bh[1] - bl[1]) / 2, 0)
  const qz = Math.max(Math.abs(p[2] - (bl[2] + bh[2]) / 2) - (bh[2] - bl[2]) / 2, 0)
  const db = Math.sqrt(qx * qx + qy * qy + qz * qz)
  if (db > 0.5) return db
  let d = 1e9
  for (const e of graph.statics) d = smin(d, sdElement(e, p), e.tissue || 0)
  for (const rp of graph.repeats) {
    let s = 1e9
    const ci = clamp(Math.floor((p[2] - rp.origin) / rp.cellW), 0, rp.count - 1)
    const zf = (p[2] - rp.origin) / rp.cellW - ci
    const cells = [ci]
    const cj = zf < 0.5 ? ci - 1 : ci + 1
    if (cj >= 0 && cj <= rp.count - 1) cells.push(cj)
    for (const c of cells) {
      const zb = rp.origin + c * rp.cellW
      for (const e of rp.elements) s = smin(s, sdElement(shiftZ(e, zb), p), e.tissue || 0)
    }
    // rhythm boundaries ONCE each (smin(x,x,k) = x - k/4: duplicates fatten tissue)
    for (let bi = ci - 1; bi <= ci + 2; bi++) {
      if (bi < 0 || bi > rp.count || bi % rp.rhythmEvery !== 0) continue
      const zb = rp.origin + bi * rp.cellW
      for (const e of rp.rhythm) s = smin(s, sdElement(shiftZ(e, zb), p), e.tissue || 0)
    }
    // opening cuts for the visited cells (max is idempotent — no dedup needed)
    for (const c of cells) {
      const zb = rp.origin + c * rp.cellW
      for (const e of rp.cellCuts || []) s = Math.max(s, -sdElement(shiftZ(e, zb), p))
    }
    d = Math.min(d, s)
  }
  for (const c of graph.cuts) d = Math.max(d, -sdElement(c, p))
  return d
}
