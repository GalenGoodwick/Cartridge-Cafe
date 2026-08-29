// THE SLIDER PRIMITIVE (Galen, Aug 29) — solver math, unit-proven before ship
// (the proper-always law: new math gets tests).
import { describe, it, expect } from 'vitest'
import { solveUi } from '@/app/engine/ui-solver'

const tree = (value: number, w = 200) => ({
  rev: 1,
  root: [{
    id: 'p', kind: 'panel' as const, glass: false, anchor: { gx: 56, gy: 100 }, align: 'tl' as const, w: w + 8, pad: 4,
    children: [{ id: 's1', kind: 'slider' as const, value, w, h: 10, hue: '#8cd8ff' }],
  }],
})

describe('ui-solver slider primitive', () => {
  it('emits a track meter, a knob pill, a drag hit, and the value rect', () => {
    const s = solveUi({ ui: tree(0.5) })
    expect(s.meters.find(m => m.id === 's1:track')).toBeTruthy()
    expect(s.meters.find(m => m.id === 's1:knob')).toBeTruthy()
    const hit = s.hits.find(h => h.id === 's1')
    expect(hit?.action).toBe('slider:s1')
    expect(s.rects['s1']).toBeTruthy()
  })
  it('knob rides the value along the track', () => {
    for (const v of [0, 0.25, 0.75, 1]) {
      const s = solveUi({ ui: tree(v) })
      const track = s.meters.find(m => m.id === 's1:track')!
      const knob = s.meters.find(m => m.id === 's1:knob')!
      const center = knob.x + knob.w / 2
      const expected = track.x + Math.max(knob.w / 2, Math.min(track.w - knob.w / 2, v * track.w))
      expect(Math.abs(center - expected)).toBeLessThan(1.01)
      // knob never leaves the track
      expect(knob.x).toBeGreaterThanOrEqual(track.x - 0.01)
      expect(knob.x + knob.w).toBeLessThanOrEqual(track.x + track.w + 0.01)
    }
  })
  it('track fill mirrors the value; hit band is larger than the track (thumb room)', () => {
    const s = solveUi({ ui: tree(0.66) })
    const track = s.meters.find(m => m.id === 's1:track')!
    expect(track.fill).toBeCloseTo(0.66, 5)
    const hit = s.hits.find(h => h.id === 's1')!
    expect(hit.w).toBeGreaterThan(track.w)
    expect(hit.h).toBeGreaterThan(track.h)
  })
  it('drag math round-trips: (x - rect.x) / rect.w recovers the value', () => {
    const s = solveUi({ ui: tree(0.4, 160) })
    const r = s.rects['s1']
    const dragX = r.x + 0.8 * r.w
    expect((dragX - r.x) / r.w).toBeCloseTo(0.8, 5)
  })
  it('clamps out-of-range values', () => {
    const lo = solveUi({ ui: tree(-3) }).meters.find(m => m.id === 's1:track')!
    const hi = solveUi({ ui: tree(9) }).meters.find(m => m.id === 's1:track')!
    expect(lo.fill).toBe(0); expect(hi.fill).toBe(1)
  })
})
