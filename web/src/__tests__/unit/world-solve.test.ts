import { describe, it, expect } from 'vitest'
import { worldSolve, planRects } from '@/app/engine/world-solve'
import type { WorldDoc } from '@/app/engine/world-config'

// THE COMPOSITE PROOF DOC (DESIGN-unified-world.md rung 3): a raymarch game
// stage + shader-UI chrome (blocks) + a DOM escape-hatch input region + a
// desktop-only rail — ONE WorldDoc, solved to different plans per viewport.
const DOC: WorldDoc = {
  id: 'composite', name: 'Composite Proof',
  render: { kind: 'raymarch3d' },
  layout: {
    regions: [
      { id: 'game.stage', layer: 'game', anchor: { vx: [0, 1], vy: [0.08, 0.92] }, z: 0 },
      { id: 'chrome.topbar', layer: 'cafe', anchor: { vx: [0, 1], vy: [0, 0.08] }, z: 60 },
      { id: 'chrome.rail', layer: 'cafe', anchor: { vx: [0.86, 1], vy: [0.09, 0.9] }, z: 41 },
      { id: 'chrome.input', layer: 'cafe', anchor: { vx: [0, 1], vy: [0.92, 1] }, z: 50 },
    ],
  },
  ui: {
    'chrome.topbar': { as: 'blocks', blocks: [] },
    'chrome.input': { as: 'dom', tenant: 'builderbox-entry' },   // escape hatch, deferred policy
  },
  fit: {
    'game.stage': { aspect: 'isotropic' },
    'chrome.rail': { aspect: 'contain', when: { minW: 700 } },   // desktop-only rail
  },
}

const DESKTOP = { w: 1344, h: 677 }
const PHONE = { w: 390, h: 844 }

describe('worldSolve — one doc, an executable plan per viewport', () => {
  it('routes each region to its declared backend', () => {
    const plan = worldSolve(DOC, DESKTOP)
    expect(plan.ok).toBe(true)
    const rects = planRects(plan)
    expect(rects['game.stage'].backend).toBe('raymarch3d')   // game region → render.kind
    expect(rects['chrome.topbar'].backend).toBe('blocks')    // declared ui form
    expect(rects['chrome.input'].backend).toBe('dom')        // escape hatch carried, not decided
    expect(rects['chrome.rail'].backend).toBe('empty')       // reserved band at rest
  })

  it('culls the desktop-only rail on the phone instance (fit.when)', () => {
    const desktop = worldSolve(DOC, DESKTOP)
    const phone = worldSolve(DOC, PHONE)
    expect(planRects(desktop)['chrome.rail']).toBeDefined()
    expect(planRects(phone)['chrome.rail']).toBeUndefined()
    expect(phone.culled).toContain('chrome.rail')
  })

  it('game stage carries isotropic scales: one scale, both axes, both instances', () => {
    for (const vp of [DESKTOP, PHONE]) {
      const stage = worldSolve(DOC, vp).routes.find(r => r.id === 'game.stage')!
      expect(stage.scales.scaleX).toBe(stage.scales.scaleY)  // circles stay circles
      expect(stage.scales.scaleX).toBeCloseTo(1 / Math.min(stage.rect.w, stage.rect.h), 12)
    }
  })

  it('draw order is z-ascending (stage under chrome)', () => {
    const ids = worldSolve(DOC, DESKTOP).routes.map(r => r.id)
    expect(ids.indexOf('game.stage')).toBeLessThan(ids.indexOf('chrome.topbar'))
    expect(ids.indexOf('game.stage')).toBeLessThan(ids.indexOf('chrome.input'))
  })

  it('an inconsistent doc still solves but reports errors (never a silent ghost)', () => {
    const bad: WorldDoc = { ...DOC, ui: { ...DOC.ui, 'chrome.ghost': { as: 'blocks', blocks: [] } } }
    const plan = worldSolve(bad, DESKTOP)
    expect(plan.ok).toBe(false)
    expect(plan.errors.some(e => /chrome.ghost/.test(e))).toBe(true)
    expect(plan.routes.length).toBeGreaterThan(0)            // the world still stands
  })

  it('planRects is the readable truth: every route, rect + backend', () => {
    const plan = worldSolve(DOC, DESKTOP)
    const rects = planRects(plan)
    expect(Object.keys(rects).sort()).toEqual(plan.routes.map(r => r.id).sort())
    for (const r of plan.routes) expect(rects[r.id].rect).toEqual(r.rect)
  })
})
