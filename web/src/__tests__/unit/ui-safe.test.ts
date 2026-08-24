// chrome-safe UI (task #19): world panels can never land under the cafe's
// chrome — the solver clamps top-level panels into the square minus the
// measured chrome bands. Zero insets = byte-identical legacy behavior.
import { describe, it, expect } from 'vitest'
import { solveUi, GRID, type UiTree } from '@/app/engine/ui-solver'

const panelAt = (id: string, gx: number, gy: number, align: 'tl' | 'br' | 'tr' = 'tl'): UiTree => ({
  root: [{ id, kind: 'panel' as const, anchor: { gx, gy }, align, w: 120, children: [{ kind: 'text', text: 'SCORE 12' }] }],
})

describe('chrome-safe insets', () => {
  it('no insets = the old behavior exactly', () => {
    const a = solveUi({ ui: panelAt('p', 8, 8) })
    const b = solveUi({ ui: panelAt('p', 8, 8), insets: {} })
    expect(a.rects.p).toEqual(b.rects.p)
    expect(a.rects.p.x).toBe(8)
    expect(a.rects.p.y).toBe(8)
  })

  it('a top-left panel ducks below the name plate band', () => {
    const s = solveUi({ ui: panelAt('p', 8, 8), insets: { top: 70, left: 0 } })
    expect(s.rects.p.y).toBe(70)
    expect(s.rects.p.x).toBe(8)
  })

  it('a bottom-right panel clears the pills band', () => {
    const s = solveUi({ ui: panelAt('p', GRID - 8, GRID - 8, 'br'), insets: { bottom: 40, right: 30 } })
    const r = s.rects.p
    expect(r.y + r.h).toBeLessThanOrEqual(GRID - 40)
    expect(r.x + r.w).toBeLessThanOrEqual(GRID - 30)
  })

  it('a right-rail band pushes a top-right panel inward', () => {
    const s = solveUi({ ui: panelAt('p', GRID - 4, 8, 'tr'), insets: { right: 60 } })
    const r = s.rects.p
    expect(r.x + r.w).toBeLessThanOrEqual(GRID - 60)
  })

  it('an oversized panel pins to the safe top-left, never pushed off-square', () => {
    const ui: UiTree = { root: [{ id: 'big', kind: 'panel', anchor: { gx: 0, gy: 0 }, align: 'tl', w: 600, children: [{ kind: 'text', text: 'x' }] }] }
    const s = solveUi({ ui, insets: { top: 50, left: 20 } })
    expect(s.rects.big.x).toBe(20)
    expect(s.rects.big.y).toBe(50)
  })

  it('the glass box and hit rects move with the clamp (one rect table)', () => {
    const ui: UiTree = { root: [{ id: 'p', kind: 'panel', anchor: { gx: 8, gy: 8 }, align: 'tl', w: 120, children: [{ kind: 'button', id: 'b', text: 'GO', click: 'go' }] }] }
    const s = solveUi({ ui, insets: { top: 70 } })
    expect(s.boxes[0].y).toBe(70)
    expect(s.hits[0].y).toBeGreaterThanOrEqual(70)
  })
})
