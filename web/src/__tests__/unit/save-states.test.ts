// SAVE STATES (DESIGN-save-states.md) — the ROM/save-state scoping rules.
// These four pure functions ARE the architecture; everything in FieldEngine is wiring.
import { describe, it, expect } from 'vitest'
import {
  captureSaveState, saveStateBaseline, stripSaveState, sharedKeys, SAVE_STATE_DENY,
} from '../../app/engine/persistence/serialize'

const ROM = {
  __saveArch: 'rom',
  __shared: ['lanterns'],
  instructions: 'how to play',
  renderScale: 0.8,
  __vf: { px: 0, py: 1.7, pz: -6, score: 0 },      // spawn state (authored)
  lanterns: [{ x: 1 }],                              // class-2 shared by declaration
  gpuUniforms: [0, 0, 0],
}

describe('save states — scoping', () => {
  it('captures only keys that diverged from the ROM baseline', () => {
    const shared = sharedKeys(ROM)
    const base = saveStateBaseline(ROM, shared)
    const live = { ...ROM, __vf: { px: 3, py: 1.7, pz: -120, score: 900 }, newKey: 42 }
    const state = captureSaveState(live, base, shared)
    expect(state).toEqual({ __vf: { px: 3, py: 1.7, pz: -120, score: 900 }, newKey: 42 })
  })

  it('never captures denied, shared, or input keys', () => {
    const shared = sharedKeys(ROM)
    const base = saveStateBaseline(ROM, shared)
    const live = {
      ...ROM,
      lanterns: [{ x: 1 }, { x: 9 }],       // shared → world's, not the player's
      gpuUniforms: [1, 2, 3],               // denied
      key_w: true, mouse_x: 250,            // input
      hud: 'x', save: { classic: 1 },       // denied
    }
    const state = captureSaveState(live, base, shared)
    expect(state).toEqual({})
  })

  it('baseline-equal keys are omitted so a new ROM shows through (upgrade semantics)', () => {
    const shared = sharedKeys(ROM)
    const base = saveStateBaseline(ROM, shared)
    const state = captureSaveState({ ...ROM }, base, shared)   // player never moved
    expect(state).toEqual({})
  })

  it('uncloneable values never crash or persist', () => {
    const shared = sharedKeys(ROM)
    const base = saveStateBaseline(ROM, shared)
    const circular: Record<string, unknown> = {}; circular.self = circular
    const live = { ...ROM, broken: circular, fine: 7 }
    const state = captureSaveState(live, base, shared)
    expect(state).toEqual({ fine: 7 })
  })

  it('stripSaveState removes exactly what capture takes — ROM + shared survive', () => {
    const shared = sharedKeys(ROM)
    const base = saveStateBaseline(ROM, shared)
    const live = {
      ...ROM,
      __vf: { px: 3, py: 1.7, pz: -120, score: 900 },   // player state → stripped
      lanterns: [{ x: 1 }, { x: 9 }],                    // shared → kept (world-persistent)
      newKey: 42,                                        // player state → stripped
    }
    const rom = stripSaveState(live, base, shared)
    expect(rom.__vf).toBeUndefined()
    expect(rom.newKey).toBeUndefined()
    expect(rom.lanterns).toEqual([{ x: 1 }, { x: 9 }])
    expect(rom.instructions).toBe('how to play')
    expect(rom.renderScale).toBe(0.8)
  })

  it('capture ∪ strip = live worldData (nothing falls between the two)', () => {
    const shared = sharedKeys(ROM)
    const base = saveStateBaseline(ROM, shared)
    const live = { ...ROM, __vf: { px: 9 }, extra: 'x', lanterns: [{ x: 2 }] }
    const state = captureSaveState(live, base, shared)
    const rom = stripSaveState(live, base, shared)
    for (const k of Object.keys(live)) {
      if (k.startsWith('key_') || k.startsWith('mouse_')) continue
      expect(k in state || k in rom, `key ${k} lost`).toBe(true)
    }
    for (const k of Object.keys(state)) expect(k in rom, `key ${k} in both`).toBe(false)
  })

  it('sharedKeys tolerates junk declarations', () => {
    expect(sharedKeys({})).toEqual(new Set())
    expect(sharedKeys({ __shared: 'nope' })).toEqual(new Set())
    expect(sharedKeys({ __shared: [1, 'ok', null] })).toEqual(new Set(['ok']))
  })

  it('design-mode re-baseline: authored tuning becomes ROM, not the owner save', () => {
    // owner tunes globewarp's aqua knobs live in design mode, then turns it off.
    const shared = sharedKeys(ROM)
    const authored = { ...ROM, __vf: undefined, __aqua2: { nb: 20, kick: 1.5, rest: 0.04 } }
    delete (authored as Record<string, unknown>).__vf
    // turning design mode OFF re-baselines from the current (authored) worldData
    const newBase = saveStateBaseline(authored, shared)
    // a player who now visits and doesn't touch the knobs captures nothing:
    expect(captureSaveState(authored, newBase, shared)).toEqual({})
    // and the authored knob is the ROM value everyone boots with
    expect(JSON.parse(newBase.__aqua2)).toEqual({ nb: 20, kick: 1.5, rest: 0.04 })
    // a player who then diverges only saves THEIR change, over the authored ROM
    const played = { ...authored, __aqua2: { nb: 20, kick: 9.9, rest: 0.04 }, __myrun: { score: 5 } }
    expect(captureSaveState(played, newBase, shared)).toEqual({ __aqua2: { nb: 20, kick: 9.9, rest: 0.04 }, __myrun: { score: 5 } })
  })

  it('the deny list covers the engine plumbing that must never ride a save', () => {
    for (const k of ['gpuUniforms', 'gpuPopulation', '__nodes', '__bridge_rev', 'save', 'persist', '__saveArch', '__shared']) {
      expect(SAVE_STATE_DENY.has(k), `${k} missing from deny`).toBe(true)
    }
  })
})
