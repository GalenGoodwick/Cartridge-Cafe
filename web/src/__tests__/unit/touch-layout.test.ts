import { describe, it, expect } from 'vitest'
import { layoutTouchZones, zonesOverlap } from '@/app/engine/touch-layout'

/** THE DEVICE MATRIX — layout is PROVEN collision-free at every real shape,
 *  not imagined at one. (Galen's law, Aug 23: math visioning, not magic px.) */
const MATRIX: Array<[number, number, string]> = [
  [320, 568, 'iPhone SE portrait'],
  [375, 667, 'iPhone 8 portrait'],
  [390, 844, 'iPhone 14 portrait'],
  [430, 932, 'iPhone Pro Max portrait'],
  [568, 320, 'SE landscape'],
  [844, 390, 'iPhone landscape'],
  [768, 1024, 'iPad portrait'],
  [1024, 768, 'iPad landscape'],
  [1280, 800, 'small laptop'],
  [2400, 700, 'ultrawide strip'],
]

describe('touch-zone layout — collision-free by construction, on every device', () => {
  for (const [w, h, name] of MATRIX) {
    it(`${name} (${w}×${h}): no overlaps, everything on screen`, () => {
      const L = layoutTouchZones(w, h)
      const zones = [L.stick, ...L.buttons]
      // pairwise non-overlap
      for (let i = 0; i < zones.length; i++)
        for (let j = i + 1; j < zones.length; j++)
          expect(zonesOverlap(zones[i], zones[j]), `zones ${i}/${j} overlap`).toBe(false)
      // all inside the viewport
      for (const z of zones) {
        expect(z.x).toBeGreaterThanOrEqual(0)
        expect(z.y).toBeGreaterThanOrEqual(0)
        expect(z.x + z.w).toBeLessThanOrEqual(w)
        expect(z.y + z.h).toBeLessThanOrEqual(h)
      }
      // thumb targets never shrink below usable (44px Apple HIG floor)
      expect(L.buttons[0].w).toBeGreaterThanOrEqual(44)
      expect(L.stick.w).toBeGreaterThanOrEqual(72)
    })
  }

  it('shrink-before-stack: real phones keep the row; only absurdly narrow stacks', () => {
    expect(layoutTouchZones(320, 568).stacked).toBe(false)   // SE: scaled row still fits
    expect(layoutTouchZones(844, 390).stacked).toBe(false)
    const tiny = layoutTouchZones(230, 500)                   // fold-cover class
    expect(tiny.stacked).toBe(true)                           // column engages…
    expect(zonesOverlap(tiny.stick, tiny.buttons[0], 8)).toBe(false)   // …and stays clear
    expect(zonesOverlap(tiny.stick, tiny.buttons[1], 8)).toBe(false)
  })

  it('the stick↔buttons clearance holds even at the tightest width', () => {
    const L = layoutTouchZones(320, 568)
    for (const b of L.buttons) expect(zonesOverlap(L.stick, b, 8)).toBe(false)
  })
})
