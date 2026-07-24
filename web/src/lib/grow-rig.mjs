// growDemonRig — GROWN RIGS: the grower emits an articulated, self-posing
// body. Joint positions are FUNCTIONS of (time, seed): hips breathe and sway,
// two-bone IK keeps feet planted, the hunched spine weaves, claws flex, the
// tail lashes. Grotesquerie is a GRAMMAR (digitigrade hocks, hunch, arm reach,
// ribs, horns, fangs, seeded asymmetry) — offCanon by declaration. A bounded
// displacement pass gives hide texture.
//
// ARCHITECTURE (one truth): ALL coordinate arithmetic lives in poseJoints();
// the body is a pure CONNECTIVITY TABLE (rigTable) between named joints.
// JS eval and the WGSL emitter iterate the SAME table; only the pose math is
// printed twice (JS + emitted WGSL), with every constant baked from the same
// grown P — formulas are mirrored line-for-line, numbers cannot drift.
import { mulberry32, resolveGuidelines, sdStrut, sdBez, smin } from './grow-building.mjs'

const d2r = (a) => a * Math.PI / 180

export const DEMON_DEFAULTS = {
  seed: 5,
  height: 2.3,
  heads: [5.0, 5.8],           // big skull = wrong = grotesque
  build: [1.0, 1.2],
  hunch: [0.55, 0.8],
  armReach: [1.25, 1.5],
  shoulderHeads: [2.1, 2.4],
  hockHeight: [0.32, 0.42],
  stance: [0.7, 0.95],
  ribs: 3,
  hornCurl: [30, 70],
  hornLen: [0.75, 1.1],
  tailLen: [1.6, 2.2],
  clawLen: [0.28, 0.4],
  asym: [0.04, 0.1],
  sway: [0.1, 0.16],
  breath: [0.05, 0.09],
  tempo: [0.9, 1.4],
  detailAmp: [0.02, 0.035],    // displacement amplitude (marcher-safe <= 0.04)
  detailFreq: [5.0, 8.0],
}

// clamp an effector target within chain reach (unreachable targets would
// stretch the far segment — rubber limbs; R1 guards this)
export function clampTo(a, b, maxL) {
  const v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const l = Math.hypot(...v)
  if (l <= maxL) return b
  return [a[0] + v[0] / l * maxL, a[1] + v[1] / l * maxL, a[2] + v[2] / l * maxL]
}
// two-bone IK, closed form — mirrored EXACTLY by the emitted WGSL helper
export function ik2(a, b, l1, l2, pole) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const d = Math.hypot(...ab)
  const dc = Math.min(d, l1 + l2 - 1e-4)
  const n = [ab[0] / (d || 1), ab[1] / (d || 1), ab[2] / (d || 1)]
  const x = (dc * dc + l1 * l1 - l2 * l2) / (2 * dc)
  const h = Math.sqrt(Math.max(l1 * l1 - x * x, 0))
  const pd = pole[0] * n[0] + pole[1] * n[1] + pole[2] * n[2]
  let pp = [pole[0] - n[0] * pd, pole[1] - n[1] * pd, pole[2] - n[2] * pd]
  const pl = Math.hypot(...pp) || 1
  pp = [pp[0] / pl, pp[1] / pl, pp[2] / pl]
  return [a[0] + n[0] * x + pp[0] * h, a[1] + n[1] * x + pp[1] * h, a[2] + n[2] * x + pp[2] * h]
}

export function growDemonRig(guidelines) {
  const cfg = { ...DEMON_DEFAULTS, ...guidelines }
  const rng = mulberry32(cfg.seed ?? 5)
  const g = resolveGuidelines(cfg, rng)
  const T = g.height
  const H = T / g.heads
  const B = g.build
  const legL = 2.6 * H
  const armL = 2.9 * H * g.armReach
  const jit = () => (rng() - 0.5) * 2 * g.asym
  return {
    T, H, B, hunch: g.hunch,
    hipH: legL * 0.82, thighL: legL * 0.48, shankL: legL * 0.34, metaL: legL * 0.3,
    shX: g.shoulderHeads * H / 2, spineL: 2.2 * H,
    upperL: armL * 0.44, foreL: armL * 0.4, handL: armL * 0.16,
    stanceX: g.stance * 0.7 * H, hockH: g.hockHeight * legL,
    ribs: g.ribs | 0, hornCurl: d2r(g.hornCurl), hornLen: g.hornLen * H,
    tailLen: g.tailLen * H, clawLen: g.clawLen * H,
    sway: g.sway, breath: g.breath, tempo: g.tempo,
    detailAmp: g.detailAmp, detailFreq: g.detailFreq,
    jitters: { armL: jit(), armR: jit(), legL: jit(), legR: jit(), hornL: jit(), hornR: jit() },
    radii: {
      spine: 0.30 * H * B, chest: 0.34 * H * B, core: 0.30 * H * B, pelvis: 0.34 * H * B,
      neck: 0.13 * H * B, skull: 0.32 * H, jaw: 0.24 * H,
      upper: 0.16 * H * B, fore: 0.12 * H * B, hand: 0.07 * H * B,
      thigh: 0.22 * H * B, shank: 0.13 * H * B, meta: 0.09 * H * B,
      rib: 0.045 * H, horn: 0.125 * H, tail: 0.17 * H * B, claw: 0.035 * H,
    },
    resolved: g,
  }
}

// ---- THE pose (JS caller). emitRigWGSL prints this math line-for-line. ----
export function poseJoints(P, time, seed) {
  const t = time * P.tempo + seed * 3.1
  const br = Math.sin(t * 1.7) * P.breath
  const sw = Math.sin(t * 0.9) * P.sway
  const wv = Math.sin(t * 0.53 + 1.2)
  const H = P.H

  const J = {}
  J.hip = [sw * 0.6, P.hipH + br * 0.5, 0]
  J.chest = [sw * 1.2 + wv * 0.05, J.hip[1] + P.spineL * (1 - P.hunch * 0.38), P.spineL * P.hunch * 0.62]
  J.spineCtl = [sw * 0.9, J.hip[1] + P.spineL * 0.85, -P.spineL * 0.15]
  J.coreHip = [J.hip[0], J.hip[1] + 0.1 * H, J.hip[2]]
  // predator neck: head thrusts FORWARD, low, hunting
  J.head = [J.chest[0] + wv * 0.1, J.chest[1] + 0.08 * H, J.chest[2] + 1.35 * H + br * 0.3]
  J.skullBack = [J.head[0], J.head[1] + 0.06 * H, J.head[2] - 0.3 * H]
  J.jawTip = [J.head[0], J.head[1] - 0.5 * H - Math.max(0, Math.sin(t * 0.31)) * 0.14 * H, J.head[2] + 0.45 * H]

  for (const side of [1, -1]) {
    const s = side === 1 ? 'R' : 'L'
    const aj = 1 + P.jitters['arm' + s]
    const lj = 1 + P.jitters['leg' + s]
    const hj = 1 + P.jitters['horn' + s]
    const phase = side === 1 ? 0 : 2.2
    // planted digitigrade leg: foot fixed; hock on a fixed metatarsal slope;
    // knee = IK(hipSock->hock), pole forward (shank rakes back)
    J['foot' + s] = [side * P.stanceX * lj, 0, P.jitters['leg' + s] * 0.4 * side]
    J['hock' + s] = [J['foot' + s][0], P.hockH * lj, J['foot' + s][2] - P.metaL * 0.55]
    J['hipSock' + s] = [J.hip[0] + side * 0.45 * H, J.hip[1], J.hip[2]]
    J['hock' + s] = clampTo(J['hipSock' + s], J['hock' + s], (P.thighL + P.shankL) * lj - 1e-3)
    J['knee' + s] = ik2(J['hipSock' + s], J['hock' + s], P.thighL * lj, P.shankL * lj, [side * 0.15, 0, 1])
    J['pad' + s] = [J['foot' + s][0], 0.05, J['foot' + s][2] + 0.45 * H]
    // long arm: claw hand flexes near the ground, elbow IK pole out-back
    J['sh' + s] = [J.chest[0] + side * P.shX, J.chest[1] - 0.05 * H, J.chest[2] + 0.1 * H]
    const flex = Math.sin(t * 1.1 + phase) * 0.12
    J['hand' + s] = [J['sh' + s][0] + side * 0.35 * H, 0.55 * H + flex * H, J.chest[2] + 0.9 * H + flex * 0.5]
    J['hand' + s] = clampTo(J['sh' + s], J['hand' + s], (P.upperL + P.foreL) * aj - 1e-3)
    J['elbow' + s] = ik2(J['sh' + s], J['hand' + s], P.upperL * aj, P.foreL * aj, [side, 0.15, -0.4])
    for (let c = 0; c < 3; c++) {
      J['claw' + s + c] = [J['hand' + s][0] + (c - 1) * 0.12 * H, Math.max(J['hand' + s][1] - P.clawLen, 0.02), J['hand' + s][2] + P.clawLen * 0.9]
    }
    // horns sweep back along the neck line from the skull crown
    J['hornB' + s] = [J.head[0] + side * 0.2 * H, J.head[1] + 0.22 * H, J.head[2] - 0.15 * H]
    J['hornC' + s] = [J['hornB' + s][0] + side * 0.3 * H, J['hornB' + s][1] + P.hornLen * 0.7 * hj, J['hornB' + s][2] - P.hornLen * 0.9 * Math.sin(P.hornCurl) * hj]
    J['hornT' + s] = [J['hornB' + s][0] + side * 0.18 * H, J['hornB' + s][1] + P.hornLen * 0.25 * hj, J['hornB' + s][2] - P.hornLen * 1.2 * hj]
    // up-fangs from the jaw
    J['fangB' + s] = [J.jawTip[0] + side * 0.16 * H, J.jawTip[1] + 0.02, J.jawTip[2] - 0.08 * H]
    J['fangT' + s] = [J['fangB' + s][0] + side * 0.03, J['fangB' + s][1] + 0.3 * H, J['fangB' + s][2] + 0.1 * H]
  }
  // exposed ribs: hoops from the spine ridge to the sternum line
  for (let i = 0; i < P.ribs; i++) {
    const f = (i + 1) / (P.ribs + 1)
    J['ribB' + i] = [J.hip[0] * (1 - f) + J.spineCtl[0] * f, J.hip[1] * (1 - f) + J.spineCtl[1] * f + 0.15 * H, J.hip[2] * (1 - f) + J.chest[2] * f * 0.9]
    J['ribF' + i] = [J['ribB' + i][0], J['ribB' + i][1] - 0.55 * H, J['ribB' + i][2] + (0.72 - f * 0.2) * H]
    for (const side of [1, -1]) {
      const s = side === 1 ? 'R' : 'L'
      J['ribC' + s + i] = [J['ribB' + i][0] + side * (0.62 - f * 0.15) * H, (J['ribB' + i][1] + J['ribF' + i][1]) / 2, (J['ribB' + i][2] + J['ribF' + i][2]) / 2]
    }
  }
  // tail: two-bezier lash
  const lash = Math.sin(t * 1.3 + 0.7)
  J.tailMid = [-lash * 0.35 * H + J.hip[0], J.hip[1] + 0.25 * H, J.hip[2] - P.tailLen * 0.5]
  J.tailTip = [lash * 0.8 * H + J.hip[0], J.hip[1] - 0.1 * H + Math.abs(lash) * 0.3 * H, J.hip[2] - P.tailLen]
  J.tailC1 = [J.hip[0], J.hip[1] + 0.3 * H, J.hip[2] - P.tailLen * 0.25]
  J.tailC2 = [(J.tailMid[0] + J.tailTip[0]) / 2, J.tailMid[1] + 0.2 * H, (J.tailMid[2] + J.tailTip[2]) / 2]
  return J
}

// ---- the body: PURE connectivity between named joints (data, not code) ----
export function rigTable(P) {
  const R = P.radii
  const T = []
  const E = (kind, a, b, r1, r2, tissue, ctl) => T.push({ kind, a, b, r1, r2, tissue, ctl })
  E('bez', 'hip', 'chest', R.spine, R.spine, 0, 'spineCtl')
  E('strut', 'hipSockL', 'hipSockR', R.pelvis, R.pelvis, R.spine * 0.9)
  E('strut', 'shL', 'shR', R.chest, R.chest, R.spine * 1.1)
  E('strut', 'chest', 'coreHip', R.core, R.pelvis * 0.9, R.core)
  E('strut', 'chest', 'head', R.neck, R.neck * 0.85, R.neck * 1.2)
  E('strut', 'skullBack', 'head', R.skull * 0.9, R.skull, R.neck)
  E('strut', 'head', 'jawTip', R.jaw, R.jaw * 0.3, R.jaw * 0.9)
  for (const s of ['L', 'R']) {
    E('bez', 'hornB' + s, 'hornT' + s, R.horn, 0.015, R.horn * 0.6, 'hornC' + s)
    E('strut', 'fangB' + s, 'fangT' + s, R.claw * 2.6, 0.008, R.claw * 1.5)
    E('strut', 'sh' + s, 'elbow' + s, R.upper, R.fore, R.upper * 0.8)
    E('strut', 'elbow' + s, 'hand' + s, R.fore, R.hand, R.fore * 0.8)
    for (let c = 0; c < 3; c++) E('strut', 'hand' + s, 'claw' + s + c, R.claw * 2.2, 0.008, R.claw * 2)
    E('strut', 'hipSock' + s, 'knee' + s, R.thigh, R.shank, R.thigh * 0.8)
    E('strut', 'knee' + s, 'hock' + s, R.shank, R.meta, R.shank * 0.8)
    E('strut', 'hock' + s, 'foot' + s, R.meta, R.meta * 0.8, R.meta * 0.8)
    E('strut', 'foot' + s, 'pad' + s, R.meta, 0.03, R.meta)
  }
  for (let i = 0; i < P.ribs; i++) for (const s of ['L', 'R']) {
    E('bez', 'ribB' + i, 'ribF' + i, R.rib, R.rib * 0.8, R.rib * 1.2, 'ribC' + s + i)
  }
  E('bez', 'hip', 'tailMid', R.tail, R.tail * 0.6, R.tail * 0.8, 'tailC1')
  E('bez', 'tailMid', 'tailTip', R.tail * 0.6, 0.02, R.tail * 0.5, 'tailC2')
  return T
}

// hide texture (JS mirror; the WGSL uses the engine's fbm3 — grain differs
// stochastically, FORM and amplitude match)
const h3 = (x, y, z) => {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
export function detail3(p, freq, amp) {
  const q = [p[0] * freq, p[1] * freq, p[2] * freq]
  const i = q.map(Math.floor), f = q.map(v => v - Math.floor(v))
  const u = f.map(v => v * v * (3 - 2 * v))
  let acc = 0
  for (let dz = 0; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
    const w = (dx ? u[0] : 1 - u[0]) * (dy ? u[1] : 1 - u[1]) * (dz ? u[2] : 1 - u[2])
    acc += w * h3(i[0] + dx, i[1] + dy, i[2] + dz)
  }
  return (acc - 0.5) * 2 * amp
}

export function sdRigDemon(P, p, time, seed) {
  const J = poseJoints(P, time, seed)
  let d = 1e9
  for (const e of rigTable(P)) {
    const de = e.kind === 'bez' ? sdBez(p, J[e.a], J[e.ctl], J[e.b], e.r1) : sdStrut(p, J[e.a], J[e.b], e.r1, e.r2)
    d = smin(d, de, e.tissue || 0)
  }
  if (d < 0.35) d += detail3(p, P.detailFreq, P.detailAmp) * Math.min(1, Math.max(0, (0.35 - d) / 0.3))
  return d
}
export function rigReach(P) {
  return Math.max(P.spineL * P.hunch * 0.62 + 1.9 * P.H, P.tailLen + 0.4, 2.1)
}

// ---- WGSL emitter: prints poseJoints line-for-line + walks the SAME table ----
const fw = (x) => {
  const s = (Math.round(x * 100000) / 100000).toString()
  return s.includes('.') || s.includes('e') ? s : s + '.0'
}
export function emitRigWGSL(P, name, prims) {
  const R = P.radii
  const L = []
  L.push(`// GROWN RIG — emitted by grow-rig; regrow, never hand-edit.`)
  L.push(`fn ${name}_ik(a: vec3f, b: vec3f, l1: f32, l2: f32, pole: vec3f) -> vec3f {`)
  L.push(`  let ab = b - a;`)
  L.push(`  let dd = max(length(ab), 1e-5);`)
  L.push(`  let dc = min(dd, l1 + l2 - 1e-4);`)
  L.push(`  let n = ab / dd;`)
  L.push(`  let x = (dc * dc + l1 * l1 - l2 * l2) / (2.0 * dc);`)
  L.push(`  let h = sqrt(max(l1 * l1 - x * x, 0.0));`)
  L.push(`  var pp = pole - n * dot(pole, n);`)
  L.push(`  pp = pp / max(length(pp), 1e-5);`)
  L.push(`  return a + n * x + pp * h;`)
  L.push(`}`)
  L.push(`fn ${name}_cl(a: vec3f, b: vec3f, maxL: f32) -> vec3f {`)
  L.push(`  let v = b - a;`)
  L.push(`  let l = length(v);`)
  L.push(`  if (l <= maxL) { return b; }`)
  L.push(`  return a + v / l * maxL;`)
  L.push(`}`)
  L.push(`fn ${name}(p: vec3f, time: f32, seed: f32) -> f32 {`)
  // ---- pose (mirror of poseJoints; constants baked from P) ----
  L.push(`  let t = time * ${fw(P.tempo)} + seed * 3.1;`)
  L.push(`  let br = sin(t * 1.7) * ${fw(P.breath)};`)
  L.push(`  let sw = sin(t * 0.9) * ${fw(P.sway)};`)
  L.push(`  let wv = sin(t * 0.53 + 1.2);`)
  const H = P.H
  L.push(`  let j_hip = vec3f(sw * 0.6, ${fw(P.hipH)} + br * 0.5, 0.0);`)
  L.push(`  let j_chest = vec3f(sw * 1.2 + wv * 0.05, j_hip.y + ${fw(P.spineL * (1 - P.hunch * 0.38))}, ${fw(P.spineL * P.hunch * 0.62)});`)
  L.push(`  let j_spineCtl = vec3f(sw * 0.9, j_hip.y + ${fw(P.spineL * 0.85)}, ${fw(-P.spineL * 0.15)});`)
  L.push(`  let j_coreHip = vec3f(j_hip.x, j_hip.y + ${fw(0.1 * H)}, j_hip.z);`)
  L.push(`  let j_head = vec3f(j_chest.x + wv * 0.1, j_chest.y + ${fw(0.08 * H)}, j_chest.z + ${fw(1.35 * H)} + br * 0.3);`)
  L.push(`  let j_skullBack = vec3f(j_head.x, j_head.y + ${fw(0.06 * H)}, j_head.z - ${fw(0.3 * H)});`)
  L.push(`  let j_jawTip = vec3f(j_head.x, j_head.y - ${fw(0.5 * H)} - max(0.0, sin(t * 0.31)) * ${fw(0.14 * H)}, j_head.z + ${fw(0.45 * H)});`)
  for (const side of [1, -1]) {
    const s = side === 1 ? 'R' : 'L'
    const aj = 1 + P.jitters['arm' + s]
    const lj = 1 + P.jitters['leg' + s]
    const hj = 1 + P.jitters['horn' + s]
    const phase = side === 1 ? 0 : 2.2
    L.push(`  let j_foot${s} = vec3f(${fw(side * P.stanceX * lj)}, 0.0, ${fw(P.jitters['leg' + s] * 0.4 * side)});`)
    L.push(`  let j_hock${s} = vec3f(j_foot${s}.x, ${fw(P.hockH * lj)}, j_foot${s}.z - ${fw(P.metaL * 0.55)});`)
    L.push(`  let j_hipSock${s} = vec3f(j_hip.x + ${fw(side * 0.45 * H)}, j_hip.y, j_hip.z);`)
    L.push(`  let j_hockC${s} = ${name}_cl(j_hipSock${s}, j_hock${s}, ${fw((P.thighL + P.shankL) * lj - 1e-3)});`)
    L.push(`  let j_knee${s} = ${name}_ik(j_hipSock${s}, j_hockC${s}, ${fw(P.thighL * lj)}, ${fw(P.shankL * lj)}, vec3f(${fw(side * 0.15)}, 0.0, 1.0));`)
    L.push(`  let j_pad${s} = vec3f(j_foot${s}.x, 0.05, j_foot${s}.z + ${fw(0.45 * H)});`)
    L.push(`  let j_sh${s} = vec3f(j_chest.x + ${fw(side * P.shX)}, j_chest.y - ${fw(0.05 * H)}, j_chest.z + ${fw(0.1 * H)});`)
    L.push(`  let flex${s} = sin(t * 1.1 + ${fw(phase)}) * 0.12;`)
    L.push(`  var j_hand${s} = vec3f(j_sh${s}.x + ${fw(side * 0.35 * H)}, ${fw(0.55 * H)} + flex${s} * ${fw(H)}, j_chest.z + ${fw(0.9 * H)} + flex${s} * 0.5);`)
    L.push(`  j_hand${s} = ${name}_cl(j_sh${s}, j_hand${s}, ${fw((P.upperL + P.foreL) * aj - 1e-3)});`)
    L.push(`  let j_elbow${s} = ${name}_ik(j_sh${s}, j_hand${s}, ${fw(P.upperL * aj)}, ${fw(P.foreL * aj)}, vec3f(${fw(side)}, 0.15, -0.4));`)
    for (let c = 0; c < 3; c++) {
      L.push(`  let j_claw${s}${c} = vec3f(j_hand${s}.x + ${fw((c - 1) * 0.12 * H)}, max(j_hand${s}.y - ${fw(P.clawLen)}, 0.02), j_hand${s}.z + ${fw(P.clawLen * 0.9)});`)
    }
    L.push(`  let j_hornB${s} = vec3f(j_head.x + ${fw(side * 0.2 * H)}, j_head.y + ${fw(0.22 * H)}, j_head.z - ${fw(0.15 * H)});`)
    L.push(`  let j_hornC${s} = vec3f(j_hornB${s}.x + ${fw(side * 0.3 * H)}, j_hornB${s}.y + ${fw(P.hornLen * 0.7 * hj)}, j_hornB${s}.z - ${fw(P.hornLen * 0.9 * Math.sin(P.hornCurl) * hj)});`)
    L.push(`  let j_hornT${s} = vec3f(j_hornB${s}.x + ${fw(side * 0.18 * H)}, j_hornB${s}.y + ${fw(P.hornLen * 0.25 * hj)}, j_hornB${s}.z - ${fw(P.hornLen * 1.2 * hj)});`)
    L.push(`  let j_fangB${s} = vec3f(j_jawTip.x + ${fw(side * 0.16 * H)}, j_jawTip.y + 0.02, j_jawTip.z - ${fw(0.08 * H)});`)
    L.push(`  let j_fangT${s} = vec3f(j_fangB${s}.x + ${fw(side * 0.03)}, j_fangB${s}.y + ${fw(0.3 * H)}, j_fangB${s}.z + ${fw(0.1 * H)});`)
  }
  for (let i = 0; i < P.ribs; i++) {
    const f = (i + 1) / (P.ribs + 1)
    L.push(`  let j_ribB${i} = vec3f(j_hip.x * ${fw(1 - f)} + j_spineCtl.x * ${fw(f)}, j_hip.y * ${fw(1 - f)} + j_spineCtl.y * ${fw(f)} + ${fw(0.15 * H)}, j_hip.z * ${fw(1 - f)} + j_chest.z * ${fw(f * 0.9)});`)
    L.push(`  let j_ribF${i} = vec3f(j_ribB${i}.x, j_ribB${i}.y - ${fw(0.55 * H)}, j_ribB${i}.z + ${fw((0.72 - f * 0.2) * H)});`)
    for (const side of [1, -1]) {
      const s = side === 1 ? 'R' : 'L'
      L.push(`  let j_ribC${s}${i} = vec3f(j_ribB${i}.x + ${fw(side * (0.62 - f * 0.15) * H)}, (j_ribB${i}.y + j_ribF${i}.y) * 0.5, (j_ribB${i}.z + j_ribF${i}.z) * 0.5);`)
    }
  }
  L.push(`  let lash = sin(t * 1.3 + 0.7);`)
  L.push(`  let j_tailMid = vec3f(-lash * ${fw(0.35 * H)} + j_hip.x, j_hip.y + ${fw(0.25 * H)}, j_hip.z - ${fw(P.tailLen * 0.5)});`)
  L.push(`  let j_tailTip = vec3f(lash * ${fw(0.8 * H)} + j_hip.x, j_hip.y - ${fw(0.1 * H)} + abs(lash) * ${fw(0.3 * H)}, j_hip.z - ${fw(P.tailLen)});`)
  L.push(`  let j_tailC1 = vec3f(j_hip.x, j_hip.y + ${fw(0.3 * H)}, j_hip.z - ${fw(P.tailLen * 0.25)});`)
  L.push(`  let j_tailC2 = vec3f((j_tailMid.x + j_tailTip.x) * 0.5, j_tailMid.y + ${fw(0.2 * H)}, (j_tailMid.z + j_tailTip.z) * 0.5);`)
  // ---- body: the SAME connectivity table ----
  L.push(`  var d = 1e5;`)
  const jn = (n) => (n === 'hockL' || n === 'hockR') ? 'hockC' + n.slice(-1) : n
  for (const e of rigTable(P)) {
    const call = e.kind === 'bez'
      ? `${prims.bez}(p, j_${jn(e.a)}, j_${jn(e.ctl)}, j_${jn(e.b)}, ${fw(e.r1)})`
      : `${prims.strut}(p, j_${jn(e.a)}, j_${jn(e.b)}, ${fw(e.r1)}, ${fw(e.r2)})`
    L.push(e.tissue > 0 ? `  d = ${prims.smin}(d, ${call}, ${fw(e.tissue)});` : `  d = min(d, ${call});`)
  }
  // ---- detail pass: bounded hide displacement (marcher-safe amplitude) ----
  L.push(`  if (d < 0.35) {`)
  L.push(`    let dq = p * ${fw(P.detailFreq)};`)
  L.push(`    let dn = fbm3(dq.xy + vec2f(dq.z * 0.7, dq.z * 0.4)) + fbm3(dq.yz + vec2f(7.3, 2.1));`)
  L.push(`    d = d + (dn * 0.5 - 0.5) * ${fw(2 * P.detailAmp)} * clamp((0.35 - d) / 0.3, 0.0, 1.0);`)
  L.push(`  }`)
  L.push(`  return d;`)
  L.push(`}`)
  return L.join('\n')
}
