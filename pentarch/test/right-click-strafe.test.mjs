// right-click-strafe — task #8 (Jul 31): right-click a point commands a
// STRAFE RUN — the ship moves there while holding its CURRENT heading (guns
// stay trained on whatever it already faced), unlike left-click's route which
// turns to face travel direction. Needed engine-side mouse_down_right,
// exposed additively in FieldEngine.tsx (mouse_down's existing behavior is
// untouched — zero risk to other worlds) and render-core.mjs's synthetic
// input (pointer.button:"right").
// Run: node --test pentarch/test/right-click-strafe.test.mjs
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
const rightClickWorld = (s, wx, wy) => {
  const BS = s.d.bzoom || 0.055
  s.sim.worldData.mouse_x = (wx * BS + 1) * 256; s.sim.worldData.mouse_y = (wy * BS + 1) * 256
  s.sim.worldData.mouse_down_right = true; s.tick(); s.sim.worldData.mouse_down_right = false; s.tick()
}

const leftClickWorld = (s, wx, wy) => {
  const BS = s.d.bzoom || 0.055
  s.sim.worldData.mouse_x = (wx * BS + 1) * 256; s.sim.worldData.mouse_y = (wy * BS + 1) * 256
  s.sim.worldData.mouse_down = true; s.tick(); s.sim.worldData.mouse_down = false; s.tick()
}

test('right-click sets a strafe target and cancels any active route', () => {
  const s = ship([{ parent: 0, edge: 2, part: 4 }, { parent: 0, edge: 0, part: 6 }])
  const B = s.B()
  leftClickWorld(s, 1, 1)                                   // a REAL active route
  assert.ok(B.route, 'route was actually set up')
  rightClickWorld(s, 5, 0)
  assert.ok(B.strafeTarget, 'strafe target set')
  assert.equal(B.route, null, 'active route cancelled by the right-click')
})

test('a strafe run to a SIDEWAYS point never turns the ship (heading holds)', () => {
  const s = ship([{ parent: 0, edge: 2, part: 4 }, { parent: 0, edge: 0, part: 6 }])
  const B = s.B()
  const th0 = B.fly.th
  rightClickWorld(s, 5, 0)                                  // due sideways from a ship facing up
  let maxDrift = 0
  for (let i = 0; i < 600 && B.strafeTarget; i++) { s.tick(); maxDrift = Math.max(maxDrift, Math.abs(B.fly.th - th0)) }
  assert.ok(maxDrift < 0.01, `heading never drifted during the strafe run (max ${maxDrift.toFixed(4)})`)
})

test('the strafe run arrives (core-overlap) and hard-stops, target cleared', () => {
  const s = ship([{ parent: 0, edge: 2, part: 4 }, { parent: 0, edge: 0, part: 6 }])
  const B = s.B()
  rightClickWorld(s, 5, 0)
  for (let i = 0; i < 600 && B.strafeTarget; i++) s.tick()
  assert.equal(B.strafeTarget, null, 'strafe target cleared on arrival')
  assert.equal(B.fly.v, 0, 'velocity hard-stopped, not left coasting')
  assert.ok(Math.hypot(B.fly.x - 5, B.fly.y - 0) < 0.9, `landed near the strafe target (${B.fly.x.toFixed(2)},${B.fly.y.toFixed(2)})`)
})

test('a left-click route cancels an active strafe target (the two modes are exclusive)', () => {
  const s = ship([{ parent: 0, edge: 2, part: 4 }, { parent: 0, edge: 0, part: 6 }])
  const B = s.B()
  B.strafeTarget = { x: 9, y: 9 }
  const BS = s.d.bzoom || 0.055
  s.sim.worldData.mouse_x = (2 * BS + 1) * 256; s.sim.worldData.mouse_y = (2 * BS + 1) * 256
  s.sim.worldData.mouse_down = true; s.tick()
  assert.equal(B.strafeTarget, null, 'left-click press cancels the strafe target immediately')
  s.sim.worldData.mouse_down = false; s.tick()
})

test('WASD hand-flying overrides and clears an active strafe target', () => {
  const s = ship([{ parent: 0, edge: 2, part: 4 }, { parent: 0, edge: 0, part: 6 }])
  const B = s.B()
  rightClickWorld(s, 5, 0)
  assert.ok(B.strafeTarget)
  s.sim.worldData.key_w = true; s.tick()
  assert.equal(B.strafeTarget, null, 'W overrides the strafe run')
  s.sim.worldData.key_w = false
})
