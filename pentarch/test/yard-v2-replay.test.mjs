// yard-v2-replay — drive the LIVE hook (base/hook.js) through a fake sim and
// verify the v2 ship systems end-to-end: variant cycling, T-rotation,
// envelope HUD, and battle-mode route flight. The hook-replay technique that
// has caught every designer regression so far.
// Run: node --test pentarch/test/yard-v2-replay.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const hookSrc = readFileSync(new URL('../base/hook.js', import.meta.url), 'utf8')
const hook = new Function('sim', 'dt', hookSrc)

const mkSim = () => ({
  worldData: {},
  __e: {},
  edge(k, v) { const was = !!this.__e[k]; this.__e[k] = !!v; return !!v && !was },
})
const tick = (sim, n = 1) => { for (let i = 0; i < n; i++) hook(sim, 1 / 60) }
// uv → engine mouse coords (uv = m/256 - 1)
const mouseAt = (sim, ux, uy) => { sim.worldData.mouse_x = (ux + 1) * 256; sim.worldData.mouse_y = (uy + 1) * 256 }
const clickAt = (sim, ux, uy) => { mouseAt(sim, ux, uy); sim.worldData.mouse_down = true; tick(sim); sim.worldData.mouse_down = false; tick(sim) }
const palette = (sim, slot) => clickAt(sim, -0.52 + slot * 0.26, 0.86)
const hud = (sim, id) => (sim.worldData.hud || []).find(h => h.id === id)
// tile 0 is the CORE/HELM (unique, not a slot) — tests grow tile 1 for parts
const addTile = (sim, part = 0) => { const D = sim.worldData.__pd; D.tree.push({ parent: 0, edge: 2, part }); D.sel = D.tree.length - 1; D.rev++; tick(sim, 2) }

test('boot: one tick builds the yard (root tile, HUD, no throw)', () => {
  const sim = mkSim()
  tick(sim, 2)
  const D = sim.worldData.__pd
  assert.ok(D && D.tree.length === 1)
  assert.ok(hud(sim, 'yt'), 'shipyard title present')
  assert.ok(hud(sim, 'yv2'), 'V2 FLIGHT/POWER HUD row present')
})

test('palette slot 3 (DRIVE) cycles ENGINE → JET → GYRO → ENGINE on the selected tile', () => {
  const sim = mkSim()
  tick(sim, 2)
  addTile(sim)                             // parts live on grown tiles, not the HELM
  palette(sim, 3); assert.equal(sim.worldData.__pd.tree[1].part, 4, 'first click sets ENGINE')
  palette(sim, 3); assert.equal(sim.worldData.__pd.tree[1].part, 6, 'second click cycles to JET')
  palette(sim, 3); assert.equal(sim.worldData.__pd.tree[1].part, 7, 'third → GYRO')
  palette(sim, 3); assert.equal(sim.worldData.__pd.tree[1].part, 4, 'wraps to ENGINE')
})

test('palette slot 4 (POWER) cycles GEN → BATTERY; slot 2 (GUNS) cycles GUN → FIXED', () => {
  const sim = mkSim()
  tick(sim, 2)
  addTile(sim)
  palette(sim, 4); assert.equal(sim.worldData.__pd.tree[1].part, 5)
  palette(sim, 4); assert.equal(sim.worldData.__pd.tree[1].part, 8, 'GEN → BATTERY')
  palette(sim, 2); assert.equal(sim.worldData.__pd.tree[1].part, 3, 'different slot sets its base')
  palette(sim, 2); assert.equal(sim.worldData.__pd.tree[1].part, 9, 'GUN → FIXED')
})

test('T rotates an orientable part through 5 facings (and ignores non-orientable)', () => {
  const sim = mkSim()
  tick(sim, 2)
  addTile(sim)
  palette(sim, 3)                          // ENGINE (orientable)
  const press = () => { sim.worldData.key_t = true; tick(sim); sim.worldData.key_t = false; tick(sim) }
  press(); assert.equal(sim.worldData.__pd.tree[1].o, 1)
  press(); press(); press(); press()
  assert.equal(sim.worldData.__pd.tree[1].o, 0, 'five presses wrap around')
  palette(sim, 0)                          // HULL (not orientable)
  press()
  assert.equal(sim.worldData.__pd.tree[1].o || 0, 0, 'hull does not rotate')
})

test('rotation changes the LIVE envelope readout (orientation is destiny, on screen)', () => {
  const sim = mkSim()
  tick(sim, 2)
  addTile(sim)
  palette(sim, 3)                          // engine on tile 1
  tick(sim, 2)
  const rows = []
  for (let k = 0; k < 5; k++) {
    rows.push(hud(sim, 'yv2').text)
    sim.worldData.key_t = true; tick(sim); sim.worldData.key_t = false; tick(sim, 2)
  }
  assert.ok(new Set(rows).size >= 2, 'at least two distinct envelope readouts across facings: ' + rows[0])
})

test('BATTLE: tap commands a route and the ship actually flies toward it', () => {
  const sim = mkSim()
  tick(sim, 2)
  addTile(sim)
  palette(sim, 3)                          // give the hull an engine so it can move
  // point the NOZZLE backward (o=1 → normal 198°) so thrust goes +x — rocket
  // convention: engines push AWAY from the edge their nozzle sits on.
  sim.worldData.key_t = true; tick(sim); sim.worldData.key_t = false; tick(sim)
  sim.worldData.key_b = true; tick(sim); sim.worldData.key_b = false; tick(sim)
  const D = sim.worldData.__pd
  assert.equal(D.mode, 'battle')
  // tap at world ~(+4, 0): uv 0.56 → mouse (400, 256)
  clickAt(sim, 0.56, 0)
  assert.ok(D.bt.route, 'a route was planned from the tap')
  assert.ok(D.bt.route.points.length > 2)
  const x0 = D.bt.fly.x
  tick(sim, 300)                           // 5 sim-seconds of flight
  assert.ok(D.bt.fly.x > x0 + 0.3, `moved toward the target (Δx=${(D.bt.fly.x - x0).toFixed(2)})`)
  assert.ok(hud(sim, 'btv').text.includes('SPD'), 'flight HUD live')
})

test('BATTLE: hold + drag draws a multi-point route (the wish becomes a plan)', () => {
  const sim = mkSim()
  tick(sim, 2)
  addTile(sim)
  palette(sim, 3)
  sim.worldData.key_b = true; tick(sim); sim.worldData.key_b = false; tick(sim)
  const D = sim.worldData.__pd
  sim.worldData.mouse_down = true
  for (const [ux, uy] of [[0.2, 0], [0.35, 0.1], [0.5, 0.2], [0.6, 0.1]]) { mouseAt(sim, ux, uy); tick(sim, 3) }
  sim.worldData.mouse_down = false; tick(sim)
  assert.ok(D.bt.route, 'route from the drawn path')
  assert.ok(D.bt.route.points.length >= 4, 'multi-point plan')
  assert.ok(Number.isFinite(D.bt.route.eta) && D.bt.route.eta > 0, 'honest ETA')
})

test('battle state survives a yard round-trip; editing the ship resets flight', () => {
  const sim = mkSim()
  tick(sim, 2)
  addTile(sim)
  palette(sim, 3)
  sim.worldData.key_b = true; tick(sim); sim.worldData.key_b = false; tick(sim)
  const D = sim.worldData.__pd
  sim.worldData.key_b = true; tick(sim); sim.worldData.key_b = false; tick(sim)
  assert.equal(D.mode, 'design')
  // change the part (psig change) then re-enter: fresh flight state
  palette(sim, 4)
  sim.worldData.key_b = true; tick(sim); sim.worldData.key_b = false; tick(sim)
  assert.equal(D.mode, 'battle')
  assert.ok(D.bt.psig.includes('5:'), 'battle rebuilt against the edited ship')
})
