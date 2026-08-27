// CHROME.TOPBAR (DESIGN-ui-grid rung 3) — the narrow top band consolidated,
// declared in THE PLATFORM DOC (ui-grid-doc.ts) and gated there. The old
// three-owner pileup is held as a permanently FAILING gate; the platform doc
// must pass across the resolution matrix.
import { describe, it, expect } from 'vitest'
import { uiGridReport, type UiGridState } from '@/app/engine/ui-grid'
import { WORLD_PAGE_GRID, NARROW_TOPBAR_MAX_W } from '@/app/engine/ui-grid-doc'
import { legacyTopBandDoc, topbarActive } from '@/app/engine/ui-topbar'

const state = (w: number, h: number): UiGridState =>
  ({ mode: 'view', role: 'visitor', worldState: 'done', window: { w, h } })

describe('chrome.topbar.narrow — the narrow band has ONE owner', () => {
  it('the OLD three-source band fails the overlap gate at phone-column width (the pileup Galen saw)', () => {
    const win = { w: 415, h: 800 }
    const { overlaps } = uiGridReport(legacyTopBandDoc(win), state(win.w, win.h))
    expect(overlaps.length).toBeGreaterThan(0)   // title(left) × dockpill(center) collide
  })

  it('the OLD band is legal on a wide desktop (the bug was narrow-only)', () => {
    const win = { w: 1440, h: 900 }
    const { overlaps } = uiGridReport(legacyTopBandDoc(win), state(win.w, win.h))
    expect(overlaps).toEqual([])
  })

  // the ui-seam law's resolution matrix: every narrow width must gate clean
  for (const w of [320, 390, 415, 480, NARROW_TOPBAR_MAX_W]) {
    it(`the platform doc passes the gate with the bar present at ${w}px`, () => {
      const { solved, overlaps } = uiGridReport(WORLD_PAGE_GRID, state(w, 800))
      expect(overlaps).toEqual([])                       // parented to chrome.topbar — same home
      const bar = solved.find(r => r.id === 'chrome.topbar.narrow')
      expect(bar).toBeDefined()
      expect(bar!.rect).toEqual({ x: 0, y: 0, w, h: 64 })   // the deepened band: 0.08 × 800
    })
  }

  it('wide windows cull the bar; the platform doc still gates clean', () => {
    const { solved, overlaps } = uiGridReport(WORLD_PAGE_GRID, state(1440, 900))
    expect(overlaps).toEqual([])
    expect(solved.find(r => r.id === 'chrome.topbar.narrow')).toBeUndefined()
    expect(solved.find(r => r.id === 'chrome.topbar')).toBeDefined()
  })

  it('the bar predicate and the doc flip at the SAME cut (no drift possible)', () => {
    expect(topbarActive(NARROW_TOPBAR_MAX_W)).toBe(true)
    expect(topbarActive(NARROW_TOPBAR_MAX_W + 1)).toBe(false)
    expect(topbarActive(0)).toBe(false)                  // unmeasured — never flash the bar
    const at = uiGridReport(WORLD_PAGE_GRID, state(NARROW_TOPBAR_MAX_W, 800))
    const above = uiGridReport(WORLD_PAGE_GRID, state(NARROW_TOPBAR_MAX_W + 1, 800))
    expect(at.solved.map(r => r.id)).toContain('chrome.topbar.narrow')
    expect(above.solved.map(r => r.id)).not.toContain('chrome.topbar.narrow')
  })

  it('cross-layer contact stays legal: the game stage underlies both instances', () => {
    for (const w of [390, 1440]) {
      const { solved, overlaps } = uiGridReport(WORLD_PAGE_GRID, state(w, 800))
      expect(solved.find(r => r.id === 'game.stage')).toBeDefined()
      expect(overlaps).toEqual([])                       // cafe-over-game is composition, not collision
    }
  })
})
