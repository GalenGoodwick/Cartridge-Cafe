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

// ─── MOVERS & PERCHERS: cell-out + sense + fits (Galen's ontology) ───
import { cellOutFreeSpace, classifySense, fitPerchers } from '@/app/engine/ui-grid'

describe('cell out the black space', () => {
  const win = { w: 1200, h: 900 }
  // reality tonight: the phone column mid-screen + a floating button
  const occupied = [
    { x: 393, y: 0, w: 414, h: 900 },      // the world column (game mover)
    { x: 676, y: 838, w: 109, h: 40 },     // SHARE percher (inside column — no cut in margins)
  ]
  const cells = cellOutFreeSpace(win, occupied)

  it('dead margins become addressable cells (left + right bands)', () => {
    const left = cells.find(c => c.x === 0 && c.w === 393)
    const right = cells.find(c => c.x === 807)
    expect(left).toBeDefined(); expect(right).toBeDefined()
    expect(left!.h).toBe(900)               // full-height rail territory
  })

  it('cells never overlap occupied space', () => {
    for (const c of cells) for (const o of occupied) {
      const ox = Math.min(c.x + c.w, o.x + o.w) - Math.max(c.x, o.x)
      const oy = Math.min(c.y + c.h, o.y + o.h) - Math.max(c.y, o.y)
      expect(ox <= 0 || oy <= 0).toBe(true)
    }
  })

  it('senses read the geometry: tall side bands are rails', () => {
    expect(classifySense({ x: 0, y: 0, w: 393, h: 900 }, win)).toBe('left-rail')
    expect(classifySense({ x: 807, y: 0, w: 393, h: 900 }, win)).toBe('right-rail')
    expect(classifySense({ x: 0, y: 0, w: 1200, h: 60 }, win)).toBe('topbar')
    expect(classifySense({ x: 0, y: 850, w: 1200, h: 50 }, win)).toBe('bottombar')
    expect(classifySense({ x: 1100, y: 830, w: 90, h: 60 }, win)).toBe('corner-badge')
  })

  it('perchers get matched to cells they fit', () => {
    const perchers = [
      { label: 'SHARE', w: 109, h: 40 },
      { label: 'BUILDERBOX', w: 282, h: 40 },
      { label: 'GIANT', w: 2000, h: 40 },
    ]
    const fits = fitPerchers(cells, perchers)
    const leftRail = fits.find(f => f.cell.x === 0 && f.cell.w === 393)!
    expect(leftRail.fits).toContain('SHARE')
    expect(leftRail.fits).toContain('BUILDERBOX')
    expect(leftRail.fits).not.toContain('GIANT')
  })
})

// ─── regressions from the chair's adversarial review (commons, Aug 26) ───
describe('chair findings', () => {
  it('(1) a parent CYCLE cannot hang the overlap walk', () => {
    const cyclic: UiGridDoc = { regions: [
      { id: 'a', layer: 'cafe', anchor: { vx: [0, 0.5], vy: [0, 0.5] }, parent: 'b' },
      { id: 'b', layer: 'cafe', anchor: { vx: [0.25, 0.75], vy: [0.25, 0.75] }, parent: 'a' },
    ] }
    const s = solveUiGrid(cyclic, desktop)
    expect(() => uiGridOverlaps(cyclic, s)).not.toThrow()   // returns (parented → legal), never loops
  })

  it('(2) an occupied rect past the window edge cannot inflate free territory', () => {
    const cells = cellOutFreeSpace({ w: 400, h: 400 }, [{ x: 500, y: 0, w: 100, h: 400 }])
    for (const c of cells) expect(c.x + c.w).toBeLessThanOrEqual(400)
  })

  it('(3) a full-width open half is stage-extension, never a rail', () => {
    expect(classifySense({ x: 0, y: 120, w: 1000, h: 680 }, { w: 1000, h: 800 })).toBe('stage-extension')
  })
})
