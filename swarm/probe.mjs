// verify-harness — the per-node EYE. Assemble a minimal world-state and render
// it through the real engine (tools/render-probe.mjs, deno + software WebGPU).
// The probe on this branch binds REAL populations and can run scripted input,
// so a WASD-walking, population-driven 3D world is verifiable — a node is green
// only when this says so.
//
//   import { probe, buildState } from './probe.mjs'
//   const v = await probe(buildState({ modules, visuals, fields, worldData, hooks }), { ticks: 30 })
//   CLI: node swarm/probe.mjs <state.json> [ticks] [inputPreset]

import { writeFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
export const REPO = join(here, '..')

// read a repo wgsl lib (world3-lib, anim3-lib, …) as a module body
export function lib(relPath) {
  return readFileSync(join(REPO, relPath), 'utf8')
}

// assemble a render-core state from parts. hooks: [{id, code}]. visuals/modules:
// [{name, wgsl}]. fields default to one fullscreen screen field per visual.
export function buildState({ modules = [], visuals = [], fields = null, worldData = {}, hooks = [] }) {
  const flds = fields || visuals.map((v, i) => ({
    id: 'f' + i, name: v.name, visualTypeName: v.name,
    transform: { x: 256, y: 256 }, shapeType: 'screen', color: [1, 1, 1, 1],
  }))
  return { modules, visualTypes: visuals, fields: flds, worldData, stepHooks: hooks }
}

// run the probe; return a verdict. input: null | 'auto' | 'run-right' | 'tap-action' | 'sweep-cursor'
export function probe(state, { ticks = 45, input = null, samples = null, out = '/tmp/vf-probe.png' } = {}) {
  const sf = '/tmp/vf-probe-state.json'
  writeFileSync(sf, JSON.stringify(state))
  const args = ['run', '-A', '--unstable-webgpu', join(REPO, 'tools/render-probe.mjs'),
    '--state', sf, '--ticks', String(ticks), '--out', out]
  if (input) args.push('--input', input)
  if (samples) args.push('--samples', String(samples))
  let line
  try {
    const stdout = execFileSync('deno', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    line = stdout.trim().split('\n').filter(Boolean).pop()
  } catch (e) {
    return { ok: false, fatal: String(e.stderr || e.message || e).slice(0, 400) }
  }
  let d = {}
  try { d = JSON.parse(line) } catch { return { ok: false, fatal: 'unparseable probe line: ' + (line || '').slice(0, 200) } }
  const errs = d.errors || []
  const hookErrs = d.hookErrors || []
  const v = {
    ok: !!d.ok && errs.length === 0,
    errors: errs, hookErrors: hookErrs,
    coveragePct: d.coveragePct, meanLum: d.meanLum,
    dominant: (d.dominantColors || []).map(c => c.rgb),
    motion: d.motion ? { moving: d.motion.moving, travel: d.motion.travel, avgFrameDelta: d.motion.avgFrameDelta } : null,
    png: out,
  }
  return v
}

// a tiny formatter for CLI / logs
export function report(name, v, want = {}) {
  const marks = []
  marks.push(v.ok ? '✓ compiles+renders' : '✗ ' + JSON.stringify(v.errors || v.fatal).slice(0, 200))
  if (v.hookErrors && v.hookErrors.length) marks.push('⚠ hookErrors ' + JSON.stringify(v.hookErrors).slice(0, 160))
  if (want.minCoverage != null) marks.push((v.coveragePct >= want.minCoverage ? '✓' : '✗') + ` coverage ${v.coveragePct}% (≥${want.minCoverage})`)
  if (want.moving) marks.push((v.motion && v.motion.moving ? '✓' : '✗') + ` motion ${JSON.stringify(v.motion)}`)
  console.log(`\n[${name}] ${marks.join('  ·  ')}\n  dominant ${JSON.stringify(v.dominant)}  png ${v.png}`)
  return v
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const [sf, ticks, input] = process.argv.slice(2)
  if (!sf) { console.error('usage: node swarm/probe.mjs <state.json> [ticks] [inputPreset]'); process.exit(1) }
  const state = JSON.parse(readFileSync(sf, 'utf8'))
  report(sf, probe(state, { ticks: ticks ? +ticks : 45, input: input || null }))
}
