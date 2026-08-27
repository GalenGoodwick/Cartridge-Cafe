import { describe, it, expect } from 'vitest'
import { fitWhenMatches, coverRect, containRect, fitUniforms, isotropicSpan } from '@/app/engine/fit'

// The fit facet's invariants — the FitShader lessons pinned as math. These are
// the properties that make "a shader knows its own shape and recomposes" true
// for ANY backend, at ANY aspect.
describe('fit — the shape-aware recomposition math', () => {
  it('isotropic: both axes share ONE scale at any aspect (circles stay circles)', () => {
    for (const [w, h] of [[1344, 677], [398, 729], [900, 900], [2560, 1080]]) {
      const u = fitUniforms('isotropic', w, h)
      expect(u.scaleX).toBe(u.scaleY)                       // the whole trick
      expect(u.scaleX).toBeCloseTo(1 / Math.min(w, h), 12)  // short side = 1 unit
    }
  })

  it('isotropic: the long axis sees MORE world, never a stretched world', () => {
    const wide = isotropicSpan(1344, 677)
    expect(wide.spanX).toBeGreaterThan(1); expect(wide.spanY).toBe(1)
    const tall = isotropicSpan(398, 729)
    expect(tall.spanY).toBeGreaterThan(1); expect(tall.spanX).toBe(1)
  })

  it('cover FILLS the box: content >= box on both axes, exact on one, centered', () => {
    const r = coverRect(16, 9, 390, 844)   // wide content into a tall phone box
    expect(r.w).toBeGreaterThanOrEqual(390 - 1e-9)
    expect(r.h).toBeCloseTo(844, 9)                       // the constraining axis
    expect(r.x + r.w / 2).toBeCloseTo(390 / 2, 9)         // centered
  })

  it('contain FITS inside: content <= box on both axes, exact on one, centered', () => {
    const r = containRect(16, 9, 390, 844)
    expect(r.w).toBeCloseTo(390, 9)                       // the constraining axis
    expect(r.h).toBeLessThanOrEqual(844)
    expect(r.y + r.h / 2).toBeCloseTo(844 / 2, 9)
  })

  it('cover never shows less than contain (cover scale >= contain scale)', () => {
    for (const [w, h, a] of [[390, 844, 16 / 9], [1344, 677, 1], [800, 600, 0.5]]) {
      const cov = fitUniforms('cover', w, h, a)
      const con = fitUniforms('contain', w, h, a)
      // smaller content-units-per-pixel = content drawn BIGGER on screen
      expect(cov.scaleY).toBeLessThanOrEqual(con.scaleY + 1e-12)
    }
  })

  it('stretch is the only policy allowed to distort', () => {
    const u = fitUniforms('stretch', 1000, 500)
    expect(u.scaleX).not.toBe(u.scaleY)
    for (const p of ['isotropic'] as const) {
      const v = fitUniforms(p, 1000, 500)
      expect(v.scaleX).toBe(v.scaleY)
    }
  })

  it('fitWhenMatches culls the calculated instance by viewport', () => {
    expect(fitWhenMatches({ maxW: 699 }, { w: 390, h: 844 })).toBe(true)   // phone
    expect(fitWhenMatches({ maxW: 699 }, { w: 1344, h: 677 })).toBe(false) // desktop
    expect(fitWhenMatches({ minW: 700 }, { w: 1344, h: 677 })).toBe(true)
    expect(fitWhenMatches(undefined, { w: 1, h: 1 })).toBe(true)           // no clause = always
  })
})
