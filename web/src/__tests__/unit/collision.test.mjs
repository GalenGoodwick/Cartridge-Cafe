import { describe, it, expect } from 'vitest'
import { solidAt, resolveMove } from '../../lib/collision.mjs'

describe('solidAt — the narrow walkway', () => {
  it('the central walkway is walkable', () => {
    expect(solidAt(0, 3)).toBe(false)
    expect(solidAt(2, 12)).toBe(false)
  })
  it('the colonnade sides are walls', () => {
    expect(solidAt(3, 10)).toBe(true)
    expect(solidAt(-4, 5)).toBe(true)
  })
  it('the ends of the nave are solid', () => {
    expect(solidAt(0, -2)).toBe(true)
    expect(solidAt(0, 30)).toBe(true)
  })
  it('the reliquary ark blocks', () => {
    expect(solidAt(0, 24)).toBe(true)
  })
})

describe('resolveMove', () => {
  it('a clear move passes', () => {
    expect(resolveMove(0, 3, 0, 4)).toEqual([0, 4])
  })
  it('is stopped at the walkway wall', () => {
    const [x] = resolveMove(2, 10, 4, 10)
    expect(Math.abs(x)).toBeLessThanOrEqual(2.6)
  })
  it('honours a dynamic gate (an unlit gap)', () => {
    const gate = (x, z) => Math.abs(z - 8.5) < 1.6 // pretend gap at z=8.5 is a hole
    const [, z] = resolveMove(0, 7, 0, 9, gate)
    expect(z).toBeLessThan(7.5) // could not step into the hole
  })
})
