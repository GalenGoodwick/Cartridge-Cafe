// flight-fixes — bugs from Jul 31 playtesting:
//  1. massProps().m (typo for .M) always undefined → mass0 defaulted to 1,
//     so armor/mounts never weighed the ship down (no accel/turn penalty).
//  2. waypoint-consumption tolerance (0.9) exceeded the resample spacing
//     (0.4-0.5) — a short/close-up route could be entirely "within 0.9" of
//     the start, so it reported arrival almost immediately, barely moving.
//  3. plumes drew each thruster's own design-rotation exhaust direction, but
//     the arcade model ignores orientation for movement — so a sideways-
//     mounted engine still drove the ship forward while its plume fired
//     sideways ("thrusters shoot the wrong way").
//  4. the waypoint walker tracked a STORED monotonic "consumed up to here"
//     index; if the ship overshot a turn and swung wide, the index never
//     re-anchored, so the lookahead search (forward-only from a stale index)
//     aimed behind the ship's real position — a ~90°-bearing (sideways)
//     destination click orbited FOREVER instead of arriving.
// Run: node --test pentarch/test/flight-fixes.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const hookSrc = readFileSync(new URL('../base/hook.js', import.meta.url), 'utf8')
const mk = () => {
  const sim = { worldData: {}, __e: {}, edge(k, v) { const w = !!this.__e[k]; this.__e[k] = !!v; return !!v && !w } }
  const hook = new Function('sim', 'dt', hookSrc)
  return { sim, tick: (n = 1) => { for (let i = 0; i < n; i++) hook(sim, 1 / 60) } }
}
const ship = (parts) => {
  const c = mk(); c.tick(3); const d = c.sim.worldData.__pd
  for (const p of parts) d.tree.push(p)
  d.rev++; c.tick(2)
  c.sim.worldData.key_b = true; c.tick(); c.sim.worldData.key_b = false; c.tick(); c.tick(3)
  return { ...c, d: () => d, B: () => d.bt }
}
const clickWorld = (s, wx, wy) => {
  const BS = s.d().bzoom || 0.055
  s.sim.worldData.mouse_x = (wx * BS + 1) * 256; s.sim.worldData.mouse_y = (wy * BS + 1) * 256
  s.sim.worldData.mouse_down = true; s.tick(); s.sim.worldData.mouse_down = false; s.tick()
}

test('armor weighs the ship down: lower accel/vmax/turn than a bare engine hull', () => {
  const bare = ship([{ parent: 0, edge: 2, part: 4 }])
  const armored = ship([{ parent: 0, edge: 2, part: 4 }, { parent: 0, edge: 0, part: 2 }, { parent: 0, edge: 1, part: 2 }])
  assert.ok(armored.B().ARC.acc < bare.B().ARC.acc, 'armor lowers accel')
  assert.ok(armored.B().ARC.vmax < bare.B().ARC.vmax, 'armor lowers vmax')
  assert.ok(armored.B().ARC.turn < bare.B().ARC.turn, 'armor slows turning')
})

test('a close-up (short) route actually reaches its target instead of arriving instantly', () => {
  const s = ship([{ parent: 0, edge: 2, part: 4 }])
  clickWorld(s, 0, -1)                                      // 1 world-unit hop
  for (let i = 0; i < 200 && s.B().route; i++) s.tick()
  assert.ok(Math.abs(s.B().fly.y - -1) < 0.9, `landed near the 1-unit target (y=${s.B().fly.y.toFixed(2)})`)
})

test('a long route still arrives cleanly (the tighter tolerance did not break far travel)', () => {
  const s = ship([{ parent: 0, edge: 2, part: 4 }])
  clickWorld(s, 0, -8)
  for (let i = 0; i < 600 && s.B().route; i++) s.tick()
  assert.equal(s.B().route, null, 'route completed')
  assert.ok(Math.abs(s.B().fly.y - -8) < 0.95, `landed near the 8-unit target (y=${s.B().fly.y.toFixed(2)})`)
})

test('plume exhaust direction matches the ACTUAL push, not the tile\'s own design rotation', () => {
  // an engine mounted SIDEWAYS (o rotated) — arcade model still drives it
  // straight up regardless, so the plume must point opposite that travel
  // direction, not opposite the tile's own o-derived nozzle facing.
  const s = ship([{ parent: 0, edge: 2, part: 4, o: 2 }])   // rotated engine
  const d = s.d()
  s.sim.worldData.key_w = true; s.tick(3); s.sim.worldData.key_w = false
  const pop = s.sim.worldData.gpuPopulation
  const plumes = []
  for (let e = 0; e < pop.length; e += 4) { const kind = Math.floor(pop[e + 3]) % 100; if (kind === 56) plumes.push({ ang: pop[e + 2] }) }
  assert.ok(plumes.length > 0, 'a plume is drawn while thrusting')
  // ship faces up (fly.th=-π/2) and is driving forward → exhaust should point
  // DOWN (world angle ≈ +π/2), regardless of the tile's own rotated o
  for (const p of plumes) {
    const err = Math.abs(Math.atan2(Math.sin(p.ang - Math.PI / 2), Math.cos(p.ang - Math.PI / 2)))
    assert.ok(err < 0.35, `plume angle ${p.ang.toFixed(2)} points opposite travel (down, ≈1.57)`)
  }
})

test('a sideways (~90° bearing) destination click actually arrives, not orbits forever', () => {
  const s = ship([{ parent: 0, edge: 2, part: 4 }, { parent: 0, edge: 0, part: 6 }])   // engine + jet
  clickWorld(s, 5, 0)                                       // ship spawns facing up; this target is due sideways
  for (let i = 0; i < 800 && s.B().route; i++) s.tick()
  assert.equal(s.B().route, null, 'route completed (did not orbit)')
  assert.ok(Math.hypot(s.B().fly.x - 5, s.B().fly.y - 0) < 0.95, `landed near the sideways target (${s.B().fly.x.toFixed(2)},${s.B().fly.y.toFixed(2)})`)
})

test('destination-click arrives cleanly across a spread of distances (very close to far)', () => {
  // arrival radius is ~0.85 (core-overlap law, Jul 31: "destination overlap
  // with core and proper facing is enough") — a target already inside that
  // radius counts as arrived immediately, by design.
  for (const [tx, ty] of [[0, -0.5], [0, -1], [2, -2], [-6, -8]]) {
    const s = ship([{ parent: 0, edge: 2, part: 4 }, { parent: 0, edge: 0, part: 6 }])
    clickWorld(s, tx, ty)
    for (let i = 0; i < 800 && s.B().route; i++) s.tick()
    assert.equal(s.B().route, null, `route completed for target (${tx},${ty})`)
    assert.ok(Math.hypot(s.B().fly.x - tx, s.B().fly.y - ty) < 0.9, `landed near (${tx},${ty}), got (${s.B().fly.x.toFixed(2)},${s.B().fly.y.toFixed(2)})`)
  }
})

test('arrival is a HARD STOP — no coasting/overshoot past the destination', () => {
  const s = ship([{ parent: 0, edge: 2, part: 4 }, { parent: 0, edge: 0, part: 6 }])
  clickWorld(s, 0, -6)
  for (let i = 0; i < 800 && s.B().route; i++) s.tick()
  assert.equal(s.B().route, null, 'route completed')
  assert.equal(s.B().fly.v, 0, 'velocity zeroed on arrival, not left coasting')
  s.tick(30)                                                // give it half a second to drift, if it could
  assert.ok(Math.hypot(s.B().fly.x - 0, s.B().fly.y - -6) < 0.9, 'stayed put after arrival, did not drift on')
})
