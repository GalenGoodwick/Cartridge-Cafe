import { describe, expect, it } from 'vitest'
import { restingFrame } from '@/app/engine/engine-utils'

/** THE OVER-ZOOM FIX (Galen, Sep 4: tideglass/veilfire-3d "over zoom in").
 *  The rect-home sweep stamped gridW=gridH=512 onto legacy square worlds,
 *  which flipped them from CONTAIN to COVER — on a 16:9 monitor the resting
 *  zoom hit ~1.78 (a 44% vertical crop that reads as zoomed-in). The law:
 *  a declared SQUARE is a classic square and rests CONTAINED; COVER stays
 *  for genuinely rectangular worlds where cropping the long axis is design. */
describe('resting frame — declared squares contain, true rects cover', () => {
  const WIDE = 16 / 9

  it('a declared 512×512 square rests at contain zoom on a wide monitor (the tideglass bug)', () => {
    const f = restingFrame(512, { gridW: 512, gridH: 512 }, WIDE, 1)
    expect(f.zoom).toBe(1)                     // contain — NOT the ~1.78 cover zoom
    expect(f.center).toEqual({ x: 256, y: 256 })
  })

  it('matches the undeclared classic square exactly (declaration must not change framing)', () => {
    const classic = restingFrame(512, undefined, WIDE, 1)
    const declared = restingFrame(512, { gridW: 512, gridH: 512 }, WIDE, 1)
    expect(declared.zoom).toBe(classic.zoom)
  })

  it('a true portrait rect (mobile 576×1024) still COVERS', () => {
    const f = restingFrame(1024, { gridW: 576, gridH: 1024 }, WIDE, 1)
    // cover math unchanged: maxRange = min(576/1.78, 1024·1) ≈ 324 → zoom ≈ 3.16
    expect(f.zoom).toBeGreaterThan(3)
    expect(f.center).toEqual({ x: 288, y: 512 })
  })

  it('a declared square still contains on portrait windows too', () => {
    const f = restingFrame(512, { gridW: 512, gridH: 512 }, 9 / 16, 1)
    expect(f.zoom).toBe(1)
  })
})
