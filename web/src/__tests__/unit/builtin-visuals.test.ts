import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { BUILTIN_VISUAL_WGSL, buildSuperimposedComputeShader } from '@/app/engine/shaders'

// "Lower the floor" FIX 1 — the built-in visual library was re-enabled and the
// runtime id range offset above it so `create_field {shape,color}` draws with no
// WGSL. These are the invariants that keep that true: the library is present, its
// ids never collide with the runtime range, and the WHOLE merged uber-shader
// (built-ins + a runtime visual) compiles on naga — the same validator the
// browser's WebGPU stack runs. Compile-in-the-eye, pinned as math.

// Must match renderer.ts RUNTIME_VISUAL_ID_BASE — the offset that keeps the
// runtime ids clear of the built-in reserved range in the "first id wins" dedup.
const RUNTIME_VISUAL_ID_BASE = 100

const NAGA = join(process.env.HOME || '', '.cargo/bin/naga')
const hasNaga = existsSync(NAGA)

function nagaValidate(wgsl: string): { ok: boolean; err?: string } {
  const tmp = join(tmpdir(), `builtin-visuals-${process.pid}-${wgsl.length}.wgsl`)
  writeFileSync(tmp, wgsl)
  try {
    execFileSync(NAGA, [tmp], { stdio: 'pipe' })
    return { ok: true }
  } catch (e: unknown) {
    const err = e as { stderr?: Buffer; stdout?: Buffer }
    return { ok: false, err: (err.stderr?.toString() || '') + (err.stdout?.toString() || '') }
  }
}

describe('built-in visual library — the low authoring floor', () => {
  it('is re-enabled: non-empty, with the core looks present', () => {
    expect(BUILTIN_VISUAL_WGSL.length).toBeGreaterThan(0)
    const byName = new Map(BUILTIN_VISUAL_WGSL.map(b => [b.name, b.id]))
    // 'solid' is the default a nameless coloured field falls back to — id 0.
    expect(byName.get('solid')).toBe(0)
    for (const name of ['circle', 'glow', 'ring', 'pulse', 'gradient']) {
      expect(byName.has(name), `built-in "${name}" missing`).toBe(true)
    }
  })

  it('every built-in id is unique and below the runtime range (no collision by construction)', () => {
    const ids = BUILTIN_VISUAL_WGSL.map(b => b.id)
    expect(new Set(ids).size).toBe(ids.length)                 // unique
    for (const id of ids) expect(id).toBeLessThan(RUNTIME_VISUAL_ID_BASE)
  })

  it('every built-in actually defines its visual_<name> function (else it would black out the world)', () => {
    for (const b of BUILTIN_VISUAL_WGSL) {
      expect(new RegExp(`fn\\s+visual_${b.name}\\s*\\(`).test(b.wgsl), `${b.name} missing its fn`).toBe(true)
    }
  })

  it.runIf(hasNaga)('the merged uber-shader (built-ins + a runtime visual) compiles on naga', () => {
    // A runtime visual at the real offset id — exactly what the renderer feeds.
    const runtime = [{
      id: RUNTIME_VISUAL_ID_BASE,
      name: 'myfx',
      wgsl: `fn visual_myfx(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {\n  let a = smoothstep(0.5, -0.5, sdf);\n  return vec4f(col.rgb, a * col.a);\n}`,
    }]
    const shader = buildSuperimposedComputeShader(runtime, [], [], 0)
    // Both the built-in 'solid' (id 0) and the runtime 'myfx' (id 100) must
    // survive the dedup and get a dispatch case — neither silently dropped.
    expect(shader).toContain('case 0u: { return visual_solid(')
    expect(shader).toContain(`case ${RUNTIME_VISUAL_ID_BASE}u: { return visual_myfx(`)
    const { ok, err } = nagaValidate(shader)
    expect(ok, err).toBe(true)
  })

  it('documents the hazard the offset avoids: an id that collides with a built-in gets dropped', () => {
    // Simulate the OLD behaviour (runtime ids starting at 0): a runtime visual
    // sharing built-in id 5 ('coin'). "first id wins" drops the runtime one —
    // which is precisely why the runtime range is offset to 100.
    const collidingId = 5
    const runtime = [{
      id: collidingId,
      name: 'ghostfx',
      wgsl: `fn visual_ghostfx(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {\n  return col;\n}`,
    }]
    const shader = buildSuperimposedComputeShader(runtime, [], [], 0)
    expect(shader).not.toContain('visual_ghostfx(uv') // dropped — case never emitted
  })
})
