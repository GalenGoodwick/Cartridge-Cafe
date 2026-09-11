// BASE STATE TESTS (base-matrix P1) — rung 1 of the ladder, per subsystem:
// fetch the DEPLOYED hooks and drive them tick-by-tick in a mock sim,
// asserting each node's one job. Runs against the live base so the proof is
// about what players actually get, not a local copy.
//
//   node tools/base-statetest.mjs <uc_st_token> [baseUrl]

import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const { makeClient } = await import(join(here, '../mcp/bridge-client.mjs'))

const TOKEN = process.argv[2]
const BASE = process.argv[3] || 'https://cartridge.cafe'
if (!TOKEN) { console.error('usage: node tools/base-statetest.mjs <token> [base]'); process.exit(2) }

const c = makeClient({ base: BASE, token: TOKEN, timeoutMs: 120000 })
const { text: body } = await c.bridgeGet()
const snap = JSON.parse(body)
const hooks = new Map(snap.stepHooks.map(h => [String(h.hookId ?? h.id), new Function('sim', 'dt', h.code)]))
const ORDER = ['player', 'world', 'camera', 'entities', 'rules', 'hud', 'fx', 'audio', 'save', 'uplink']

const mkSim = () => {
  let s = 7; const rand = () => (s = (s * 1664525 + 1013904223) >>> 0, s / 2 ** 32)
  return { rand, worldData: { input: { moveX: 0, moveY: 0, pointer: {} } } }
}
const tick = (sim, only = null) => {
  for (const id of ORDER) { if (only && !only.includes(id)) continue; const f = hooks.get(id); if (f) f(sim, 1 / 60) }
}
const run = (sim, n, setup, only) => { for (let i = 0; i < n; i++) { setup?.(sim.worldData, i); tick(sim, only) } }

let pass = 0, fail = 0
const T = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? '  (' + detail + ')' : ''}`) }

console.log('═ P1 — per-subsystem state tests (deployed hooks) ═')

// player: intent from keys and from touch
{ const sim = mkSim(); run(sim, 3)
  run(sim, 2, wd => { wd.input.moveX = 1 })
  T('player: keys → intent.ax', sim.worldData.__p.intent.ax === 1)
  run(sim, 2, wd => { wd.input.moveX = 0; wd.input.pointer = { down: true, x: 60, y: 800 } })
  T('player: touch-left → walk intent', sim.worldData.__p.intent.ax < 0)
  run(sim, 2, wd => { wd.input.pointer = { down: true, x: 288, y: 100 } })
  T('player: touch-sky → jump intent', sim.worldData.__p.intent.jump === true) }

// physics: gravity, ground, jump, platform landing, fall-respawn event
{ const sim = mkSim(); run(sim, 3)
  const y0 = sim.worldData.__p.y; run(sim, 30)
  T('physics: grounds the player', sim.worldData.__p.ground === true, `y ${y0.toFixed(0)}→${sim.worldData.__p.y.toFixed(0)}`)
  run(sim, 2, wd => { wd.key_w = 1 }); const vy = sim.worldData.__p.vy
  T('physics: jump impulse', vy < -400, `vy ${vy.toFixed(0)}`)
  sim.worldData.__p.x = 150; sim.worldData.__p.y = 760; sim.worldData.__p.vy = 100
  run(sim, 30, wd => { wd.key_w = 0 })
  T('physics: lands on a platform', Math.abs(sim.worldData.__p.y - 800) < 3 && sim.worldData.__p.ground === true, `y ${sim.worldData.__p.y.toFixed(0)}`)
  sim.worldData.__p.x = 100                                    // over THE PIT
  sim.worldData.__p.y = 1000; sim.worldData.__p.vy = 500; sim.worldData.__ev = []
  run(sim, 30, null, ['world'])                       // uplink excluded → events persist
  const evs = sim.worldData.__ev || []
  T('physics: fall → respawn + event', evs.some(e => e.t === 'fell') && sim.worldData.__p.y < 1000) }

// entities: coin collect emits + coin sleeps; critter stomp vs hit
{ const sim = mkSim(); run(sim, 3)
  const c0 = sim.worldData.__ents.coins[5]           // the ground coin at 288,910
  sim.worldData.__p.x = c0.x; sim.worldData.__p.y = c0.y + 20
  const evs = []; run(sim, 2, wd => { evs.push(...(wd.__ev || [])) }, ['entities'])
  T('entities: coin collect event + sleep', evs.some(e => e.t === 'coin') && c0.up > 0)
  const K = sim.worldData.__ents.critter
  sim.worldData.__p.x = K.x; sim.worldData.__p.y = K.y; sim.worldData.__p.vy = 0
  sim.worldData.__ev = []; run(sim, 1, null, ['entities'])
  T('entities: touch → hit event', (sim.worldData.__ev || []).some(e => e.t === 'hit'))
  sim.worldData.__p.vy = 300; sim.worldData.__ev = []
  const K2 = sim.worldData.__ents.critter
  sim.worldData.__p.x = K2.x; sim.worldData.__p.y = K2.y       // re-center: the critter patrols
  run(sim, 1, null, ['entities'])
  T('entities: falling touch → stomp + bounce', (sim.worldData.__ev || []).some(e => e.t === 'stomp') && sim.worldData.__p.vy < 0) }

// rules: score, win, lives, game over, restart
{ const sim = mkSim(); run(sim, 3)
  sim.worldData.__ev = [{ t: 'coin' }]; run(sim, 1, null, ['rules'])
  T('rules: coin scores', sim.worldData.__rules.score === 1)
  sim.worldData.__rules.score = 9; sim.worldData.__ev = [{ t: 'coin' }]; run(sim, 1, null, ['rules'])
  T('rules: 10 coins → won', sim.worldData.__rules.state === 1)
  const sim2 = mkSim(); run(sim2, 3)
  sim2.worldData.__rules.lives = 1; sim2.worldData.__ev = [{ t: 'hit' }]; run(sim2, 1, null, ['rules'])
  T('rules: last heart → game over', sim2.worldData.__rules.state === 2)
  run(sim2, 1, wd => { wd.key_r = 1 })
  T('rules: R restarts clean', sim2.worldData.__rules.state === 0 && sim2.worldData.__rules.lives === 3) }

// fx: hit flashes; camera: follows height; save: best sticks; uplink: lanes + defaults
{ const sim = mkSim(); run(sim, 3)
  sim.worldData.__ev = [{ t: 'hit' }]; run(sim, 1, null, ['fx'])
  T('fx: hit → flash+shake', sim.worldData.__fx.flash > 0.9 && sim.worldData.__fx.shake > 0.9)
  sim.worldData.__p.y = 300; run(sim, 40, null, ['camera'])
  T('camera: rises with the player', sim.worldData.__cam.y < -20, `camY ${sim.worldData.__cam.y.toFixed(0)}`)
  sim.worldData.__rules = { score: 7, lives: 3, state: 0, iframe: 0 }; run(sim, 1, null, ['save'])
  T('save: best score sticks', sim.worldData.__best === 7)
  run(sim, 1)
  const U = sim.worldData.gpuUniforms
  T('uplink: player + plats on the whiteboard', Math.abs(U[0] - sim.worldData.__p.x) < 1 && U[42] > 0)
  const sim3 = mkSim(); run(sim3, 3, null, ['player', 'world', 'uplink'])   // carved world: no cam/fx/rules/ents
  const U3 = sim3.worldData.gpuUniforms
  T('uplink: sane defaults when subsystems carved', U3[4] === 0 && U3[5] === 0 && U3[7] === 0 && sim3.worldData.gpuPopulation.length === 0) }

console.log(`\n${fail === 0 ? 'ALL GREEN' : 'RED'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
