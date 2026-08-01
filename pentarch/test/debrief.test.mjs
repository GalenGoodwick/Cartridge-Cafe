// debrief.test — THE DEBRIEF scene, proven against the ASSEMBLED hook (via the
// shared harness, CONTRACT §7). We seed a room in the debrief scene, tick a frame,
// and watch the real worldData mutate: the scoreboard + REMATCH/LEAVE controls must
// render as entities, REMATCH (host only) must flip PW.scene→'lobby', and LEAVE must
// drop this client to wd.__scene='finder'. Green is DERIVED from running the hook.
//   node --test pentarch/test/debrief.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshSim, uvpx } from './harness.mjs'
import { DEBRIEF_SRC, SRC } from '../mod-debrief.mjs'

// walk the flat gpuPopulation [x,y,a,code, …] into {x,y,a,code} entities.
function ents(wd) {
  const P = wd.gpuPopulation || []
  const out = []
  for (let i = 0; i + 3 < P.length; i += 4) out.push({ x: P[i], y: P[i + 1], a: P[i + 2], code: P[i + 3] })
  return out
}
const byBtn = (es, id) => es.filter((e) => Math.trunc(e.code) === 300 + id)
const panels = (es) => es.filter((e) => Math.trunc(e.code) === 320)

// pixel coords for a chrome-uv button centre. The harness uvpx maps uv→px WITHOUT
// the y-flip that PRELUDE.toUV applies, so a control drawn at chrome-uv (cx,cy)
// (+y up) is CLICKED at uvpx(cx, -cy). Pin that here so clicks land on target.
const clickPx = (cx, cy) => uvpx(cx, -cy)

// a fresh room parked in the debrief scene; seat 0 is host by default.
function debriefRoom(extra = {}) {
  return freshSim(Object.assign({
    __pw: { scene: 'debrief', host: 0, seats: [{ seat: 0 }, { seat: 1 }], winner: 0 },
  }, extra))
}

// ── the module exports the contract the swarm graph + build.mjs both need ─────
test('exports DEBRIEF_SRC (graph) and SRC (build), same source', () => {
  assert.equal(typeof DEBRIEF_SRC, 'string')
  assert.equal(SRC, DEBRIEF_SRC, 'SRC is the DEBRIEF_SRC build inlines')
  assert.ok(DEBRIEF_SRC.length > 0)
})

// ── render: scoreboard panel + both buttons appear when the scene is debrief ──
test('debrief renders the scoreboard panel and the REMATCH + LEAVE buttons', () => {
  const { tick } = debriefRoom()
  const wd = tick(99, 99, false)                 // pointer parked off any control
  assert.equal(wd.__hookError, undefined, 'the assembled hook ran without fault')
  const es = ents(wd)
  // scoreboard = a translucent PANEL near y≈0.20 (distinct from the topBar band)
  const board = panels(es).find((p) => Math.abs(p.y - 0.20) < 0.02)
  assert.ok(board, 'scoreboard panel rendered')
  // REMATCH = button id 6, LEAVE = button id 7 (host sees both)
  assert.equal(byBtn(es, 6).length, 1, 'REMATCH button rendered')
  assert.equal(byBtn(es, 7).length, 1, 'LEAVE button rendered')
})

// ── a non-host does NOT get a REMATCH button, but still gets LEAVE ────────────
test('only the host sees REMATCH; every seat sees LEAVE', () => {
  const seat1 = new Array(16).fill(0); seat1[15] = 1        // MY_SEAT = 1, host = 0
  const { tick } = debriefRoom({ gpuUniforms: seat1 })
  const es = ents(tick(99, 99, false))
  assert.equal(byBtn(es, 6).length, 0, 'non-host has no REMATCH')
  assert.equal(byBtn(es, 7).length, 1, 'non-host still has LEAVE')
})

// ── REMATCH (host) → PW.scene='lobby' ────────────────────────────────────────
test('host clicking REMATCH sends the room back to the lobby', () => {
  const { tick, wd } = debriefRoom()
  tick(99, 99, false)                            // establish a released pointer first
  assert.equal(wd.__pw.scene, 'debrief')
  const [px, py] = clickPx(-0.22, -0.55)         // REMATCH button centre
  tick(px, py, true)                             // rising-edge click on REMATCH
  assert.equal(wd.__pw.scene, 'lobby', 'PW.scene flipped to lobby')
  assert.equal(wd.__pw.started, false, 'the room is un-started for the re-form')
  assert.equal(wd.__play_sound, 'rematch')
})

// ── a NON-host click on the same spot is inert (no rematch authority) ─────────
test('a non-host clicking the REMATCH spot does nothing', () => {
  const seat1 = new Array(16).fill(0); seat1[15] = 1
  const { tick, wd } = debriefRoom({ gpuUniforms: seat1 })
  tick(99, 99, false)
  const [px, py] = clickPx(-0.22, -0.55)
  tick(px, py, true)
  assert.equal(wd.__pw.scene, 'debrief', 'a non-host cannot rematch')
})

// ── LEAVE (any player) → wd.__scene='finder' ─────────────────────────────────
test('clicking LEAVE drops this client back to the finder', () => {
  const { tick, wd } = debriefRoom()
  tick(99, 99, false)
  assert.notEqual(wd.__scene, 'finder')
  const [px, py] = clickPx(0.22, -0.55)          // LEAVE button centre
  tick(px, py, true)
  assert.equal(wd.__scene, 'finder', 'wd.__scene → finder on LEAVE')
  assert.equal(wd.__play_sound, 'leave')
})

// ── the click is a RISING EDGE: holding the pointer down does not re-fire ─────
test('REMATCH fires once on the click edge, not every held frame', () => {
  const { tick, wd } = debriefRoom()
  tick(99, 99, false)
  const [px, py] = clickPx(-0.22, -0.55)
  tick(px, py, true)                             // edge → rematch
  assert.equal(wd.__pw.scene, 'lobby')
  wd.__pw.scene = 'debrief'                       // pretend we're back; keep holding
  tick(px, py, true)                             // held (no new edge) → no re-fire
  assert.equal(wd.__pw.scene, 'debrief', 'a held pointer does not re-trigger')
})
