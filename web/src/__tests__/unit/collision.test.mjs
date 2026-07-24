import { describe, it, expect } from 'vitest'
import { solidAt, resolveMove } from '../../lib/collision.mjs'
import { initVigilState, stepVigil } from '../../lib/vigil-logic.mjs'

describe('solidAt — mirrors the shader solids', () => {
  it('open ledge is walkable', () => {
    expect(solidAt(4.5, 10)).toBe(false)
    expect(solidAt(-4.5, 5)).toBe(false)
  })
  it('out of bounds is solid', () => {
    expect(solidAt(10, 10)).toBe(true)   // past the ledge edge
    expect(solidAt(0, -1)).toBe(true)    // behind the start
    expect(solidAt(0, 30)).toBe(true)    // past the back wall
  })
  it('columns block', () => {
    expect(solidAt(6, 8)).toBe(true)
    expect(solidAt(-6, 20)).toBe(true)
  })
  it('watchers block', () => {
    expect(solidAt(6, 14)).toBe(true)
  })
  it('the reliquary blocks', () => {
    expect(solidAt(0, 24)).toBe(true)
  })
  it('the central chasm is NOT solid (step onto a pane, or fall)', () => {
    expect(solidAt(0, 10)).toBe(false)
    expect(solidAt(1.5, 16)).toBe(false)
  })
})

describe('resolveMove', () => {
  it('a clear move passes through', () => {
    expect(resolveMove(4, 10, 4, 11)).toEqual([4, 11])
  })
  it('a move out of bounds is stopped at the boundary axis', () => {
    const [x] = resolveMove(4, 10, 12, 10)
    expect(solidAt(x, 10)).toBe(false)
    expect(x).toBeLessThanOrEqual(9)
  })
  it('slides along the clear axis instead of sticking', () => {
    const [x, z] = resolveMove(5, 7, 6, 8) // (6,8) is a column — must not land inside it
    expect(solidAt(x, z)).toBe(false)
  })
})

describe('PLAYTHROUGH — no more clip-through (the exact prior failure)', () => {
  it('walking hard forward + sideways never leaves the world or enters a solid', () => {
    const G = initVigilState()
    let maxZ = 0, maxAbsX = 0, everSolid = false
    for (let i = 0; i < 1200; i++) {
      stepVigil(G, { moveX: Math.sin(i * 0.05), moveZ: 1, aimX: 0, aimZ: 1 }, 1 / 60)
      maxZ = Math.max(maxZ, G.flame.pos[2])
      maxAbsX = Math.max(maxAbsX, Math.abs(G.flame.pos[0]))
      if (solidAt(G.flame.pos[0], G.flame.pos[2])) everSolid = true
    }
    // before collision, the flame reached z≈50 (past everything). Now it is bounded.
    expect(maxZ).toBeLessThanOrEqual(25.5)
    expect(maxAbsX).toBeLessThanOrEqual(9)
    expect(everSolid).toBe(false) // never rests inside a wall/column/figure
  })
})
