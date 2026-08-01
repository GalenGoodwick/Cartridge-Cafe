// finder.test.mjs — THE SERVER BROWSER scene, driven end-to-end through the
// ASSEMBLED hook (not a mocked fragment). We build the real cartridge hook via the
// shared harness (`freshSim` → new Function('sim','dt', hook)), seed a fake
// `wd.__lobby` of a few rooms + a saved fleet, drive SC='finder', and assert the
// browser actually renders (room rows + NEW SERVER land in gpuPopulation as chrome
// button entities) and reacts (clicking a room sets wd.__joinRoom + carries the
// whole berth set into wd.__sendDesign). Green is DERIVED from the hook running.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshSim } from './harness.mjs'
import { roomLabel, sortRooms, berthSet, ID_NEWSERVER, ID_ROW0 } from '../mod-finder.mjs'

// decode the flat gpuPopulation ([x,y,a,code, …]) into entity objects.
function ents(wd) {
  const p = Array.isArray(wd.gpuPopulation) ? wd.gpuPopulation : []
  const out = []
  for (let i = 0; i + 3 < p.length; i += 4) out.push({ x: p[i], y: p[i + 1], a: p[i + 2], code: p[i + 3] })
  return out
}
// a chrome button entity's stable id (300 + id + half-width-in-fract → trunc).
const btnId = (e) => Math.trunc(e.code) - 300

// invert PRELUDE's toUV on the default 512-square: uv (ux,uy) → pointer pixels.
// toUV: x=(px-256)/256, y=-(py-256)/256 ⇒ px=(ux+1)*256, py=(1-uy)*256.
const toPx = (ux, uy) => [(ux + 1) * 256, (1 - uy) * 256]

const ROOMS = [
  { room: 'alpha', name: 'Magic', mode: '3v3', players: 2, capacity: 6, started: false, official: true },
  { room: 'bravo', name: 'Duel', mode: '1v1', players: 1, capacity: 2, started: true, official: false },
  { room: 'charlie', name: 'Chaos', mode: '2v2', players: 0, capacity: 4, started: false, official: false },
]

test('finder renders the room rows + NEW SERVER into gpuPopulation', () => {
  const s = freshSim({ __scene: 'finder', __lobby: ROOMS })
  s.tick(5, 5, false)                                   // one frame, pointer up in a corner
  const E = ents(s.wd)

  // NEW SERVER is a chrome button at its id.
  assert.ok(E.some((e) => btnId(e) === ID_NEWSERVER), 'NEW SERVER button rendered')

  // one room row per room, at consecutive ids ID_ROW0, ID_ROW0+1, …
  for (let i = 0; i < ROOMS.length; i++) {
    assert.ok(E.some((e) => btnId(e) === ID_ROW0 + i), 'room row ' + i + ' rendered')
  }
  // and the translucent panels (code 320) are present — it's an overlay, not a dead screen.
  assert.ok(E.some((e) => Math.trunc(e.code) === 320), 'a translucent panel is drawn')

  // the layout the hook published lists exactly the (sorted) rooms.
  assert.equal(s.wd.__finderLayout.rows.length, ROOMS.length)
})

test('clicking a room sets wd.__joinRoom and carries the whole berth set', () => {
  const fleet = [[{ parent: -1, edge: -1, part: 1 }], null, null]   // one saved berth
  const s = freshSim({ __scene: 'finder', __lobby: ROOMS, __fleet: fleet })
  s.tick(5, 5, false)                                   // establish geometry + pointer-up edge state

  const row0 = s.wd.__finderLayout.rows[0]              // official-first: 'alpha'
  assert.equal(row0.room, 'alpha', 'Official server sorted to the top')
  const [px, py] = toPx(row0.cx, row0.cy)
  s.tick(px, py, true)                                  // rising-edge click on that row

  assert.equal(s.wd.__joinRoom, 'alpha', 'room click opens that room')
  assert.equal(s.wd.__newServer, false, 'joining an existing room, not hosting')
  assert.ok(Array.isArray(s.wd.__sendDesign), '__sendDesign is a berth SET')
  assert.equal(s.wd.__sendDesign.length, 1, 'the one saved berth is carried')
  assert.equal(s.wd.__sendDesign[0][0].part, 1, 'the design tree survives the trip')
})

test('NEW SERVER hosts a fresh room and still carries a berth set', () => {
  const s = freshSim({ __scene: 'finder', __lobby: ROOMS })
  s.tick(5, 5, false)
  const ns = s.wd.__finderLayout.newServer
  const [px, py] = toPx(ns.cx, ns.cy)
  s.tick(px, py, true)
  assert.equal(s.wd.__joinRoom, 'new', 'NEW SERVER requests a fresh room')
  assert.equal(s.wd.__newServer, true)
  assert.ok(Array.isArray(s.wd.__sendDesign) && s.wd.__sendDesign.length >= 1, 'fallback berth carried')
})

// ── pure helpers (mirrors of the inline hook logic) ──────────────────────────

test('roomLabel is the Istrolid `<mode> <Name>` server name', () => {
  assert.equal(roomLabel(ROOMS[0]), '3v3 Magic')
  assert.equal(roomLabel({ room: 'raw' }), 'raw')            // no name/mode → raw id
  assert.equal(roomLabel({ name: 'Solo' }), 'Solo')          // no mode → just the name
  assert.equal(roomLabel(null), '')
})

test('sortRooms puts Official servers above Community, stable within', () => {
  const out = sortRooms(ROOMS)
  assert.deepEqual(out.map((r) => r.room), ['alpha', 'bravo', 'charlie'])
  // two officials keep their poll order; a community room never jumps an official.
  const mixed = sortRooms([
    { room: 'c1', official: false }, { room: 'o1', official: true },
    { room: 'c2', official: false }, { room: 'o2', official: true },
  ])
  assert.deepEqual(mixed.map((r) => r.room), ['o1', 'o2', 'c1', 'c2'])
  assert.deepEqual(sortRooms(undefined), [])
})

test('berthSet carries only picked, saved slots — deep-copied — with a fallback', () => {
  const fleet = [[{ parent: -1, edge: -1, part: 1 }], [{ parent: -1, edge: -1, part: 3 }], null]
  const full = berthSet(fleet, [true, true, true], null)
  assert.equal(full.length, 2, 'both saved berths brought')
  const some = berthSet(fleet, [true, false, true], null)
  assert.equal(some.length, 1, 'the deselected berth is left behind')
  assert.equal(some[0][0].part, 1)
  // deep copy: mutating the source after the fact never touches the carried set.
  const carried = berthSet(fleet, [true, false, false], null)
  fleet[0][0].part = 9
  assert.equal(carried[0][0].part, 1, 'the berth set is a snapshot')
  // nothing saved → a single fallback design so you always bring a ship.
  const fb = berthSet([], null, [{ parent: -1, edge: -1, part: 2 }])
  assert.equal(fb.length, 1)
  assert.equal(fb[0][0].part, 2)
})
