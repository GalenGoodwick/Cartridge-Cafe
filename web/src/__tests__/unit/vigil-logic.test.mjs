import { describe, it, expect } from 'vitest'
import { initVigilState, stepVigil, watcherGaze, paneLit } from '../../lib/vigil-logic.mjs'

const noInput = { moveX: 0, moveZ: 0, aimX: 0, aimZ: 0 }
// a Watcher parked straight above a point, gazing down — lights whatever is under it
const overhead = (x, z) => ({ origin: [x, 5, z], base: [0, -1, 0], amp: 0, rate: 0, phase: 0 })

describe('initVigilState', () => {
  it('is a clean, versioned walkway world with two gap panes', () => {
    const G = initVigilState()
    expect(G.v).toBe(3)
    expect(G.panes.length).toBe(2)
    expect(G.gaps.length).toBe(2)
    expect(JSON.stringify(G)).toBe(JSON.stringify(initVigilState())) // deterministic
  })
})

describe('watcherGaze sweep', () => {
  it('sweeps around the base over time and stays unit', () => {
    const w = { origin: [-4, 3, 8.5], base: [1, -0.55, 0], amp: 0.5, rate: 1, phase: 0 }
    expect(Math.abs(watcherGaze(w, 0).dir[2])).toBeLessThan(1e-9)
    expect(Math.abs(watcherGaze(w, 1).dir[2])).toBeGreaterThan(0.01)
    expect(Math.abs(Math.hypot(...watcherGaze(w, 1).dir) - 1)).toBeLessThan(1e-9)
  })
})

describe('paneLit — exists-where-seen', () => {
  it('a pane under a gaze is lit; out of reach it is dark', () => {
    const G = initVigilState()
    const gz = [watcherGaze(overhead(0, 8.5), 0)] // straight down onto pane 0 centre
    expect(paneLit(G.panes[0], gz)).toBe(true)
    expect(paneLit(G.panes[1], gz)).toBe(false)
  })
})

describe('THE WALKWAY — cross a gap only where the gaze lights it', () => {
  it('an unlit gap blocks you; lighting its pane lets you cross', () => {
    const G = initVigilState()
    // Watchers far away → both gaps dark. Walk forward: blocked before gap1 (z≈6.8).
    G.watchers = [overhead(50, 50)]
    for (let i = 0; i < 200; i++) stepVigil(G, { moveX: 0, moveZ: 1, aimX: 0, aimZ: 0 }, 1 / 60)
    expect(G.panes[0].lit).toBe(0)
    expect(G.flame.pos[2]).toBeLessThan(7.5)   // stopped at the near lip of gap1
    expect(G.onSolid).toBe(1)                  // not standing over the hole

    // now light gap1's pane → the bridge appears → cross it
    G.watchers = [overhead(0, 8.5)]
    for (let i = 0; i < 200; i++) stepVigil(G, { moveX: 0, moveZ: 1, aimX: 0, aimZ: 0 }, 1 / 60)
    expect(G.panes[0].lit).toBe(1)
    expect(G.flame.pos[2]).toBeGreaterThan(10) // crossed gap1
  })

  it('cannot leave the narrow walkway sideways', () => {
    const G = initVigilState()
    for (let i = 0; i < 200; i++) stepVigil(G, { moveX: 1, moveZ: 0, aimX: 0, aimZ: 0 }, 1 / 60)
    expect(Math.abs(G.flame.pos[0])).toBeLessThanOrEqual(2.6)
  })

  it('wins at the reliquary end', () => {
    const G = initVigilState()
    G.flame.pos = [0, 1, 22.3]
    stepVigil(G, { moveX: 0, moveZ: 0, aimX: 0, aimZ: 0 }, 1 / 60)
    expect(G.win).toBe(1)
  })
})
