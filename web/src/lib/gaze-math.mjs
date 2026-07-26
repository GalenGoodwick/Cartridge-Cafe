// gaze-math — ray/plane/ray geometry for the "seeing is touching" substrate.
//
// Platform infrastructure, not VIGIL-specific: any world whose interactions are
// broadcast rays meeting effect-planes reuses these. Pure, dependency-free, and
// unit-tested to analytic exactness (see __tests__/unit/gaze-math.test.mjs) so
// the JS logic layer and the WGSL render layer can march the SAME geometry —
// the "one truth for render + collide" discipline, in numbers.
//
// Vectors are plain 3-element arrays [x, y, z]. Every function is total: it
// returns null / {hit:false} rather than NaN on a degenerate input.

// ── vec3 helpers (exported: the shader mirrors these, tests pin them) ──
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
export const length = (a) => Math.sqrt(dot(a, a))
export function normalize(a) {
  const L = length(a)
  return L > 1e-12 ? [a[0] / L, a[1] / L, a[2] / L] : [0, 0, 0]
}

/**
 * Ray vs infinite plane. Plane is a point + normal (normal need not be unit).
 * Returns the forward hit distance t >= 0, or null when the ray is parallel to
 * the plane or would only hit it behind the origin.
 *
 * @returns {number|null} t along rd, or null
 */
export function rayPlaneHit(ro, rd, planePoint, planeNormal, eps = 1e-9) {
  const denom = dot(rd, planeNormal)
  if (Math.abs(denom) < eps) return null // parallel — no forward hit
  const t = dot(sub(planePoint, ro), planeNormal) / denom
  return t >= 0 ? t : null // only forward hits count (a gaze goes forward)
}

/**
 * Closest approach between two INFINITE lines (each an origin + direction).
 * Directions need not be unit. Returns the line parameters, the distance
 * between the closest points, and their midpoint. For forward RAYS, the caller
 * checks tA >= 0 && tB >= 0. Handles the parallel case without dividing by zero.
 *
 * @returns {{distance:number, midpoint:number[], tA:number, tB:number, parallel:boolean}}
 */
export function raysClosestApproach(aO, aD, bO, bD, eps = 1e-9) {
  const r = sub(aO, bO)
  const a = dot(aD, aD)
  const c = dot(bD, bD)
  const b = dot(aD, bD)
  const d = dot(aD, r)
  const e = dot(bD, r)
  const denom = a * c - b * b

  let tA, tB, parallel = false
  if (Math.abs(denom) < eps) {
    // Parallel (or a degenerate zero-length direction): pin A at its origin and
    // project onto B. This yields the true perpendicular gap between the lines.
    parallel = true
    tA = 0
    tB = c > eps ? e / c : 0
  } else {
    tA = (b * e - c * d) / denom
    tB = (a * e - b * d) / denom
  }

  const pA = add(aO, scale(aD, tA))
  const pB = add(bO, scale(bD, tB))
  return {
    distance: length(sub(pA, pB)),
    midpoint: scale(add(pA, pB), 0.5),
    tA,
    tB,
    parallel,
  }
}

/**
 * Is a point inside a bounded planar quad? The pane is an origin corner plus two
 * edge vectors uAxis, vAxis; the quad spans origin + s*uAxis + t*vAxis for
 * s,t in [0,1]. Returns the barycentric-ish (s,t), whether the point lies within
 * the quad, and its perpendicular distance off the pane's plane (so a caller can
 * require the crossing to actually land ON the glass, not just over its shadow).
 *
 * @returns {{inside:boolean, s:number, t:number, perp:number}}
 */
export function pointInPaneUV(p, pane, planeTol = 1e-6) {
  const { origin, uAxis, vAxis } = pane
  const dvec = sub(p, origin)
  const uu = dot(uAxis, uAxis)
  const vv = dot(vAxis, vAxis)
  const s = uu > 1e-12 ? dot(dvec, uAxis) / uu : 0
  const t = vv > 1e-12 ? dot(dvec, vAxis) / vv : 0
  // perpendicular component off the plane
  const n = normalize(cross(uAxis, vAxis))
  const perp = Math.abs(dot(dvec, n))
  const inside = s >= 0 && s <= 1 && t >= 0 && t <= 1 && perp <= planeTol
  return { inside, s, t, perp }
}

/**
 * Sphere-trace a signed distance function. This is the JS mirror of the WGSL
 * march — the render shader and this logic walk the SAME field, so a gaze that
 * lights a pane on screen is the gaze that triggers it in logic. `sdf(p)` must
 * return the signed distance (negative inside).
 *
 * @param {number[]} ro ray origin
 * @param {number[]} rd ray direction (should be unit for t to read as distance)
 * @param {(p:number[])=>number} sdf
 * @returns {{hit:boolean, t:number, p:number[], steps:number}}
 */
export function marchSDF(ro, rd, sdf, { maxT = 100, maxSteps = 128, eps = 1e-3 } = {}) {
  let t = 0
  for (let i = 0; i < maxSteps; i++) {
    const p = add(ro, scale(rd, t))
    const dist = sdf(p)
    if (dist < eps) return { hit: true, t, p, steps: i }
    t += dist
    if (t > maxT) break
  }
  return { hit: false, t, p: add(ro, scale(rd, t)), steps: maxSteps }
}

/**
 * The composite query VIGIL fires: do two gaze rays cross, close enough, INSIDE
 * a given pane, and in front of both emitters? One call = the whole "ray ∩ ray ∩
 * pane" trigger. Returns the crossing point when it fires.
 *
 * @returns {{fires:boolean, point:number[]|null, gap:number}}
 */
export function gazeCrossOnPane(aO, aD, bO, bD, pane, { maxGap = 0.25 } = {}) {
  const ca = raysClosestApproach(aO, aD, bO, bD)
  if (ca.tA < 0 || ca.tB < 0) return { fires: false, point: null, gap: ca.distance }
  if (ca.distance > maxGap) return { fires: false, point: null, gap: ca.distance }
  const inPane = pointInPaneUV(ca.midpoint, pane, maxGap)
  return { fires: inPane.inside, point: inPane.inside ? ca.midpoint : null, gap: ca.distance }
}
