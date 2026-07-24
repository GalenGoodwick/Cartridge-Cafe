import { describe, it, expect } from 'vitest'
import { initVigilState, stepVigil, watcherGaze, flameRay } from '../../lib/vigil-logic.mjs'
import { rayPlaneHit, pointInPaneUV, add, scale } from '../../lib/gaze-math.mjs'

const noInput = { moveX: 0, moveZ: 0, aimX: 0, aimZ: 0 }

describe('initVigilState', () => {
  it('is a clean, versioned, deterministic world', () => {
    const G = initVigilState()
    expect(G.v).toBe(1)
    expect(G.panes.length).toBe(3)
    expect(G.win).toBe(0)
    // deterministic: two fresh states are identical
    expect(JSON.stringify(G)).toBe(JSON.stringify(initVigilState()))
  })
})

describe('watcherGaze', () => {
  it('sweeps around the base direction over time', () => {
    const w = { origin: [0, 3, 0], base: [1, -0.35, 0], amp: 0.6, rate: 1, phase: 0 }
    const g0 = watcherGaze(w, 0)
    const g1 = watcherGaze(w, 1.0)
    // at t=0, yaw=0 → dir is base normalized (no z component)
    expect(Math.abs(g0.dir[2])).toBeLessThan(1e-9)
    // later the sweep has rotated some z in
    expect(Math.abs(g1.dir[2])).toBeGreaterThan(0.01)
    // stays unit
    expect(Math.abs(Math.hypot(...g1.dir) - 1)).toBeLessThan(1e-9)
  })
})

describe('stepVigil — exists-where-seen (lit)', () => {
  it('a pane under a Watcher gaze reads lit; one out of reach stays dark', () => {
    const G = initVigilState()
    // Aim watcher 0 straight down onto pane 0 (origin[-1,1,7], spans x,z in +2).
    // Put the watcher directly above the pane centre and gaze -y, no sweep.
    G.watchers = [{ origin: [0, 5, 8], base: [0, -1, 0], amp: 0, rate: 0, phase: 0 }]
    stepVigil(G, noInput, 0.016)
    const lit = G.panes.map((p) => p.lit)
    expect(lit[0]).toBe(1) // pane 0 centre is [0,1,8] — directly under the gaze
    expect(lit[1]).toBe(0) // pane 1 is at z=14 — not seen
    expect(lit[2]).toBe(0)
  })
})

describe('stepVigil — the ray∩ray∩pane rule flip', () => {
  it('flips a lit pane when the flame light crosses the gaze on it', () => {
    const G = initVigilState()
    // One watcher gazing straight down onto pane 0 centre [0,1,8].
    G.watchers = [{ origin: [0, 5, 8], base: [0, -1, 0], amp: 0, rate: 0, phase: 0 }]
    // Flame sitting on the pane, casting light through the same point.
    G.flame = { pos: [-2, 1, 8], aim: [1, 0, 0] } // light travels +x through [0,1,8]
    G.panes = [{ id: 0, origin: [-1, 1, 7], uAxis: [2, 0, 0], vAxis: [0, 0, 2], rule: 'floor', lit: 0, flipped: 0 }]
    stepVigil(G, noInput, 0.016)
    expect(G.panes[0].lit).toBe(1)
    expect(G.panes[0].rule).toBe('door') // floor → door
    expect(G.panes[0].flipped).toBe(1)
    expect(G.events.some((e) => e.type === 'flip' && e.pane === 0)).toBe(true)
  })

  it('does NOT flip when the flame light misses the gaze crossing', () => {
    const G = initVigilState()
    G.watchers = [{ origin: [0, 5, 8], base: [0, -1, 0], amp: 0, rate: 0, phase: 0 }]
    // flame light points AWAY from the pane — no crossing on it
    G.flame = { pos: [-2, 1, 8], aim: [-1, 0, 0] }
    G.panes = [{ id: 0, origin: [-1, 1, 7], uAxis: [2, 0, 0], vAxis: [0, 0, 2], rule: 'floor', lit: 0, flipped: 0 }]
    stepVigil(G, noInput, 0.016)
    expect(G.panes[0].lit).toBe(1)
    expect(G.panes[0].rule).toBe('floor') // unchanged
    expect(G.panes[0].flipped).toBe(0)
  })

  it('flips only ONCE per arming, and re-arms after going dark', () => {
    const G = initVigilState()
    G.watchers = [{ origin: [0, 5, 8], base: [0, -1, 0], amp: 0, rate: 0, phase: 0 }]
    G.flame = { pos: [-2, 1, 8], aim: [1, 0, 0] }
    G.panes = [{ id: 0, origin: [-1, 1, 7], uAxis: [2, 0, 0], vAxis: [0, 0, 2], rule: 'floor', lit: 0, flipped: 0 }]
    stepVigil(G, noInput, 0.016)
    expect(G.panes[0].rule).toBe('door')
    // step again while still lit+crossing: must NOT flip back to floor
    stepVigil(G, noInput, 0.016)
    expect(G.panes[0].rule).toBe('door')
    expect(G.events.filter((e) => e.type === 'flip').length).toBe(0) // no new flip this tick
    // now blind the pane (move the watcher away) → it goes dark and re-arms
    G.watchers = [{ origin: [100, 5, 100], base: [0, -1, 0], amp: 0, rate: 0, phase: 0 }]
    stepVigil(G, noInput, 0.016)
    expect(G.panes[0].lit).toBe(0)
    expect(G.panes[0].flipped).toBe(0) // re-armed
  })
})

describe('stepVigil — footing and win', () => {
  it('reports onSolid when standing on a lit floor pane (no flip)', () => {
    const G = initVigilState()
    // gaze lights the pane at its far corner [0.8,1,8]; the flame stands at
    // [0,1,7.2] — inside the pane but 0.8 off the gaze line, so no cross fires.
    G.watchers = [{ origin: [0.8, 5, 8], base: [0, -1, 0], amp: 0, rate: 0, phase: 0 }]
    G.flame = { pos: [0, 1, 7.2], aim: [1, 0, 0] }
    G.panes = [{ id: 0, origin: [-1, 1, 7], uAxis: [2, 0, 0], vAxis: [0, 0, 2], rule: 'floor', lit: 0, flipped: 0 }]
    stepVigil(G, noInput, 0.016)
    expect(G.panes[0].lit).toBe(1)
    expect(G.panes[0].rule).toBe('floor') // stayed floor — no cross
    expect(G.onSolid).toBe(1)
  })

  it('wins on reaching the reliquary z', () => {
    const G = initVigilState()
    G.flame.pos = [0, 1, 23.9]
    stepVigil(G, { moveX: 0, moveZ: 1, aimX: 0, aimZ: 0 }, 0.2) // steps past reliquaryZ=24
    expect(G.win).toBe(1)
    expect(G.events.some((e) => e.type === 'win')).toBe(true)
  })
})

describe('determinism — same inputs replay identically', () => {
  it('two runs of 300 ticks produce identical state', () => {
    const run = () => {
      const G = initVigilState()
      for (let i = 0; i < 300; i++) stepVigil(G, { moveX: Math.sin(i * 0.1) > 0 ? 1 : -1, moveZ: 0.5, aimX: 1, aimZ: 0 }, 1 / 60)
      return JSON.stringify(G)
    }
    expect(run()).toBe(run())
  })
})
