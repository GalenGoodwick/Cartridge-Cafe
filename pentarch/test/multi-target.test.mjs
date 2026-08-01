// multi-target — task #7's lighter slice (Jul 31): a small drone squadron
// (TARGET_N=3) lives on the battlefield at once instead of one respawning
// dummy. Killing one keeps the squadron at full strength (a fresh one spawns
// further out); weapons and collision both search across EVERY live target,
// not just a single tracked one.
// Run: node --test pentarch/test/multi-target.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const hookSrc = readFileSync(new URL('../base/hook.js', import.meta.url), 'utf8')
const ship = (parts) => {
  const sim = { worldData: {}, __e: {}, edge(k, v) { const w = !!this.__e[k]; this.__e[k] = !!v; return !!v && !w } }
  const hook = new Function('sim', 'dt', hookSrc)
  const tick = (n = 1) => { for (let i = 0; i < n; i++) hook(sim, 1 / 60) }
  tick(3); const d = sim.worldData.__pd
  for (const p of parts) d.tree.push(p)
  d.rev++; tick(2)
  sim.worldData.key_b = true; tick(); sim.worldData.key_b = false; tick(); tick(3)
  return { sim, tick, d, B: () => d.bt }
}

test('the battlefield keeps 3 hostiles alive at once', () => {
  const s = ship([{ parent: 0, edge: 2, part: 4 }])
  assert.equal(s.B().targets.length, 3)
  const positions = new Set(s.B().targets.map(t => t.x.toFixed(1) + ',' + t.y.toFixed(1)))
  assert.equal(positions.size, 3, 'three DISTINCT positions, not the same target three times')
})

test('killing one hostile respawns a fresh one — squadron strength is maintained', () => {
  const s = ship([{ parent: 0, edge: 2, part: 4 }]); const B = s.B()
  const victim = B.targets[0]
  for (let i = 0; i < victim.tileHp.length; i++) victim.tileHp[i] = 0
  s.tick(2)
  assert.equal(B.targets.length, 3, 'squadron back to 3')
  assert.ok(B.kills >= 1, 'the kill was counted')
  assert.ok(!B.targets.includes(victim), 'the dead one is gone, not lingering at 0 hp')
})

test('collision detects contact against ANY of the live targets, not just targets[0]', () => {
  const s = ship([{ parent: 0, edge: 2, part: 4 }]); const B = s.B()
  // place the SECOND target (not [0]) right on top of the ship
  B.targets[1].x = B.fly.x; B.targets[1].y = B.fly.y
  const hpBefore = B.targets[1].tileHp.reduce((a, b) => a + b, 0)
  s.tick(3)
  const hpAfter = B.targets[1].tileHp.reduce((a, b) => a + b, 0)
  assert.ok(hpAfter < hpBefore, 'the non-primary target took collision damage too')
})

test('drawn population includes tiles from every live target', () => {
  const s = ship([{ parent: 0, edge: 2, part: 4 }]); const B = s.B()
  s.tick(1)
  const pop = s.sim.worldData.gpuPopulation
  // rough sanity: population is non-trivial (core + engine + 3 targets' tiles + effects)
  assert.ok(pop.length / 4 > 1 + B.targets.reduce((a, tg) => a + tg.tiles.length, 0) * 0.5, 'population reflects multiple hulls, not just one')
})
