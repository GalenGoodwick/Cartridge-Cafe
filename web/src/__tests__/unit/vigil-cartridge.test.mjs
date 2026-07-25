import { describe, it, expect } from 'vitest'
import { HOOK, LIB, VISUAL, buildBatch } from '../../app/engine/scenes/vigil-cartridge.mjs'

// A minimal stand-in for the engine's `sim`, matching what the hook touches.
function fakeSim(worldData = {}) {
  return { worldData, fields: new Map() }
}
// Compile the shipped hook exactly as the engine does: new Function('sim','dt', code)
const runHook = new Function('sim', 'dt', HOOK)

describe('VIGIL hook — the stringified-and-shipped code actually runs', () => {
  it('runs a tick against a fake sim without throwing, and publishes uniforms', () => {
    const sim = fakeSim()
    expect(() => runHook(sim, 1 / 60)).not.toThrow()
    expect(sim.worldData.last_hook_error).toBeUndefined()
    expect(Array.isArray(sim.worldData.gpuUniforms)).toBe(true)
    expect(sim.worldData.gpuUniforms.length).toBeGreaterThanOrEqual(41)
    // reliquaryZ published at index 40
    expect(sim.worldData.gpuUniforms[40]).toBe(24)
  })

  it('the EMBEDDED logic advances the flame along the walkway and publishes pane centres', () => {
    const sim = fakeSim()
    for (let i = 0; i < 400; i++) { sim.worldData.key_w = true; runHook(sim, 1 / 60) }
    expect(sim.worldData.last_hook_error).toBeUndefined()
    expect(sim.worldData.__vg.flame.pos[2]).toBeGreaterThan(3.5) // moved forward from start z=3
    const u = sim.worldData.gpuUniforms
    expect(Math.abs(u[28] - 0)).toBeLessThan(0.01)    // pane0 centre x ≈ 0
    expect(Math.abs(u[29] - 8.5)).toBeLessThan(0.01)  // pane0 centre z ≈ 8.5
  })

  it('survives 300 ticks of driven input without throwing', () => {
    const sim = fakeSim()
    for (let i = 0; i < 300; i++) {
      sim.worldData.key_w = i % 3 !== 0
      sim.worldData.key_d = i % 2 === 0
      sim.worldData.mouse_x = 256 + 120 * Math.sin(i * 0.1)
      sim.worldData.mouse_y = 256
      expect(() => runHook(sim, 1 / 60)).not.toThrow()
    }
    expect(sim.worldData.last_hook_error).toBeUndefined()
  })
})

describe('VIGIL WGSL — conforms to the bridge’s own accept rules', () => {
  const wgsl = LIB + '\n' + VISUAL
  it('carries the exact visual_ signature the engine calls', () => {
    expect(VISUAL).toContain(
      'fn visual_vigil(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f')
  })
  it('declares no pipeline entry points or bindings (visuals are pure functions)', () => {
    expect(/@fragment|@vertex|@compute/.test(wgsl)).toBe(false)
    expect(/@group|@binding|@location|@builtin/.test(wgsl)).toBe(false)
  })
  it('stays under the 60KB shader cap', () => {
    expect(wgsl.length).toBeLessThan(60000)
  })
  it('has no unbounded or oversized GPU loops', () => {
    expect(/while\s*\(\s*true\s*\)/.test(wgsl)).toBe(false)
    const bounds = [...wgsl.matchAll(/for\s*\([^)]*<\s*(\d+)/g)].map((m) => +m[1])
    expect(Math.max(0, ...bounds)).toBeLessThanOrEqual(2048)
  })
  it('does not redeclare a WGSL builtin name (all helpers vg_-prefixed)', () => {
    const declared = [...wgsl.matchAll(/fn\s+(\w+)\s*\(/g)].map((m) => m[1])
    for (const name of declared) {
      expect(name === 'visual_vigil' || name.startsWith('vg_')).toBe(true)
    }
  })
})

describe('VIGIL build batch', () => {
  it('is one atomic module+visual batch in-idiom', () => {
    const b = buildBatch()
    const types = b.map((c) => c.type)
    expect(types).toContain('define_module')
    expect(types).toContain('define_visual')
    expect(types).toContain('set_world_params')
    expect(b.find((c) => c.type === 'define_visual').name).toBe('vigil')
    expect(b.find((c) => c.type === 'define_module').name).toBe('vg_lib')
  })
})
