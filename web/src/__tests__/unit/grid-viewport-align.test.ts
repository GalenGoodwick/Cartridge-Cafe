import { describe, expect, it } from 'vitest'
import { restingFrame, screenToGrid } from '@/app/engine/engine-utils'

/** GRID ≡ VIEWPORT (Galen, Aug 31: "align grid and grid viewport").
 *  The acceptance proof for the resting frame: when the page frame conforms to
 *  a declared-rect world's aspect, the resting camera maps viewport corners to
 *  RECT corners EXACTLY — no letterbox, no crop, no jitter-prone fixups.
 *  Square worlds keep the proven contain frame byte-identical. */

const FIT_ZOOM = 0.93   // FieldEngine's chrome-breathing back-out (square worlds only)
const rect = (w: number, h: number): DOMRect =>
  ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

describe('restingFrame — square worlds unchanged (the proven base games)', () => {
  it('rests on the square center at the FIT_ZOOM contain frame', () => {
    const f = restingFrame(512, {}, 16 / 10, FIT_ZOOM)
    expect(f.center).toEqual({ x: 256, y: 256 })
    expect(f.zoom).toBeCloseTo(FIT_ZOOM, 10)
  })
  it('scales the contain zoom for a big square world (gridSize 1024)', () => {
    const f = restingFrame(1024, undefined, 1, FIT_ZOOM)
    expect(f.center).toEqual({ x: 512, y: 512 })
    expect(f.zoom).toBeCloseTo(FIT_ZOOM * 2, 10)
  })
})

describe('restingFrame — declared-rect worlds rest at exact cover of the rect', () => {
  it('mobile birth rect (576×1024) at a conforming 9:16 frame: exact cover = exact contain', () => {
    const f = restingFrame(1024, { gridW: 576, gridH: 1024 }, 9 / 16, FIT_ZOOM)
    expect(f.center).toEqual({ x: 288, y: 512 })     // the RECT's center, not the square's
    expect(f.zoom).toBeCloseTo(1024 / 576, 10)       // visible short-axis range = exactly gridW
  })

  it('THE CORNER PROOF: viewport corners ARE rect corners through screenToGrid', () => {
    const f = restingFrame(1024, { gridW: 576, gridH: 1024 }, 9 / 16, FIT_ZOOM)
    const cnv = rect(360, 640)                        // any 9:16 canvas — alignment is aspect-level
    const tl = screenToGrid(0, 0, cnv, f.center, f.zoom, 1024)
    const br = screenToGrid(360, 640, cnv, f.center, f.zoom, 1024)
    const mid = screenToGrid(180, 320, cnv, f.center, f.zoom, 1024)
    expect(tl.x).toBeCloseTo(0, 8); expect(tl.y).toBeCloseTo(0, 8)
    expect(br.x).toBeCloseTo(576, 8); expect(br.y).toBeCloseTo(1024, 8)
    expect(mid.x).toBeCloseTo(288, 8); expect(mid.y).toBeCloseTo(512, 8)
  })

  it('corner proof holds at other canvas sizes of the same aspect (device independence)', () => {
    const f = restingFrame(1024, { gridW: 576, gridH: 1024 }, 9 / 16, FIT_ZOOM)
    for (const [w, h] of [[288, 512], [1080, 1920], [450, 800]]) {
      const br = screenToGrid(w, h, rect(w, h), f.center, f.zoom, 1024)
      expect(br.x).toBeCloseTo(576, 6)
      expect(br.y).toBeCloseTo(1024, 6)
    }
  })

  it('a non-conforming (taller) frame COVERS: height fills exactly, width crops centered inside the rect — never void bands', () => {
    const aspect = 9 / 19.5                           // a real phone, if the frame ever fails to conform
    const f = restingFrame(1024, { gridW: 576, gridH: 1024 }, aspect, FIT_ZOOM)
    const cnv = rect(360, 780)
    const tl = screenToGrid(0, 0, cnv, f.center, f.zoom, 1024)
    const br = screenToGrid(360, 780, cnv, f.center, f.zoom, 1024)
    expect(tl.y).toBeCloseTo(0, 6); expect(br.y).toBeCloseTo(1024, 6)  // height exact — the binding axis
    expect(tl.x).toBeGreaterThanOrEqual(0); expect(br.x).toBeLessThanOrEqual(576)  // crop stays inside the rect
    expect(tl.x + br.x).toBeCloseTo(576, 6)                            // crop is centered
  })

  it('landscape rect world covers by height (the same math, transposed)', () => {
    const f = restingFrame(1024, { gridW: 1024, gridH: 576 }, 16 / 9, FIT_ZOOM)
    expect(f.center).toEqual({ x: 512, y: 288 })
    const cnv = rect(640, 360)
    const br = screenToGrid(640, 360, cnv, f.center, f.zoom, 1024)
    expect(br.x).toBeCloseTo(1024, 6)
    expect(br.y).toBeCloseTo(576, 6)
  })

  it('degrades safely when the canvas is not measurable yet (aspect 0 → square fallback zoom)', () => {
    const f = restingFrame(1024, { gridW: 576, gridH: 1024 }, 0, FIT_ZOOM)
    expect(Number.isFinite(f.zoom)).toBe(true)
    expect(f.zoom).toBeGreaterThan(0)
  })
})
