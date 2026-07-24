// Unit tests for GROW — run before anything ships. proper always.
import { growArcade, growGable, validate, sdGraph, sdGraphCellScheme, sdBez, unroll, mulberry32, emitWGSL } from './grow-building.mjs'

let fails = 0
const ok = (cond, msg) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + msg); if (!cond) fails++ }

const GOTHIC = {
  seed: 7,
  plot: { z0: -2, z1: 38 },
  line: { x: 8.6 },
  bay: { width: [3.6, 4.4] },
  column: { slenderness: [7, 10], taper: [0.78, 0.86] },
  spring: { ratio: [1.15, 1.45] },
  arch: { pointiness: [0.78, 0.95], rRatio: [0.55, 0.75] },
  spandrel: { ratio: [0.28, 0.42] },
  cornice: { rRatio: [0.55, 0.75] },
  wall: { thickness: [0.10, 0.14] },
  buttress: { rhythm: 2, depthRatio: [0.5, 0.65], taper: [0.5, 0.65] },
  pinnacle: { hRatio: [0.45, 0.7] },
  tissue: { ratio: [0.45, 0.7] },
}

// T1: grower produces a valid graph under the gothic guideline set
const g = growArcade(GOTHIC)
const errs = validate(g)
for (const e of errs) console.log('  validator:', e)
ok(errs.length === 0, `T1 arcade validates clean (bays=${g.meta.nBays}, bayW=${g.meta.bayW.toFixed(2)}, springH=${g.meta.springH.toFixed(2)}, rise=${g.meta.rise.toFixed(2)})`)

// T2: canon ratios actually present in the OUTPUT (measure, don't trust)
const slender = g.meta.springH / (2 * g.meta.colRB)
ok(slender >= 7 && slender <= 10, `T2a column slenderness in canon: ${slender.toFixed(2)}`)
const rr = g.meta.rise / g.meta.clearSpan
ok(rr >= 0.75 && rr <= 0.98, `T2b arch rise/clearSpan pointed: ${rr.toFixed(2)} (equilateral=0.87)`)

// T3: V7 exactness — cell+neighbor scheme (what the WGSL does) vs full unroll
{
  const un = unroll(g)
  const rng = mulberry32(1234)
  const bl = g.bounds.lo, bh = g.bounds.hi
  let worst = 0, worstP = null
  for (let i = 0; i < 20000; i++) {
    // inside bounds only: outside, the scheme returns the AABB lower bound by design
    const p = [bl[0] + 0.1 + rng() * (bh[0] - bl[0] - 0.2), Math.max(0, bl[1]) + rng() * (bh[1] - Math.max(0, bl[1]) - 0.1), bl[2] + 0.1 + rng() * (bh[2] - bl[2] - 0.2)]
    const a = sdGraph(g, p, un)
    const b = sdGraphCellScheme(g, p)
    const d = Math.abs(a - b)
    if (d > worst) { worst = d; worstP = p }
  }
  // smin grouping differs (unroll = one chain, scheme = per-cell chains) so
  // deviation up to ~k/4 (max tissue 0.14 -> 0.035) is ordering noise; missing
  // geometry shows up at radius scale (0.2+) — the bar separates the two
  ok(worst < 0.035, `T3 cell-scheme vs unroll worst |Δd| = ${worst.toFixed(5)} @ ${worstP ? worstP.map(x => x.toFixed(1)) : ''}`)
}

// T4: exact bezier vs dense ground-truth sampling (regression guard for the port)
{
  const rng = mulberry32(55)
  let worst = 0
  for (let i = 0; i < 300; i++) {
    const S = [rng() * 4, rng() * 4, rng() * 4], C = [rng() * 4, rng() * 4, rng() * 4], E = [rng() * 4, rng() * 4, rng() * 4]
    const p = [rng() * 6 - 1, rng() * 6 - 1, rng() * 6 - 1]
    const dExact = sdBez(p, S, C, E, 0)
    let dTrue = 1e9
    for (let t = 0; t <= 1.0001; t += 1 / 4096) {
      const u = 1 - t
      const q = [u * u * S[0] + 2 * u * t * C[0] + t * t * E[0], u * u * S[1] + 2 * u * t * C[1] + t * t * E[1], u * u * S[2] + 2 * u * t * C[2] + t * t * E[2]]
      const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2]
      dTrue = Math.min(dTrue, Math.sqrt(dx * dx + dy * dy + dz * dz))
    }
    worst = Math.max(worst, Math.abs(dExact - dTrue))
  }
  ok(worst < 0.002, `T4 exact bezier vs 4096-sample truth: worst ${worst.toFixed(5)}`)
}

// T5: budget truncation still yields a supported, capped structure
{
  const partial = growArcade({ ...GOTHIC, budget: 2 })
  const errs2 = validate(partial)
  for (const e of errs2) console.log('  validator:', e)
  ok(errs2.length === 0, 'T5 budget=2 (wall+cut only) still validates')
  const hasCoping = unroll(partial).some(e => e.kind === 'strut' && Math.abs(e.a[1] - e.b[1]) < 1e-9)
  ok(hasCoping, 'T5b partial growth capped the wall with a coping')
}

// T6: gable grammar validates
{
  const gg = growGable({
    seed: 3, line: { z: 39 }, plot: { width: 21 },
    steps: 3, heightRatio: [0.5, 0.62], stepShrink: [0.9, 1.2],
    thicknessRatio: [0.09, 0.12], pinnacleRatio: [0.5, 0.8], spireRatio: [0.28, 0.4],
  })
  const errs3 = validate(gg)
  for (const e of errs3) console.log('  validator:', e)
  ok(errs3.length === 0, `T6 gable validates (H=${gg.meta.H.toFixed(1)}, steps=${gg.meta.steps})`)
}

// T7: determinism — same seed, same graph
{
  const a = JSON.stringify(growArcade(GOTHIC).meta)
  const b = JSON.stringify(growArcade(GOTHIC).meta)
  ok(a === b, 'T7 same seed -> identical building')
  const c = JSON.stringify(growArcade({ ...GOTHIC, seed: 8 }).meta)
  ok(a !== c, 'T7b different seed -> different building (within guidelines)')
}

// T8: emitter produces WGSL with balanced braces, no NaN/undefined, floats typed
{
  const src = emitWGSL(g, 'mod_test_grown', { strut: 'mod_vf3_strut', bez: 'mod_vf3_bez', box: 'mod_vf3_box', smin: 'opSmoothUnion' })
  const open = (src.match(/\{/g) || []).length, close = (src.match(/\}/g) || []).length
  ok(open === close, `T8a braces balanced (${open}/${close})`)
  ok(!/NaN|undefined|Infinity/.test(src), 'T8b no NaN/undefined/Infinity in emitted WGSL')
  const bareBad = src.split('\n').filter(l => !/i32|%/.test(l) && /(?<![\w.])\d+(?![.\w])/.test(l))
  ok(bareBad.length === 0, `T8c no bare ints in float contexts${bareBad.length ? ' :: ' + bareBad[0].trim() : ''}`)
  console.log('  emitted WGSL:', src.split('\n').length, 'lines')
}

// T9: NO OVERSHOOT — the clipping-bug regression test. Marching is safe iff
// the returned distance never EXCEEDS the true distance to geometry (under-
// estimates merely slow the march; the old constant-1e5 reject overshot by
// ~1e5 and rays tunneled through walls just past the AABB).
{
  const rng = mulberry32(777)
  const un = unroll(g)
  const bl = g.bounds.lo, bh = g.bounds.hi
  let worstFar = 0, worstNear = 0
  const dbOf = (p) => {
    const q = [0, 1, 2].map(i => Math.max(Math.abs(p[i] - (bl[i] + bh[i]) / 2) - (bh[i] - bl[i]) / 2, 0))
    return Math.hypot(...q)
  }
  for (let i = 0; i < 12000; i++) {
    // sample a wide band including outside the bounds — where the bug lived
    const p = [bl[0] - 4 + rng() * (bh[0] - bl[0] + 8), bl[1] - 2 + rng() * (bh[1] - bl[1] + 6), bl[2] - 6 + rng() * (bh[2] - bl[2] + 12)]
    const over = sdGraphCellScheme(g, p) - sdGraph(g, p, un)
    if (dbOf(p) > 0.5) { if (over > worstFar) worstFar = over }
    else if (over > worstNear) worstNear = over
  }
  // beyond the 0.5 early-out margin the AABB distance must be a strict lower
  // bound (old 1e5 bug); within it, full eval runs and only smin ordering
  // noise up to ~k/4 is tolerated (same class T3 bounds)
  ok(worstFar < 1e-6, `T9a beyond AABB margin: never overshoots (worst +${worstFar.toFixed(6)})`)
  ok(worstNear < 0.035, `T9b near/inside: overshoot bounded by smin ordering noise (+${worstNear.toFixed(4)})`)
}

// T10: live-growth emission — gated elements, swelling radii, ungated cuts
{
  const src = emitWGSL(g, 'mod_test_growing', { strut: 'mod_vf3_strut', bez: 'mod_vf3_bez', box: 'mod_vf3_box', smin: 'opSmoothUnion' }, { growUniform: 38, cellStagger: 0.6 })
  const open = (src.match(/\{/g) || []).length, close = (src.match(/\}/g) || []).length
  ok(open === close, `T10a growth WGSL braces balanced (${open}/${close})`)
  ok(src.includes('uni(38)'), 'T10b progress read from the whiteboard uniform')
  ok((src.match(/let gw\d+ = clamp\(/g) || []).length >= 8, 'T10c elements gated by construction order')
  ok(/\* gw\d+\)/.test(src), 'T10d radii swell with growth')
  const cutLines = src.split('\n').filter(l => l.includes('-max('))
  ok(cutLines.every(l => !l.includes('gw')), 'T10e cuts never growth-gated')
  // ungrown (uni=0) must still be a valid SDF: nothing but the AABB early-out
  ok(src.includes('let gbf = clamp(uni(38)'), 'T10f progress clamped')
}

// T11: gable emission — its openings live in graph.cuts; the helper must emit
{
  const gg = growGable({
    seed: 3, line: { z: 39 }, plot: { width: 21 },
    steps: 4, heightRatio: [0.55, 0.66], stepShrink: [1.0, 1.4],
    thicknessRatio: [0.094, 0.096], pinnacleRatio: [0.5, 0.8], spireRatio: [0.28, 0.4],
  })
  const src = emitWGSL(gg, 'mod_test_gable', { strut: 'mod_vf3_strut', bez: 'mod_vf3_bez', box: 'mod_vf3_box', smin: 'opSmoothUnion' })
  ok(src.includes('fn mod_test_gable_op('), 'T11a gable opening helper emitted (cuts scanned)')
  const open2 = (src.match(/\{/g) || []).length, close2 = (src.match(/\}/g) || []).length
  ok(open2 === close2, `T11b gable braces balanced (${open2}/${close2})`)
  ok(!/undefined|NaN/.test(src), 'T11c gable emission clean')
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURES`)
process.exit(fails === 0 ? 0 : 1)
