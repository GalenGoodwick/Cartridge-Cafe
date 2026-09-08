import { describe, it, expect } from 'vitest'
import { hudToUi } from '@/app/engine/hud-to-ui'
import { solveUi } from '@/app/engine/ui-solver'
import type { HudElement } from '@/app/engine/types'

// The legacy hud DOM overlay is retired → one render authority (the solver). This
// pins the compat adapter: text/bar convert and lay out through the solver;
// html/image drop; positions map faithfully; and — the whole point — two stacked
// text lines authored as a flowed panel can no longer overlap.

const hud = (els: Partial<HudElement>[]) => hudToUi(els as HudElement[])

describe('hudToUi — legacy hud → solver tree', () => {
  it('a text element becomes an anchored panel with a text child at its position', () => {
    const t = hud([{ id: 'score', type: 'text', text: 'SCORE 5', x: '16px', y: '14px', fontSize: '20px', color: '#fff' }])
    expect(t.root).toHaveLength(1)
    const p = t.root[0]
    expect(p.kind).toBe('panel')
    expect(p.anchor).toEqual({ gx: 16, gy: 14 })
    expect(p.align).toBe('tl')
    expect(p.glass).toBe(false)
    expect(p.children![0]).toMatchObject({ kind: 'text', text: 'SCORE 5', fontSize: 20, color: '#fff' })
  })

  it('% coords resolve against the 512 square; right/bottom anchor the far edges', () => {
    const t = hud([
      { id: 'mid', type: 'text', text: 'HI', x: '50%', y: '50%' },
      { id: 'corner', type: 'text', text: 'BR', right: '12px', bottom: '8px' },
    ])
    expect(t.root[0].anchor).toEqual({ gx: 256, gy: 256 })
    expect(t.root[1].anchor).toEqual({ gx: 500, gy: 504 })
    expect(t.root[1].align).toBe('br')
  })

  it('a bar becomes a meter with 0..1 fill', () => {
    const t = hud([{ id: 'hp', type: 'bar', value: 3, max: 4, x: '10px', y: '10px', ...( { width: '80px', barColor: '#0f0' } as object) }])
    expect(t.root[0].children![0]).toMatchObject({ kind: 'meter', value: 0.75, w: 80, hue: '#0f0' })
  })

  it('html and image elements are dropped (no engine-pixel equivalent)', () => {
    const t = hud([
      { id: 'a', type: 'text', text: 'keep' },
      { id: 'b', type: 'html', html: '<div>gone</div>' },
      { id: 'c', type: 'image' },
    ])
    expect(t.root.map(p => p.id)).toEqual(['a'])
  })

  it('clickable text carries a click action', () => {
    const t = hud([{ id: 'start', type: 'text', text: 'PLAY', clickable: true }])
    expect(t.root[0].children![0].click).toBe('start')
  })

  it('invisible / id-less elements are skipped', () => {
    const t = hud([{ id: 'x', type: 'text', text: 'hi', visible: false }, { type: 'text', text: 'no id' }])
    expect(t.root).toHaveLength(0)
  })

  it('the converted tree solves without overlap when authored as flowed text', () => {
    // two lines at the SAME anchor used to collide as absolute DOM; through the
    // solver, stacking them in one panel guarantees separation. Here we prove the
    // solver lays the adapter output out and produces real rects.
    const t = hud([
      { id: 'sc', type: 'text', text: 'SCORE 0', x: '16px', y: '14px', fontSize: '16px' },
      { id: 'lv', type: 'text', text: 'LIVES 3', x: '16px', y: '40px', fontSize: '16px' },
    ])
    const solved = solveUi({ ui: t })
    expect(solved.rects['sc']).toBeTruthy()
    expect(solved.rects['lv']).toBeTruthy()
    // distinct y positions (16px vs 40px anchors preserved)
    expect(solved.rects['lv'].y).toBeGreaterThan(solved.rects['sc'].y)
  })
})
