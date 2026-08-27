// CHROME.TOPBAR (DESIGN-ui-grid rung 3, universalized) — ONE bar row at every
// width, declared in THE PLATFORM DOC (ui-grid-doc.ts) and gated there. The
// old three-owner pileup is held as a permanently FAILING gate; the platform
// doc must pass across the full resolution matrix, including the 521–733px
// mid-widths where the centered pill used to collide with the title.
import { describe, it, expect } from 'vitest'
import { uiGridReport, type UiGridState } from '@/app/engine/ui-grid'
import { WORLD_PAGE_GRID, TOPBAR_BAND } from '@/app/engine/ui-grid-doc'
import { legacyTopBandDoc } from '@/app/engine/ui-topbar'

const state = (w: number, h: number): UiGridState =>
  ({ mode: 'view', role: 'visitor', worldState: 'done', window: { w, h } })

describe('chrome.topbar — the top band has ONE owner at every width', () => {
  it('the OLD three-source band fails the overlap gate at phone-column width (the pileup Galen saw)', () => {
    const win = { w: 415, h: 800 }
    const { overlaps } = uiGridReport(legacyTopBandDoc(win), state(win.w, win.h))
    expect(overlaps.length).toBeGreaterThan(0)   // title(left) × dockpill(center) collide
  })

  it('the OLD band ALSO fails at mid-width (the 521–733 residual: pill clears title only past ~734px)', () => {
    const win = { w: 640, h: 800 }
    const { overlaps } = uiGridReport(legacyTopBandDoc(win), state(win.w, win.h))
    expect(overlaps.length).toBeGreaterThan(0)
  })

  it('the OLD band is legal only on a wide desktop (why the bug hid)', () => {
    const win = { w: 1440, h: 900 }
    const { overlaps } = uiGridReport(legacyTopBandDoc(win), state(win.w, win.h))
    expect(overlaps).toEqual([])
  })

  // the ui-seam law's resolution matrix — the FULL width range, one declaration
  for (const [w, h] of [[320, 800], [390, 844], [415, 800], [480, 800], [520, 800], [640, 800], [734, 800], [1024, 768], [1440, 900]] as const) {
    it(`the platform doc gates clean with the bar present at ${w}×${h}`, () => {
      const { solved, overlaps } = uiGridReport(WORLD_PAGE_GRID, state(w, h))
      expect(overlaps).toEqual([])
      const bar = solved.find(r => r.id === 'chrome.topbar')
      expect(bar).toBeDefined()
      expect(bar!.rect).toEqual({ x: 0, y: 0, w, h: Math.round(TOPBAR_BAND * h) })
    })
  }

  it('the narrow twin is gone — one region, no phone fork', () => {
    expect(WORLD_PAGE_GRID.regions.find(r => r.id === 'chrome.topbar.narrow')).toBeUndefined()
    const { solved } = uiGridReport(WORLD_PAGE_GRID, state(390, 844))
    expect(solved.filter(r => r.id.startsWith('chrome.topbar'))).toHaveLength(1)
  })

  it('cross-layer contact stays legal: the game stage underlies the bar everywhere', () => {
    for (const w of [390, 640, 1440]) {
      const { solved, overlaps } = uiGridReport(WORLD_PAGE_GRID, state(w, 800))
      expect(solved.find(r => r.id === 'game.stage')).toBeDefined()
      expect(overlaps).toEqual([])                       // cafe-over-game is composition, not collision
    }
  })
})
