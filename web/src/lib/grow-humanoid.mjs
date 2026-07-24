// growHumanoid — figures grown from the classical proportion canon.
// The canon is measured in HEAD-HEIGHTS (the artists' unit for 2000 years):
// figure = 7.2-8 heads tall, shoulders ~2 heads wide, arm span ~ height,
// pubis at the midpoint, knee ~2 heads up. Canon as guideline ranges ->
// malformed figures impossible by construction. Reuses the GROW kit wholesale:
// struts/beziers between SHARED joint nodes, tissue = flesh at the joints,
// mirrorX = bilateral symmetry. Output graph works with sdGraph/emitWGSL as-is.
import { mulberry32, resolveGuidelines } from './grow-building.mjs'

const V = (x, y, z) => [x, y, z]
const d2r = (a) => a * Math.PI / 180

export const HUMANOID_DEFAULTS = {
  seed: 1,
  height: 2.2,                       // world units, ground to crown
  heads: [7.4, 8.0],                 // canon: 7.5 natural, 8 heroic
  build: [0.9, 1.1],                 // radius multiplier: slender <-> heavy
  shoulderHeads: [1.85, 2.15],       // shoulder width in heads
  pelvisHeads: [1.35, 1.55],
  armAngle: [8, 20],                 // degrees out from the body
  forearmPitch: [6, 16],             // degrees forward at the elbow
  kneeBend: [2, 7],                  // degrees — dead-straight legs read robotic
  stance: [0.5, 0.7],                // foot spread as fraction of pelvis width
  spineSway: [0.1, 0.18],            // S-curve depth in heads
  tissue: [0.5, 0.75],               // joint melt vs limb radius
  at: { x: 0, y: 0, z: 0 },          // where the figure stands
  face: 0,                           // radians yaw (0 = facing +z)
}

export function growHumanoid(guidelines) {
  const cfg = { ...HUMANOID_DEFAULTS, ...guidelines }
  const rng = mulberry32(cfg.seed ?? 1)
  const g = resolveGuidelines(cfg, rng)
  const T = g.height
  const H = T / g.heads                    // one head-height
  const B = g.build

  // canon levels (y from ground)
  const chinY = T - H
  const shoulderY = T - 1.35 * H
  const chestY = T - 2.1 * H
  const navelY = T - 3 * H
  const pubisY = T - 4 * H                 // canon midpoint
  const kneeY = 2 * H
  const ankleY = 0.32 * H

  const shX = g.shoulderHeads * H / 2      // shoulder joint x
  const hipX = g.pelvisHeads * H * 0.32
  const footX = g.pelvisHeads * H / 2 * g.stance

  const els = []
  const K = (r) => g.tissue * r            // flesh at a joint scales with the limb

  // -- axial skeleton --
  const sway = g.spineSway * H
  // spine: an S-curved bezier, never a straight rod
  els.push({ kind: 'bez', a: V(0, pubisY + 0.2 * H, 0), ctl: V(0, navelY, -sway), b: V(0, shoulderY - 0.15 * H, 0.02), r: 0.30 * H * B, tissue: 0 })
  // organic masses are CAPSULES, never boxes (boxes read robotic): ribcage
  // tapers down to the waist, pelvis is a horizontal capsule across the hips
  // chest is WIDE laterally (a horizontal capsule under the clavicles) and
  // tapers down the obliques to the waist
  els.push({ kind: 'strut', a: V(-0.5 * H, chestY + 0.35 * H, -0.02), b: V(0.5 * H, chestY + 0.35 * H, -0.02), r1: 0.44 * H * B, r2: 0.44 * H * B, tissue: K(0.3 * H) * 2.2 })
  els.push({ kind: 'strut', a: V(0, chestY + 0.2 * H, -0.01), b: V(0, chestY - 0.6 * H, 0.0), r1: 0.42 * H * B, r2: 0.30 * H * B, tissue: K(0.3 * H) * 2.0 })
  const hipY = pubisY + 0.34 * H
  els.push({ kind: 'strut', a: V(-g.pelvisHeads * H * 0.26, hipY, 0), b: V(g.pelvisHeads * H * 0.26, hipY, 0), r1: 0.32 * H * B, r2: 0.32 * H * B, tissue: K(0.3 * H) * 2.0 })
  // neck (short) -> skull (a full head tall: cranium + jaw taper to the chin)
  els.push({ kind: 'strut', a: V(0, shoulderY, 0.02), b: V(0, chinY + 0.05 * H, 0.05), r1: 0.19 * H * B, r2: 0.16 * H * B, tissue: K(0.19 * H) * 1.8 })
  els.push({ kind: 'strut', a: V(0, T - 0.38 * H, 0.0), b: V(0, T - 0.5 * H, 0.02), r1: 0.46 * H, r2: 0.44 * H, tissue: K(0.2 * H) })
  els.push({ kind: 'strut', a: V(0, T - 0.58 * H, 0.04), b: V(0, chinY + 0.08 * H, 0.07), r1: 0.32 * H, r2: 0.15 * H, tissue: K(0.3 * H) * 2.2 })

  // -- arms (mirrorX: both sides from one description) --
  const aA = d2r(g.armAngle), fP = d2r(g.forearmPitch)
  const upperL = 1.28 * H, foreL = 1.02 * H, handL = 0.62 * H   // canon: fingertips at mid-thigh, span ~ height
  const sh = V(shX, shoulderY, 0)
  const elbow = V(shX + Math.sin(aA) * upperL, shoulderY - Math.cos(aA) * upperL, 0)
  const wrist = V(elbow[0] + Math.sin(aA * 0.6) * foreL, elbow[1] - Math.cos(aA * 0.6) * foreL * Math.cos(fP), elbow[2] + Math.sin(fP) * foreL)
  const handTip = V(wrist[0] + 0.02, wrist[1] - handL * 0.9, wrist[2] + 0.12 * H)
  // clavicle from the spine top OUT to the shoulder node (shared)
  els.push({ kind: 'strut', a: V(0.05, shoulderY + 0.05 * H, 0.05), b: sh, r1: 0.15 * H * B, r2: 0.19 * H * B, tissue: K(0.3 * H) * 1.5, mirrorX: true })
  // deltoid caps the shoulder joint
  els.push({ kind: 'strut', a: sh, b: V(sh[0] + 0.02, sh[1] - 0.18 * H, 0), r1: 0.21 * H * B, r2: 0.18 * H * B, tissue: K(0.2 * H) * 1.4, mirrorX: true })
  els.push({ kind: 'strut', a: sh, b: elbow, r1: 0.19 * H * B, r2: 0.14 * H * B, tissue: K(0.15 * H), mirrorX: true })
  els.push({ kind: 'strut', a: elbow, b: wrist, r1: 0.14 * H * B, r2: 0.10 * H * B, tissue: K(0.11 * H), mirrorX: true })
  els.push({ kind: 'strut', a: wrist, b: handTip, r1: 0.10 * H * B, r2: 0.035 * H, tissue: K(0.08 * H), mirrorX: true })

  // -- legs --
  const kB = d2r(g.kneeBend)
  const hip = V(hipX, pubisY + 0.18 * H, 0)
  const knee = V((hipX + footX) / 2, kneeY, 0.02 + Math.sin(kB) * 0.3 * H)
  const ankle = V(footX, ankleY, 0)
  els.push({ kind: 'strut', a: hip, b: knee, r1: 0.33 * H * B, r2: 0.19 * H * B, tissue: K(0.28 * H) * 1.7, mirrorX: true })
  els.push({ kind: 'strut', a: knee, b: ankle, r1: 0.20 * H * B, r2: 0.12 * H * B, tissue: K(0.14 * H), mirrorX: true })
  // a real foot: wedge capsule, heel behind the ankle
  els.push({ kind: 'strut', a: V(footX, 0.16 * H, -0.25 * H), b: V(footX, 0.1 * H, 0.62 * H), r1: 0.13 * H * B, r2: 0.09 * H, tissue: K(0.11 * H) * 1.3, mirrorX: true })

  // place in world: translate (+ optional yaw about y)
  const cy = Math.cos(g.face || 0), sy = Math.sin(g.face || 0)
  const place = (p) => V(cfg.at.x + p[0] * cy + p[2] * sy, cfg.at.y + p[1], cfg.at.z - p[0] * sy + p[2] * cy)
  for (const e of els) {
    if (e.a) e.a = place(e.a)
    if (e.b && e.kind !== 'box') e.b = place(e.b)
    if (e.ctl) e.ctl = place(e.ctl)
    if (e.c) e.c = place(e.c)
  }
  // NOTE on mirrorX + placement: mirror happens in EVAL space (abs(p.x)), so a
  // figure meant to mirror about its own axis must stand at x=0 of the space
  // it is evaluated in — offset figures should be evaluated with a shifted p
  // (wrap the emitted fn call) rather than baked offsets. face/yaw ditto.

  // Vitruvian span = outstretched anatomy, not the hanging pose
  const armSpan = 2 * (upperL + foreL + handL) + 2 * shX
  const pad = Math.max(armSpan / 2, 0.8 * H) + 0.4
  return {
    kind: 'humanoid',
    statics: els, repeats: [], cuts: [],
    bounds: { lo: V(cfg.at.x - pad, cfg.at.y - 0.5, cfg.at.z - pad), hi: V(cfg.at.x + pad, cfg.at.y + T + 0.4, cfg.at.z + pad) },
    meta: {
      height: T, headH: H, heads: g.heads, build: B,
      shoulderW: 2 * shX, pelvisW: g.pelvisHeads * H, armSpan,
      levels: { chinY, shoulderY, chestY, navelY, pubisY, kneeY },
      resolved: g,
    },
  }
}

// canon validators for figures (the building validators don't know anatomy)
export function validateHumanoid(graph) {
  const m = graph.meta
  const errs = []
  const heads = m.height / m.headH
  // offCanon: monsters break the human canon ON PURPOSE — declared wrongness
  // is a design tool (uncanny = deviation you can measure); undeclared
  // deviation is a bug. Structural sanity still applies to everything.
  const off = !!m.resolved.offCanon
  if (heads < 5.5 || heads > 9) errs.push(`figure is ${heads.toFixed(1)} heads tall (5.5-9 structural limit)`)
  if (m.shoulderW < m.pelvisW) errs.push('shoulders narrower than pelvis')
  if (!off) {
    if (heads < 6.8 || heads > 8.4) errs.push(`canon: ${heads.toFixed(1)} heads tall (6.8-8.4)`)
    const spanRatio = m.armSpan / m.height  // anatomical span (limb lengths), not pose
    if (spanRatio < 0.86 || spanRatio > 1.12) errs.push(`canon: arm span ${spanRatio.toFixed(2)} x height (Vitruvian ~1.0)`)
    if (m.levels.pubisY < 0.44 * m.height || m.levels.pubisY > 0.56 * m.height) errs.push(`canon: midpoint at ${(m.levels.pubisY / m.height).toFixed(2)} of height (pubis ~0.5)`)
  }
  return errs
}
