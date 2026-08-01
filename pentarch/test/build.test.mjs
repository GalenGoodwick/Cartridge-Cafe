// build.test — the ASSEMBLER's eye. We do not trust that the strings concatenate;
// we BUILD the hook, wrap it the way the engine does (`new Function('sim','dt',…)`),
// run it against a fake sim, and watch real state come out. A green here proves:
//   • no import/export leaked into the Function body (it constructs at all),
//   • the foundations inlined correctly (geometry/parts/chrome are in scope),
//   • the DISPATCH wired the scene modules (designer's SRC actually ran),
//   • POP flushes to gpuPopulation and uniforms publish,
//   • a not-yet-built scene degrades instead of throwing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layout } from '../penta-core.mjs'
import { assembleHook, assembleVisual } from '../build.mjs'

// A minimal engine stand-in: worldData + a rising-edge tracker (CONTRACT §7).
function makeSim() {
  const wd = {}
  const edges = {}
  const sim = {
    worldData: wd,
    edge(id, c) { const was = !!edges[id]; edges[id] = !!c; return !!c && !was },
    trigger() {},
    rand: Math.random,
    getFieldByName() { return null },
  }
  return { wd, sim }
}

// Build the hook ONCE, hand back a fresh (sim, run(dt)) each time.
async function harness() {
  const hook = await assembleHook()
  const fn = new Function('sim', 'dt', hook)   // throws if import/export leaked
  const { wd, sim } = makeSim()
  const run = (dt = 1 / 30) => fn(sim, dt)
  return { hook, wd, sim, run }
}

// the diamond design the geometry suite proved (designer.test SEQS.diamond)
function diamondTree() {
  const tree = [{ parent: -1, edge: -1, part: 1 }]
  for (const e of [2, 2, 1, 2, 2]) tree.push({ parent: tree.length - 1, edge: e, part: 1 })
  return tree
}

test('assembleHook: constructs as a Function body (no import/export leaked)', async () => {
  const hook = await assembleHook()
  assert.equal(typeof hook, 'string')
  assert.ok(hook.length > 2000, 'hook looks too small to hold the foundations')
  // no bare ES module syntax may survive into the body
  assert.doesNotMatch(hook, /^\s*import\s/m, 'an import line leaked into the hook')
  assert.doesNotMatch(hook, /^\s*export\s/m, 'an export keyword leaked into the hook')
  assert.doesNotThrow(() => new Function('sim', 'dt', hook))
})

test('PRELUDE inlined the foundations (geometry + parts + chrome + runtime)', async () => {
  const hook = await assembleHook()
  assert.match(hook, /function layout\(/, 'geometry (layout) not inlined')
  assert.match(hook, /function holes\(/, 'geometry (holes) not inlined')
  assert.match(hook, /const PARTS =/, 'parts table not inlined')
  assert.match(hook, /function statOf\(/, 'parts (statOf) not inlined')
  assert.match(hook, /function topBar\(/, 'chrome (topBar) not inlined')
  assert.match(hook, /function pushEnt\(/, 'runtime (pushEnt) not defined')
  assert.match(hook, /function toUV\(/, 'runtime (toUV) not defined')
})

test('DISPATCH wires every scene branch', async () => {
  const hook = await assembleHook()
  for (const sc of ['designer', 'finder', 'lobby', 'battle', 'debrief']) {
    assert.ok(hook.includes(`SC === '${sc}'`), `missing scene branch: ${sc}`)
  }
  assert.match(hook, /else \{/, 'missing the menu fall-through')
})

test('runs clean in the menu scene: flushes population + 16 uniforms', async () => {
  const { wd, run } = await harness()
  wd.mouse_x = 300; wd.mouse_y = 200; wd.mouse_down = false
  run()
  assert.equal(wd.__hookError, undefined, 'hook threw: ' + wd.__hookError)
  assert.ok(Array.isArray(wd.gpuPopulation), 'no gpuPopulation flushed')
  assert.ok(Array.isArray(wd.gpuUniforms) && wd.gpuUniforms.length >= 16, 'uniforms not published')
  assert.ok(wd.gpuUniforms[0] > 0, 'uni[0] (time) did not advance')
})

test('toUV: 512² canvas reduces to the v9 mapping (px/256-1), +y up', async () => {
  // drive the pointer uniform through the built hook and read it back.
  const { wd, run } = await harness()
  wd.width = 512; wd.height = 512
  wd.input = { pointer: { x: 384, y: 128, down: true } }   // 384/256-1 = +0.5 ; y up: -(128-256)/256 = +0.5
  run()
  assert.equal(wd.__hookError, undefined)
  assert.ok(Math.abs(wd.gpuUniforms[8] - 0.5) < 1e-6, 'pointer x uv wrong: ' + wd.gpuUniforms[8])
  assert.ok(Math.abs(wd.gpuUniforms[9] - 0.5) < 1e-6, 'pointer y uv (should be +y up) wrong: ' + wd.gpuUniforms[9])
  assert.equal(wd.gpuUniforms[10], 1, 'pointer-down not set')
})

test('DESIGNER scene: the inlined geometry + parts drive mod-designer through the assembler', async () => {
  const { wd, run } = await harness()
  wd.__scene = 'designer'
  wd.__D = { tree: diamondTree(), sel: 0, flash: 0, slot: 0 }
  run()
  assert.equal(wd.__hookError, undefined, 'designer hook threw: ' + wd.__hookError)
  const D = wd.__D
  // F.grammar ran: the diamond sealed (geometry holes()/classify() worked inlined)
  assert.ok(D.sealed && D.sealed.diamond === 1, 'diamond not sealed: ' + JSON.stringify(D.sealed))
  assert.equal(D.payout.hpMul, 1.15, 'diamond payout not applied')
  // F.stats ran AFTER F.grammar and applied the payout (statOf inlined from parts)
  // 6 HULLs → base HP 60, ×1.15 = 69
  assert.ok(D.stats, 'stats not computed')
  assert.equal(D.stats.hp, Math.round(60 * 1.15), 'HP payout not applied in stats')
  assert.equal(D.stats.cost, 60, 'six HULLs cost 60')
  // it drew the live stat card via chrome (a panel entity, code 320)
  assert.ok(wd.gpuPopulation.length >= 4, 'designer pushed no entities')
})

test('DESIGNER scene: a freshly sealed diamond flashes (uni 11) and rings', async () => {
  const { wd, run } = await harness()
  wd.__scene = 'designer'
  wd.__D = { tree: diamondTree(), sel: 0, flash: 0, slot: 0 }
  run()
  assert.equal(wd.__hookError, undefined)
  assert.ok(wd.gpuUniforms[11] > 0, 'no placement flash on a new seal')
  assert.ok(wd.__play_sound, 'no seal fanfare')
})

test('an unbuilt scene (battle) degrades — no throw, still publishes', async () => {
  const { wd, run } = await harness()
  wd.__scene = 'battle'      // mod-battle not built yet ⇒ empty fragment
  run()
  assert.equal(wd.__hookError, undefined, 'unbuilt scene threw: ' + wd.__hookError)
  assert.ok(Array.isArray(wd.gpuPopulation), 'no population even when scene empty')
})

test('assembleVisual: emits visual_pentarch + the shared chrome WGSL', () => {
  const wgsl = assembleVisual()
  assert.match(wgsl, /fn\s+visual_pentarch\s*\(/, 'no visual_pentarch')
  assert.match(wgsl, /fn\s+ch_panel\s*\(/, 'chrome WGSL primitives not pasted in')
})
