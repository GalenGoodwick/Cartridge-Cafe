import { describe, it, expect } from 'vitest'
import {
  sub, add, scale, dot, cross, length, normalize,
  rayPlaneHit, raysClosestApproach, pointInPaneUV, marchSDF, gazeCrossOnPane,
} from '../../lib/gaze-math.mjs'

const near = (a, b, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol)
const nearVec = (a, b, tol = 1e-9) => a.forEach((x, i) => near(x, b[i], tol))

describe('vec3 helpers', () => {
  it('basic arithmetic', () => {
    nearVec(sub([1, 2, 3], [1, 1, 1]), [0, 1, 2])
    nearVec(add([1, 2, 3], [1, 1, 1]), [2, 3, 4])
    nearVec(scale([1, 2, 3], 2), [2, 4, 6])
    near(dot([1, 0, 0], [0, 1, 0]), 0)
    near(dot([1, 2, 3], [1, 2, 3]), 14)
  })
  it('cross is right-handed', () => nearVec(cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]))
  it('length and normalize', () => {
    near(length([3, 4, 0]), 5)
    nearVec(normalize([0, 5, 0]), [0, 1, 0])
  })
  it('normalize of zero is safe (no NaN)', () => nearVec(normalize([0, 0, 0]), [0, 0, 0]))
})

describe('rayPlaneHit', () => {
  it('perpendicular hit returns exact distance', () => {
    const t = rayPlaneHit([0, 5, 0], [0, -1, 0], [0, 0, 0], [0, 1, 0])
    near(t, 5)
  })
  it('oblique hit', () => {
    // ray from (0,2,0) going down-and-forward hits y=0 plane
    const t = rayPlaneHit([0, 2, 0], normalize([0, -1, 1]), [0, 0, 0], [0, 1, 0])
    near(t, 2 * Math.SQRT2) // travels sqrt2 per unit of y descent
  })
  it('parallel ray returns null', () => {
    expect(rayPlaneHit([0, 5, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0])).toBeNull()
  })
  it('plane behind the origin returns null (forward-only)', () => {
    expect(rayPlaneHit([0, -5, 0], [0, -1, 0], [0, 0, 0], [0, 1, 0])).toBeNull()
  })
})

describe('raysClosestApproach', () => {
  it('skew perpendicular lines', () => {
    // A = x-axis; B = vertical line through (0,0,1). Gap should be 1.
    const r = raysClosestApproach([0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0])
    near(r.distance, 1)
    near(r.tA, 0)
    near(r.tB, 0)
    nearVec(r.midpoint, [0, 0, 0.5])
    expect(r.parallel).toBe(false)
  })
  it('exactly crossing lines → distance 0 at the crossing', () => {
    const r = raysClosestApproach([-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0])
    near(r.distance, 0)
    near(r.tA, 1)
    near(r.tB, 1)
    nearVec(r.midpoint, [0, 0, 0])
  })
  it('parallel lines report the perpendicular gap without NaN', () => {
    const r = raysClosestApproach([0, 0, 0], [1, 0, 0], [0, 3, 0], [1, 0, 0])
    expect(r.parallel).toBe(true)
    near(r.distance, 3)
    expect(Number.isNaN(r.distance)).toBe(false)
  })
  it('non-unit directions still give correct geometry', () => {
    // same crossing lines but directions scaled ×5
    const r = raysClosestApproach([-1, 0, 0], [5, 0, 0], [0, -1, 0], [0, 5, 0])
    near(r.distance, 0)
    nearVec(r.midpoint, [0, 0, 0])
  })
})

describe('pointInPaneUV', () => {
  const pane = { origin: [0, 0, 0], uAxis: [2, 0, 0], vAxis: [0, 2, 0] }
  it('centre point is inside at s=t=0.5', () => {
    const r = pointInPaneUV([1, 1, 0], pane)
    expect(r.inside).toBe(true)
    near(r.s, 0.5)
    near(r.t, 0.5)
    near(r.perp, 0)
  })
  it('corner is inside at the boundary', () => {
    expect(pointInPaneUV([2, 2, 0], pane).inside).toBe(true)
  })
  it('point past the u edge is outside', () => {
    const r = pointInPaneUV([3, 1, 0], pane)
    expect(r.inside).toBe(false)
    near(r.s, 1.5)
  })
  it('point off the plane is outside even if within the quad footprint', () => {
    const r = pointInPaneUV([1, 1, 0.5], pane)
    expect(r.inside).toBe(false)
    near(r.perp, 0.5)
  })
})

describe('marchSDF', () => {
  const sphere = (c, rad) => (p) => length(sub(p, c)) - rad
  it('hits a sphere dead-on at the near surface', () => {
    const r = marchSDF([0, 0, -5], [0, 0, 1], sphere([0, 0, 0], 1))
    expect(r.hit).toBe(true)
    near(r.t, 4, 1e-2)
    nearVec(r.p, [0, 0, -1], 1e-2)
  })
  it('misses a sphere it is aimed past', () => {
    const r = marchSDF([0, 5, -5], [0, 0, 1], sphere([0, 0, 0], 1))
    expect(r.hit).toBe(false)
  })
  it('respects maxT (miss when the surface is beyond range)', () => {
    const r = marchSDF([0, 0, -50], [0, 0, 1], sphere([0, 0, 0], 1), { maxT: 10 })
    expect(r.hit).toBe(false)
  })
})

describe('gazeCrossOnPane — the composite VIGIL trigger', () => {
  // A pane sitting on the z=0 plane spanning x,y in [-1,1].
  const pane = { origin: [-1, -1, 0], uAxis: [2, 0, 0], vAxis: [0, 2, 0] }
  it('fires when two forward rays cross inside the pane', () => {
    const r = gazeCrossOnPane([-3, 0, 0], [1, 0, 0], [0, -3, 0], [0, 1, 0], pane)
    expect(r.fires).toBe(true)
    nearVec(r.point, [0, 0, 0], 1e-6)
  })
  it('does NOT fire when the crossing is outside the pane', () => {
    // rays cross at (5,5,0) — well outside the [-1,1] quad
    const r = gazeCrossOnPane([2, 5, 0], [1, 0, 0], [5, 2, 0], [0, 1, 0], pane)
    expect(r.fires).toBe(false)
  })
  it('does NOT fire when the rays are too far apart (skew gap)', () => {
    const r = gazeCrossOnPane([-3, 0, 0], [1, 0, 0], [0, -3, 5], [0, 1, 0], pane)
    expect(r.fires).toBe(false)
  })
  it('does NOT fire when the crossing is behind an emitter', () => {
    // second ray points AWAY, so its closest approach is at tB < 0
    const r = gazeCrossOnPane([-3, 0, 0], [1, 0, 0], [0, -3, 0], [0, -1, 0], pane)
    expect(r.fires).toBe(false)
  })
})
