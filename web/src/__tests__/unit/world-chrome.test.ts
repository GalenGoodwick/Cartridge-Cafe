// THE SHADER-CHROME LANE — chromePlanToDraw proven against the REAL worldSolve:
// a WorldDoc's chrome regions become glass boxes + glyph runs + hit rects in
// the plan's own viewport px (one coordinate authority), ready for the engine's
// glass + sprite-font passes.
import { describe, it, expect } from 'vitest'
import { worldSolve } from '@/app/engine/world-solve'
import type { WorldDoc } from '@/app/engine/world-config'
import { chromePlanToDraw, type ChromeContent } from '@/app/engine/world-chrome'
import { SHELL_NS } from '@/app/engine/ui-blocks'

// an app-shell world: topbar band, game stage, bottom nav — the one-engine shape
const doc: WorldDoc = {
  id: 'demo', name: 'ONE ENGINE',
  render: { kind: 'shaderUI' },
  layout: { regions: [
    { id: 'topbar', layer: 'cafe', anchor: { vx: [0, 1], vy: [0, 0.09] }, z: 40 },
    { id: 'stage',  layer: 'game', anchor: { vx: [0, 1], vy: [0.09, 0.9] }, z: 0 },
    { id: 'nav',    layer: 'cafe', anchor: { vx: [0, 1], vy: [0.9, 1] }, z: 40 },
  ] },
}
const content: Record<string, ChromeContent> = {
  topbar: { kind: 'topbar', title: 'One Engine', sub: 'main · live', back: true, right: { label: 'SHELF', action: 'toggle' } },
  nav: { kind: 'nav', items: [{ label: 'home', action: 'home', active: true }, { label: 'shelf', action: 'shelf' }] },
}

const within = (r: { x: number; y: number; w: number; h: number }, box: { x: number; y: number; w: number; h: number }, tol = 0.5) =>
  box.x >= r.x - tol && box.y >= r.y - tol && box.x + box.w <= r.x + r.w + tol && box.y + box.h <= r.y + r.h + tol

describe('chromePlanToDraw — the shader-chrome executor', () => {
  it('draws chrome ONLY for cafe regions with declared content (game stage ignored)', () => {
    const plan = worldSolve(doc, { w: 1200, h: 800 })
    const d = chromePlanToDraw(plan, content)
    const ids = d.boxes.map(b => b.id)
    expect(ids.some(i => i.startsWith('topbar'))).toBe(true)
    expect(ids.some(i => i.startsWith('nav'))).toBe(true)
    expect(ids.some(i => i.startsWith('stage'))).toBe(false)   // the render facet draws the game
  })

  it('every primitive sits INSIDE its region\'s solved rect (one coordinate authority)', () => {
    const plan = worldSolve(doc, { w: 1200, h: 800 })
    const rectOf = (id: string) => plan.routes.find(r => r.id === id)!.rect
    const d = chromePlanToDraw(plan, content)
    for (const b of d.boxes) {
      const region = b.id.split('.')[0]
      expect(within(rectOf(region), b), `box ${b.id} escaped ${region}`).toBe(true)
    }
    for (const h of d.hits) {
      const region = h.id.split('.')[0]
      expect(within(rectOf(region), h), `hit ${h.id} escaped ${region}`).toBe(true)
    }
  })

  it('actions are shell:-namespaced and every actionable pill has a hit rect', () => {
    const plan = worldSolve(doc, { w: 1200, h: 800 })
    const d = chromePlanToDraw(plan, content)
    for (const h of d.hits) expect(h.action.startsWith(SHELL_NS)).toBe(true)
    expect(d.hits.map(h => h.action)).toEqual(
      expect.arrayContaining([`${SHELL_NS}back`, `${SHELL_NS}toggle`, `${SHELL_NS}home`, `${SHELL_NS}shelf`]),
    )
  })

  it('the active nav item is styled distinctly (declared, not eyeballed)', () => {
    const plan = worldSolve(doc, { w: 1200, h: 800 })
    const d = chromePlanToDraw(plan, content)
    const homeBox = d.boxes.find(b => b.id === 'nav.0')!
    const shelfBox = d.boxes.find(b => b.id === 'nav.1')!
    expect(homeBox.style.border).not.toBe(shelfBox.style.border)   // active border differs
  })

  it('all glyphs are ASCII 32-127 (the sprite-font atlas range) — lowercase folds, · never leaks', () => {
    const plan = worldSolve(doc, { w: 1200, h: 800 })
    const d = chromePlanToDraw(plan, content)
    for (const run of d.runs) for (const ch of run.text) {
      const c = ch.charCodeAt(0)
      expect(c >= 32 && c <= 127, `glyph '${ch}' in "${run.text}" outside atlas`).toBe(true)
    }
  })

  it('it is a CALCULATED INSTANCE — a phone viewport re-solves chrome to the same declaration', () => {
    const wide = chromePlanToDraw(worldSolve(doc, { w: 1200, h: 800 }), content)
    const phone = chromePlanToDraw(worldSolve(doc, { w: 390, h: 844 }), content)
    // same regions, same actions — only the rects differ (the plan's job)
    expect(new Set(phone.hits.map(h => h.action))).toEqual(new Set(wide.hits.map(h => h.action)))
    // nav pills fill their band — narrower viewport → narrower pills (the chip
    // hugs its content by design, so it's the width-scaling nav we assert on)
    const navWide = wide.boxes.find(b => b.id === 'nav.0')!
    const navPhone = phone.boxes.find(b => b.id === 'nav.0')!
    expect(navPhone.w).toBeLessThan(navWide.w)
  })

  it('a region culled at this viewport (fit.when) contributes no chrome', () => {
    const culledDoc: WorldDoc = { ...doc, fit: { nav: { aspect: 'contain', when: { minW: 900 } } } }
    const phone = chromePlanToDraw(worldSolve(culledDoc, { w: 390, h: 844 }), content)
    expect(phone.boxes.some(b => b.id.startsWith('nav'))).toBe(false)   // nav culled on the phone
    const desk = chromePlanToDraw(worldSolve(culledDoc, { w: 1200, h: 800 }), content)
    expect(desk.boxes.some(b => b.id.startsWith('nav'))).toBe(true)
  })
})
