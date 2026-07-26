import { describe, it, expect } from 'vitest'
import { initPuzzle, gapBlocked, overGap } from '../../lib/vigil-puzzle.mjs'

const gaps = initPuzzle().gaps
const litPanes = [{ id: 0, lit: 1 }, { id: 1, lit: 1 }]
const darkPanes = [{ id: 0, lit: 0 }, { id: 1, lit: 0 }]

describe('gaps', () => {
  it('there are two gaps in the walkway', () => {
    expect(gaps.map((g) => g.z)).toEqual([8.5, 15.5])
  })
  it('an unlit gap blocks; a lit gap is passable', () => {
    expect(gapBlocked(0, 8.5, gaps, darkPanes)).toBe(true)
    expect(gapBlocked(0, 8.5, gaps, litPanes)).toBe(false)
  })
  it('solid walkway (between gaps) is never blocked by the gate', () => {
    expect(gapBlocked(0, 3, gaps, darkPanes)).toBe(false)
    expect(gapBlocked(0, 12, gaps, darkPanes)).toBe(false)
  })
  it('overGap detects standing above a gap regardless of light', () => {
    expect(overGap(0, 15.5, gaps)).toBe(true)
    expect(overGap(0, 12, gaps)).toBe(false)
  })
})
