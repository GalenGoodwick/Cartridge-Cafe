// harness.test — prove the shared driver actually DRIVES the assembled hook, not a
// stub. Every assertion watches real worldData come out of a real frame; this is
// the eye the scene tests inherit. Port of backlog/tests/yard-sim.mjs's intent to
// Node: build → new Function → tick → watch the design/engine state move.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { uvpx, freshSim, tick, sim } from './harness.mjs'

// the diamond the geometry suite proved (designer.test SEQS.diamond) — 6 HULLs.
function diamondTree() {
  const tree = [{ parent: -1, edge: -1, part: 1 }]
  for (const e of [2, 2, 1, 2, 2]) tree.push({ parent: tree.length - 1, edge: e, part: 1 })
  return tree
}

// ── uvpx: the frozen v9 512-square coordinate map ────────────────────────────

test('uvpx: inverse of the v9 px/256-1 mapping (centre, corners)', () => {
  assert.deepEqual(uvpx(0, 0), [256, 256])     // uv centre → canvas centre
  assert.deepEqual(uvpx(1, 1), [512, 512])     // +1 → far edge
  assert.deepEqual(uvpx(-1, -1), [0, 0])       // -1 → near edge
  assert.deepEqual(uvpx(0.5, 0), [384, 256])   // the +0.5 the toUV test uses
})

// ── freshSim: the fake sim's members + rising-edge semantics ─────────────────

test('freshSim: exposes worldData + edge/trigger/getFieldByName/rand', () => {
  const { sim: s, wd } = freshSim()
  assert.equal(s.worldData, wd)
  assert.equal(typeof s.edge, 'function')
  assert.equal(typeof s.trigger, 'function')
  assert.equal(typeof s.getFieldByName, 'function')
  assert.equal(typeof s.rand, 'function')
  assert.equal(s.getFieldByName('x'), null)
  assert.ok(s.rand() >= 0 && s.rand() < 1)
})

test('freshSim: edge() fires only on the RISING edge of an id', () => {
  const { sim: s } = freshSim()
  assert.equal(s.edge('a', false), false)  // low
  assert.equal(s.edge('a', true), true)    // rising → fires once
  assert.equal(s.edge('a', true), false)   // held high → silent
  assert.equal(s.edge('a', false), false)  // falling
  assert.equal(s.edge('a', true), true)    // rises again → fires
  // ids are independent
  assert.equal(s.edge('b', true), true)
})

test('freshSim: seed pre-fills worldData; two worlds are isolated', () => {
  const A = freshSim({ __scene: 'designer', tag: 1 })
  const B = freshSim({ tag: 2 })
  assert.equal(A.wd.__scene, 'designer')
  assert.equal(A.wd.tag, 1)
  assert.equal(B.wd.tag, 2)
  A.wd.mutated = true
  assert.equal(B.wd.mutated, undefined, 'worlds must not share state')
  assert.notEqual(A.fn, B.fn, 'each world binds its own hook Function')
})

// ── tick: drives a REAL frame of the assembled hook ──────────────────────────

test('tick: a menu frame flushes population + 16 uniforms, no hook error', () => {
  const { tick: t, wd } = freshSim()
  t(...uvpx(0, 0), false)
  assert.equal(wd.__hookError, undefined, 'hook threw: ' + wd.__hookError)
  assert.ok(Array.isArray(wd.gpuPopulation), 'no gpuPopulation flushed')
  assert.ok(Array.isArray(wd.gpuUniforms) && wd.gpuUniforms.length >= 16, 'uniforms not published')
  assert.ok(wd.gpuUniforms[0] > 0, 'uni[0] (time) did not advance')
})

test('tick: sets BOTH pointer channels (mouse_* and input.pointer)', () => {
  const { tick: t, wd } = freshSim()
  t(384, 128, true)
  assert.equal(wd.mouse_x, 384)
  assert.equal(wd.mouse_y, 128)
  assert.equal(wd.mouse_down, true)
  assert.deepEqual(wd.input.pointer, { x: 384, y: 128, down: true })
})

test('tick: pointer uv reaches the hook — 512² maps px/256-1, +y up', () => {
  const { tick: t, wd } = freshSim({ width: 512, height: 512 })
  t(...uvpx(0.5, 0), true)          // px 384 → uv +0.5 ; centre y → 0... use offset
  // uvpx(0.5,0) = [384,256]; on a 512 canvas toUV → x=+0.5, y=0
  assert.equal(wd.__hookError, undefined)
  assert.ok(Math.abs(wd.gpuUniforms[8] - 0.5) < 1e-6, 'pointer x uv wrong: ' + wd.gpuUniforms[8])
  assert.ok(Math.abs(wd.gpuUniforms[9] - 0) < 1e-6, 'pointer y uv wrong: ' + wd.gpuUniforms[9])
  assert.equal(wd.gpuUniforms[10], 1, 'pointer-down not published')
})

// ── the eye: tick drives a REAL scene hook (foundations inlined + wired) ──────

test('tick: drives the DESIGNER scene — inlined geometry seals the diamond', () => {
  const { tick: t, wd } = freshSim({ __scene: 'designer', __D: { tree: diamondTree(), sel: 0, flash: 0, slot: 0 } })
  t(...uvpx(0.24, 0), false)
  assert.equal(wd.__hookError, undefined, 'designer hook threw: ' + wd.__hookError)
  const D = wd.__D
  // holes()/classify() ran INSIDE the assembled hook (proves geometry inlined)
  assert.ok(D.sealed && D.sealed.diamond === 1, 'diamond not sealed: ' + JSON.stringify(D.sealed))
  assert.equal(D.payout.hpMul, 1.15, 'diamond payout not applied through the hook')
  // statOf() ran (parts inlined): 6 HULLs → 60 base HP ×1.15 = 69
  assert.equal(D.stats.hp, Math.round(60 * 1.15), 'HP payout not reflected in stats')
  assert.ok(wd.gpuPopulation.length >= 4, 'designer pushed no entities')
})

test('tick: repeated frames advance time monotonically (a real loop)', () => {
  const { tick: t, wd } = freshSim()
  t(...uvpx(0, 0), false)
  const t1 = wd.gpuUniforms[0]
  t(...uvpx(0, 0), false)
  const t2 = wd.gpuUniforms[0]
  assert.ok(t2 > t1, 'time did not advance across frames')
})

// ── the default shared world (yard-sim.mjs module-level shape) ───────────────

test('default tick/sim: the module-level driver runs a frame too', () => {
  const wd = tick(...uvpx(0, 0), false)
  assert.equal(wd.__hookError, undefined)
  assert.ok(Array.isArray(wd.gpuPopulation))
  assert.equal(sim.worldData, wd, 'default sim points at the default world')
})
