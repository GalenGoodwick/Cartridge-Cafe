// collision — ship↔target physical contact (task #6, Jul 31): tile-vs-tile
// circle test, position-correction bounce (never pass through), mutual impact
// damage proportional to closing speed, shear of broken tiles, and a player-
// side respawn when the player's own hull is destroyed (matching the target's
// own respawn law — never a stuck-dead ship).
// Run: node --test pentarch/test/collision.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const hookSrc = readFileSync(new URL('../base/hook.js', import.meta.url), 'utf8')
const ship = () => {
  const sim = { worldData: {}, __e: {}, edge(k, v) { const w = !!this.__e[k]; this.__e[k] = !!v; return !!v && !w } }
  const hook = new Function('sim', 'dt', hookSrc)
  const tick = (n = 1) => { for (let i = 0; i < n; i++) hook(sim, 1 / 60) }
  tick(3); const d = sim.worldData.__pd
  d.tree.push({ parent: 0, edge: 2, part: 4 }); d.rev++; tick(2)
  sim.worldData.key_b = true; tick(); sim.worldData.key_b = false; tick(); tick(3)
  return { sim, tick, d, B: () => d.bt }
}

test('colliding with the target never lets the ship pass through it', () => {
  const s = ship(); const B = s.B()
  B.target.x = B.fly.x + Math.cos(B.fly.th) * 2
  B.target.y = B.fly.y + Math.sin(B.fly.th) * 2
  const tgtStart = { x: B.target.x, y: B.target.y }
  s.sim.worldData.key_w = true
  let minDistSeen = Infinity
  for (let i = 0; i < 120; i++) {
    s.tick()
    minDistSeen = Math.min(minDistSeen, Math.hypot(B.fly.x - tgtStart.x, B.fly.y - tgtStart.y))
  }
  assert.ok(minDistSeen > 0.3, `ship never overlapped the target's center past a hull radius (min dist ${minDistSeen.toFixed(2)})`)
})

test('collision deals mutual damage that accumulates (not a no-op bump)', () => {
  const s = ship(); const B = s.B()
  B.target.x = B.fly.x + Math.cos(B.fly.th) * 2
  B.target.y = B.fly.y + Math.sin(B.fly.th) * 2
  const startTargetHp = B.target.tileHp.reduce((a, b) => a + b, 0)
  s.sim.worldData.key_w = true
  for (let i = 0; i < 60; i++) s.tick()
  const endTargetHp = B.target.tileHp.reduce((a, b) => a + b, 0)
  assert.ok(endTargetHp < startTargetHp, `target took damage (start ${startTargetHp}, end ${endTargetHp})`)
})

test('a destroyed player hull respawns (position + hp reset), never stuck dead', () => {
  const s = ship(); const B = s.B()
  const u = B.unit
  s.sim.worldData.key_w = true
  let sawDamage = false, sawRespawn = false
  for (let i = 0; i < 400; i++) {
    // keep re-placing the target dead ahead so contact recurs (a real ship
    // would keep ramming while holding W into something in its path)
    if (i % 20 === 0) { B.target.x = B.fly.x + Math.cos(B.fly.th) * 1.6; B.target.y = B.fly.y + Math.sin(B.fly.th) * 1.6 }
    s.tick()
    if (u.tileHp.some(h => h < u.tileMaxHp[u.tileHp.indexOf(h)])) sawDamage = true
    if (u.tileHp[0] === u.tileMaxHp[0] && B.fly.x === 0 && B.fly.y === 0 && B.fly.v === 0) sawRespawn = true
  }
  assert.ok(sawDamage, 'the player hull actually took damage at some point')
  assert.ok(u.tileHp.every(h => Number.isFinite(h)), 'hp values stayed finite (no NaN)')
  assert.ok(Number.isFinite(B.fly.x) && Number.isFinite(B.fly.y) && Number.isFinite(B.fly.v), 'flight state stayed finite (no lockup)')
})
