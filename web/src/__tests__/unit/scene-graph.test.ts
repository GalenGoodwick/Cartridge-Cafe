import { describe, it, expect } from 'vitest'
import { sceneDefine, validateSceneGraph, type SceneConfig } from '@/app/engine/scene-graph'

// A tiny harness: one persistent root (the latch), a mutable worldData, and a
// `tick` that runs sceneDefine once with the given mouse input + dt.
function harness(config: SceneConfig) {
  const root: Record<string, unknown> = {}
  const wd: Record<string, unknown> = { __play_sound: [] as unknown[] }
  const sim = { worldData: wd }
  const tick = (input: { mx?: number; my?: number; down?: boolean; dt?: number } = {}) => {
    wd.mouse_x = input.mx
    wd.mouse_y = input.my
    wd.mouse_down = input.down ?? false
    return sceneDefine(sim, () => root, config, input.dt ?? 0.016)
  }
  return { tick, root, wd }
}

const TWO_ROOM: SceneConfig = {
  start: 'a',
  fadeSeconds: 0.5,
  transitionSound: { frequency: 90, duration: 0.3, volume: 0.1 },
  scenes: {
    a: { exits: [{ to: 'b', zone: { x: 400, y: 256, r: 40 }, chevron: { dir: 'right' } }] },
    b: { exits: [{ to: 'a', zone: { x: 100, y: 256, r: 40 }, chevron: { dir: 'left' } }] },
  },
}

describe('sceneDefine — navigation', () => {
  it('starts at the declared start scene', () => {
    const { tick } = harness(TWO_ROOM)
    const h = tick()
    expect(h.view).toBe('a')
    expect(h.viewIndex).toBe(0)
    expect(h.fade).toBe(0)
  })

  it('a click inside an exit zone navigates and starts a crossfade', () => {
    const { tick } = harness(TWO_ROOM)
    tick()                                   // settle
    const h = tick({ mx: 400, my: 256, down: true })   // click b's door
    expect(h.view).toBe('b')
    expect(h.prev).toBe('a')
    expect(h.navClicked).toBe(true)
    expect(h.fade).toBeGreaterThan(0.9)      // fresh transition
  })

  it('a click OUTSIDE every zone does nothing', () => {
    const { tick } = harness(TWO_ROOM)
    tick()
    const h = tick({ mx: 10, my: 10, down: true })
    expect(h.view).toBe('a')
    expect(h.navClicked).toBe(false)
  })

  it('the crossfade decays to 0 over fadeSeconds', () => {
    const { tick } = harness(TWO_ROOM)
    tick()
    tick({ mx: 400, my: 256, down: true })   // fade = 1
    let h = tick({ dt: 0.25 })               // half of 0.5s
    expect(h.fade).toBeCloseTo(0.5, 1)
    h = tick({ dt: 0.5 })
    expect(h.fade).toBe(0)
  })

  it('is edge-triggered: holding the button down does not re-navigate', () => {
    const cfg: SceneConfig = {
      start: 'a',
      scenes: {
        a: { exits: [{ to: 'b', zone: { x: 400, y: 256, r: 40 } }] },
        b: { exits: [{ to: 'a', zone: { x: 400, y: 256, r: 40 } }] },  // same spot!
      },
    }
    const { tick } = harness(cfg)
    tick()
    const h1 = tick({ mx: 400, my: 256, down: true })   // a→b
    expect(h1.view).toBe('b')
    // hold: still down, no new edge → must NOT bounce b→a even though the zone matches
    for (let i = 0; i < 5; i++) tick({ mx: 400, my: 256, down: true, dt: 0.3 })
    const h2 = tick({ mx: 400, my: 256, down: true, dt: 0.3 })
    expect(h2.view).toBe('b')
  })
})

describe('sceneDefine — the overlap bug is structurally gone', () => {
  it('two overlapping exits: the NEAREST wins, not both', () => {
    const cfg: SceneConfig = {
      start: 'shore',
      scenes: {
        shore: {
          exits: [
            { to: 'dome', zone: { x: 214, y: 318, r: 80 } },     // overlaps building
            { to: 'gate', zone: { x: 250, y: 318, r: 62 } },     // 36px away
          ],
        },
        dome: { terminal: true },
        gate: { terminal: true },
      },
    }
    const { tick } = harness(cfg)
    tick()
    // click at 245,318 — inside both, but nearer gate (5px) than dome (31px)
    const h = tick({ mx: 245, my: 318, down: true })
    expect(h.view).toBe('gate')
  })
})

describe('sceneDefine — gated exits', () => {
  it('a string `when` gates on named state', () => {
    const cfg: SceneConfig = {
      start: 'a',
      state: { open: false },
      scenes: {
        a: { exits: [{ to: 'b', zone: { x: 256, y: 256, r: 40 }, when: 'open' }] },
        b: { terminal: true },
      },
    }
    const { tick } = harness(cfg)
    tick()
    let h = tick({ mx: 256, my: 256, down: true })
    expect(h.view).toBe('a')                 // locked
    h.state.open = true                      // solve the puzzle
    tick({ down: false })                    // release
    h = tick({ mx: 256, my: 256, down: true })
    expect(h.view).toBe('b')                 // now it opens
  })

  it('a predicate `when` sees live state', () => {
    const cfg: SceneConfig = {
      start: 'a',
      state: { charge: 0 },
      scenes: {
        a: { exits: [{ to: 'b', zone: { x: 256, y: 256, r: 40 }, when: s => (s.charge as number) >= 3 }] },
        b: { terminal: true },
      },
    }
    const { tick } = harness(cfg)
    const h0 = tick()
    h0.state.charge = 2
    tick({ down: false })
    expect(tick({ mx: 256, my: 256, down: true }).view).toBe('a')
    const h = tick({ down: false })
    h.state.charge = 5
    tick({ down: false })
    expect(tick({ mx: 256, my: 256, down: true }).view).toBe('b')
  })

  it('exits() reports enabled/dir for the shader — the single source', () => {
    const cfg: SceneConfig = {
      start: 'a',
      state: { open: false },
      scenes: {
        a: { exits: [
          { to: 'b', zone: { x: 400, y: 256, r: 40 }, chevron: { dir: 'right' }, when: 'open' },
          { to: 'c', zone: { x: 100, y: 256, r: 40 }, chevron: { dir: 'left' } },
        ] },
        b: { terminal: true }, c: { terminal: true },
      },
    }
    const { tick } = harness(cfg)
    const h = tick()
    const rows = h.exits()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ to: 'b', dir: 0, enabled: false })  // right, locked
    expect(rows[1]).toMatchObject({ to: 'c', dir: 1, enabled: true })   // left, open
  })
})

describe('sceneDefine — transitions & persistence', () => {
  it('cut transition sets fade to 0 immediately', () => {
    const cfg: SceneConfig = {
      start: 'a', transition: 'cut',
      scenes: {
        a: { exits: [{ to: 'b', zone: { x: 256, y: 256, r: 40 } }] },
        b: { terminal: true },
      },
    }
    const { tick } = harness(cfg)
    tick()
    const h = tick({ mx: 256, my: 256, down: true })
    expect(h.view).toBe('b')
    expect(h.fade).toBe(0)
  })

  it('progress survives across ticks via the latch root', () => {
    const { tick, root } = harness(TWO_ROOM)
    tick()
    tick({ mx: 400, my: 256, down: true })
    expect((root.__scenes as { view: string }).view).toBe('b')
  })

  it('a corrupt saved view falls back to start, never crashes', () => {
    const config = TWO_ROOM
    const root: Record<string, unknown> = { __scenes: { view: 'ghost', prev: 'ghost', fade: 0, state: {}, _down: false } }
    const wd: Record<string, unknown> = {}
    const h = sceneDefine({ worldData: wd }, () => root, config, 0.016)
    expect(h.view).toBe('a')
  })

  it('onEnter/onExit fire on transition', () => {
    const log: string[] = []
    const cfg: SceneConfig = {
      start: 'a',
      scenes: {
        a: { exits: [{ to: 'b', zone: { x: 256, y: 256, r: 40 } }], onExit: () => log.push('exit-a') },
        b: { terminal: true, onEnter: () => log.push('enter-b') },
      },
    }
    const { tick } = harness(cfg)
    tick()
    tick({ mx: 256, my: 256, down: true })
    expect(log).toEqual(['exit-a', 'enter-b'])
  })
})

describe('validateSceneGraph', () => {
  it('errors on an exit to an undefined scene', () => {
    const { errors } = validateSceneGraph({
      start: 'a', scenes: { a: { exits: [{ to: 'nowhere', zone: { x: 1, y: 1, r: 1 } }] } },
    })
    expect(errors.some(e => /undefined scene "nowhere"/.test(e))).toBe(true)
  })

  it('warns on an unreachable scene', () => {
    const { warnings } = validateSceneGraph({
      start: 'a',
      scenes: {
        a: { exits: [{ to: 'b', zone: { x: 1, y: 1, r: 1 } }] },
        b: { terminal: true },
        island: { terminal: true },   // nothing points here
      },
    })
    expect(warnings.some(w => /island.*unreachable/.test(w))).toBe(true)
  })

  it('warns on a non-terminal dead end', () => {
    const { warnings } = validateSceneGraph({
      start: 'a',
      scenes: { a: { exits: [{ to: 'b', zone: { x: 1, y: 1, r: 1 } }] }, b: {} },
    })
    expect(warnings.some(w => /b.*dead end/.test(w))).toBe(true)
  })

  it('warns on overlapping exit zones', () => {
    const { warnings } = validateSceneGraph({
      start: 'a',
      scenes: {
        a: { exits: [
          { to: 'b', zone: { x: 250, y: 250, r: 60 } },
          { to: 'c', zone: { x: 260, y: 250, r: 60 } },   // 10px apart, huge overlap
        ] },
        b: { terminal: true }, c: { terminal: true },
      },
    })
    expect(warnings.some(w => /overlap/.test(w))).toBe(true)
  })

  it('warns on an off-canvas zone', () => {
    const { warnings } = validateSceneGraph({
      start: 'a',
      scenes: { a: { exits: [{ to: 'b', zone: { x: 900, y: 256, r: 40 } }] }, b: { terminal: true } },
    })
    expect(warnings.some(w => /off-canvas/.test(w))).toBe(true)
  })

  it('a clean graph yields no errors or warnings', () => {
    const { errors, warnings } = validateSceneGraph(TWO_ROOM)
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })
})

describe('worker injection — sceneDefine.toString() round-trips through eval', () => {
  it('the stringified function is self-contained and navigates (the sandbox path)', () => {
    // The sandbox builds its worker from `const __sceneDefine = ${sceneDefine.toString()}`.
    // Reconstruct exactly that and run it — proves no external ref / helper leaked.
    // eslint-disable-next-line no-eval
    const injected = eval('(' + sceneDefine.toString() + ')') as typeof sceneDefine
    const root: Record<string, unknown> = {}
    const wd: Record<string, unknown> = {}
    const sim = { worldData: wd }
    const cfg: SceneConfig = {
      start: 'a',
      scenes: {
        a: { exits: [{ to: 'b', zone: { x: 300, y: 200, r: 50 } }] },
        b: { terminal: true },
      },
    }
    // settle, then click
    wd.mouse_down = false
    injected(sim, () => root, cfg, 0.016)
    wd.mouse_x = 300; wd.mouse_y = 200; wd.mouse_down = true
    const h = injected(sim, () => root, cfg, 0.016)
    expect(h.view).toBe('b')
    expect(h.navClicked).toBe(true)
  })
})
