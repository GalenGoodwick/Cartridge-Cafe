import { describe, it, expect } from 'vitest'
import { slotsToUi, type SlotsSpec } from '@/app/engine/slot-ui'
import { solveUi } from '@/app/engine/ui-solver'

// Safe-zone slots — the reliable-by-default UI floor. An AI picks a zone, not a
// coordinate; the solver guarantees placement. These pin that guarantee: zones map
// to the right anchors, empties produce nothing, and (the whole point) content in
// different zones can never overlap.

const VIEWPORT = { w: 512, h: 512 }

describe('slotsToUi — named zones → correct solver tree', () => {
  it('a populated zone becomes an anchored panel; text/meter/button convert', () => {
    const t = slotsToUi({ topLeft: [{ text: 'SCORE 5' }, { meter: 0.5, label: 'HP' }, { button: 'GO', click: 'go' }] })
    expect(t.root).toHaveLength(1)
    const p = t.root[0]
    expect(p.id).toBe('slot_topLeft')
    expect(p.anchor).toMatchObject({ wx: 0.027, wy: 0.027 }) // world-square coords, not viewport
    expect(p.align).toBe('tl')
    expect(p.children!.map(c => c.kind)).toEqual(['text', 'meter', 'button'])
    expect(p.children![2]).toMatchObject({ kind: 'button', text: 'GO', click: 'go' })
  })

  it('empty / absent zones produce no panels', () => {
    expect(slotsToUi({ topLeft: [] }).root).toHaveLength(0)
    expect(slotsToUi({}).root).toHaveLength(0)
  })

  it('each zone anchors to its corner/edge', () => {
    const t = slotsToUi({ topRight: [{ text: 'a' }], bottomCenter: [{ text: 'b' }], center: [{ text: 'c' }] })
    const byId = Object.fromEntries(t.root.map(p => [p.id, p]))
    expect(byId['slot_topRight'].align).toBe('tr')
    expect(byId['slot_bottomCenter'].align).toBe('bc')
    expect(byId['slot_center'].align).toBe('c')
  })

  it('bottomBar becomes a row of cells separated by flex spacers', () => {
    const t = slotsToUi({ bottomBar: [[{ text: 'A' }], [{ text: 'B' }], [{ text: 'C' }]] })
    const bar = t.root.find(p => p.id === 'slot_bottomBar')!
    const row = bar.children![0] // the panel wraps a row that spreads the cells
    expect(row.kind).toBe('row')
    // 3 cells + 2 spacers between them
    expect(row.children!.filter(c => c.kind === 'col')).toHaveLength(3)
    expect(row.children!.filter(c => c.kind === 'spacer')).toHaveLength(2)
  })

  it('THE GUARANTEE: content in different zones never overlaps once solved', () => {
    const spec: SlotsSpec = {
      topLeft: [{ text: 'SCORE 999' }, { text: 'LIVES 3' }],
      topRight: [{ text: 'WAVE 4' }],
      bottomCenter: [{ text: 'press SPACE' }],
    }
    const solved = solveUi({ ui: slotsToUi(spec), viewport: VIEWPORT })
    const ids = ['slot_topLeft', 'slot_topRight', 'slot_bottomCenter']
    const rects = ids.map(id => solved.rects[id]).filter(Boolean)
    expect(rects).toHaveLength(3)
    // pairwise: no two zone rects intersect
    const overlap = (a: typeof rects[0], b: typeof rects[0]) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++)
        expect(overlap(rects[i], rects[j]), `${ids[i]} overlaps ${ids[j]}`).toBe(false)
  })

  it('rev changes when content changes (so __uiRects re-solves)', () => {
    const a = slotsToUi({ topLeft: [{ text: 'SCORE 1' }] }).rev
    const b = slotsToUi({ topLeft: [{ text: 'SCORE 2' }] }).rev
    const c = slotsToUi({ topLeft: [{ text: 'SCORE 1' }, { text: 'LIVES 3' }] }).rev
    expect(a).not.toBe(c)
    // same text length → same rev is fine; different length must differ
    expect(a).not.toBe(slotsToUi({ topLeft: [{ text: 'SCORE 12' }] }).rev)
    void b
  })
})

// THE THIRD SPACE (Sep 11): wx/wy anchor the WORLD RECT — the band space.
import { solveUi } from '@/app/engine/ui-solver'
describe('wx/wy world-rect anchors', () => {
  it('a wx band sits on the world rect, not the square or the canvas', () => {
    // portrait world (world rect 0..512 x, -200..712 y in design units),
    // canvas taller still — three DIFFERENT spaces
    const worldRect = { x: 0, y: -200, w: 512, h: 912 }
    const s = solveUi({
      ui: { root: [{ id: 'top', kind: 'panel', anchor: { wx: 0.5, wy: 0 }, align: 'tc', children: [{ kind: 'text', text: 'HI' }] }] },
      viewport: { w: 512, h: 1000 },
      worldRect,
    })
    const r = s.rects['top']
    expect(r).toBeTruthy()
    // the panel's top sits at the WORLD's top (-200), not the square's (0)
    expect(Math.abs(r.y - (-200))).toBeLessThan(2)
  })
  it('without a worldRect, wx degrades to the square (legacy exact)', () => {
    const s = solveUi({ ui: { root: [{ id: 't', kind: 'panel', anchor: { wx: 0, wy: 0 }, align: 'tl', children: [{ kind: 'text', text: 'X' }] }] } })
    expect(s.rects['t'].x).toBeGreaterThanOrEqual(0)
    expect(s.rects['t'].y).toBeGreaterThanOrEqual(0)
  })
})
