// THE UI GRID primitive — solver + overlap gate (DESIGN-ui-grid.md rung 1).
import { describe, it, expect } from 'vitest'
import { solveUiGrid, uiGridOverlaps, uiGridReport, type UiGridDoc, type UiGridState } from '@/app/engine/ui-grid'

const desktop: UiGridState = { mode: 'view', role: 'visitor', worldState: 'done', window: { w: 1440, h: 900 } }
const phone: UiGridState = { mode: 'view', role: 'visitor', worldState: 'done', window: { w: 414, h: 897 } }

const doc: UiGridDoc = {
  regions: [
    { id: 'game.stage', layer: 'game', anchor: { vx: [0, 1], vy: [0.06, 1] } },
    { id: 'chrome.topbar', layer: 'cafe', anchor: { vx: [0, 1], vy: [0, 0.06] }, z: 40 },
    // desktop-only right rail vs phone-only bottom sheet — THE SAME declaration
    // set is the mobile UI, instantiated by viewport (Galen)
    { id: 'chrome.rail', layer: 'cafe', anchor: { vx: [0.9, 1], vy: [0.06, 1] }, z: 41, when: { viewport: { minW: 521 } } },
    { id: 'chrome.sheet', layer: 'cafe', anchor: { vx: [0, 1], vy: [0.92, 1] }, z: 41, when: { viewport: { maxW: 520 } } },
    // slip-in console — zero viewport at rest
    { id: 'console.builderbox', layer: 'cafe', anchor: { vx: [0, 1], vy: [0.45, 1] }, z: 80, slip: { edge: 'bottom', trigger: 'console' } },
    // owner-only design tool
    { id: 'chrome.tools', layer: 'cafe', anchor: { vx: [0.8, 1], vy: [0, 0.06] }, z: 42, when: { mode: ['design'], role: ['owner'] }, parent: 'chrome.topbar' },
  ],
}

describe('ui-grid solver', () => {
  it('resolves bands to window px', () => {
    const s = solveUiGrid(doc, desktop)
    const top = s.find(r => r.id === 'chrome.topbar')!
    expect(top.rect).toEqual({ x: 0, y: 0, w: 1440, h: 54 })
  })

  it('mobile is a calculated instance: regions flip by viewport', () => {
    const d = solveUiGrid(doc, desktop).map(r => r.id)
    const p = solveUiGrid(doc, phone).map(r => r.id)
    expect(d).toContain('chrome.rail'); expect(d).not.toContain('chrome.sheet')
    expect(p).toContain('chrome.sheet'); expect(p).not.toContain('chrome.rail')
  })

  it('slip-ins cost zero viewport at rest, appear on trigger', () => {
    expect(solveUiGrid(doc, phone).find(r => r.id === 'console.builderbox')).toBeUndefined()
    const withConsole = solveUiGrid(doc, { ...phone, triggers: { console: true } })
    expect(withConsole.find(r => r.id === 'console.builderbox')).toBeDefined()
  })

  it('3-axis culling: design tools exist only for the owner in design mode', () => {
    expect(solveUiGrid(doc, desktop).find(r => r.id === 'chrome.tools')).toBeUndefined()
    const s = solveUiGrid(doc, { ...desktop, mode: 'design', role: 'owner' })
    expect(s.find(r => r.id === 'chrome.tools')).toBeDefined()
  })
})

describe('ui-grid overlap gate', () => {
  it('clean layout passes: overlaps === []', () => {
    const { overlaps } = uiGridReport(doc, desktop)
    expect(overlaps).toEqual([])
  })

  it('the four-way-pileup class is CAUGHT: same-layer collision fails the gate', () => {
    const bad: UiGridDoc = { regions: [
      ...doc.regions,
      { id: 'chrome.dockin', layer: 'cafe', anchor: { vx: [0.4, 0.6], vy: [0, 0.05] }, z: 45 },  // lands on the topbar
    ] }
    const { overlaps } = uiGridReport(bad, phone)
    expect(overlaps.length).toBeGreaterThan(0)
    expect(overlaps[0].a === 'chrome.topbar' || overlaps[0].b === 'chrome.dockin' || overlaps[0].a === 'chrome.dockin').toBe(true)
  })

  it('parented nesting is legal; cross-layer contact is legal; slips over base are legal', () => {
    const s = solveUiGrid(doc, { ...desktop, mode: 'design', role: 'owner', triggers: { console: true } })
    expect(uiGridOverlaps(doc, s)).toEqual([])   // tools∥topbar parented · console slips over · cafe over game
  })
})
