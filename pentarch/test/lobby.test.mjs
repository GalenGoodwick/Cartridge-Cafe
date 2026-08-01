// lobby.test — THE WAR ROOM. Proves the lobby scene two ways: its PURE helpers
// (host = lowest seat, canned quickchat lines, rolling chat log) directly, and
// the HOOK FRAGMENT driven through the REAL assembled hook (freshSim → build →
// new Function) — seats + START actually render, a host START flips the room
// scene to 'battle', and a latched number key posts a canned line to PW.chat.
//   node --test pentarch/test/lobby.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshSim } from './harness.mjs'
import {
  hostSeat, seatList, cannedLine, appendChat,
  QUICKCHAT, LOBBY, START_ID, SEAT_ID,
} from '../mod-lobby.mjs'

// place the pointer at a hook-uv point: the INVERSE of the RUNTIME toUV on the
// 512-square (x = (ux+1)·256 ; y = (1−uy)·256, because toUV flips y to +up).
const pxAt = (ux, uy) => [(ux + 1) * 256, (1 - uy) * 256]

// decode the flat gpuPopulation [x,y,a,code,…] into {x,y,a,code} tuples.
const pop = (wd) => {
  const p = wd.gpuPopulation || []
  const out = []
  for (let i = 0; i + 3 < p.length; i += 4) out.push({ x: p[i], y: p[i + 1], a: p[i + 2], code: p[i + 3] })
  return out
}
const seedRoom = (over = {}) => Object.assign({
  width: 512, height: 512,
  players: [{ seat: 0, chat_n: 0, chat_key: 1 }, { seat: 1 }],
  __pw: { scene: 'lobby', host: 0, chat: [] },
}, over)

// ── PURE HELPERS ─────────────────────────────────────────────────────────────

test('hostSeat: the host is the lowest occupied seat', () => {
  assert.equal(hostSeat([{ seat: 3 }, { seat: 1 }, { seat: 2 }]), 1)
  assert.equal(hostSeat([{ seat: 0 }, { seat: 1 }]), 0)
  assert.equal(hostSeat([]), -1, 'empty room has no host')
  assert.equal(hostSeat(null), -1)
})

test('seatList: occupied seats, ascending', () => {
  assert.deepEqual(seatList([{ seat: 2 }, { seat: 0 }, { seat: 1 }]), [0, 1, 2])
  assert.deepEqual(seatList([]), [])
})

test('cannedLine: number keys 1..9 map to canned lines; out of range → ""', () => {
  assert.equal(cannedLine(1), QUICKCHAT[0])
  assert.equal(cannedLine(QUICKCHAT.length), QUICKCHAT[QUICKCHAT.length - 1])
  assert.equal(cannedLine(0), '')
  assert.equal(cannedLine(99), '')
})

test('appendChat: rolls the log to the last 5 lines', () => {
  let chat = []
  for (let i = 0; i < 7; i++) chat = appendChat(chat, { seat: 0, msg: 'm' + i })
  assert.equal(chat.length, 5, 'capped at 5')
  assert.equal(chat[0].msg, 'm2', 'oldest two dropped')
  assert.equal(chat[4].msg, 'm6')
})

// ── THE HOOK FRAGMENT (driven through the real assembled hook) ───────────────

test('lobby renders a seat row per player and a START button', () => {
  const { tick, wd } = freshSim(seedRoom())
  tick(256, 256, false)   // neutral pointer, no click
  assert.equal(wd.__hookError, undefined, 'lobby hook threw: ' + wd.__hookError)
  const ents = pop(wd)
  const seatRows = ents.filter((e) => Math.floor(e.code) === 300 + SEAT_ID)
  assert.equal(seatRows.length, 2, 'one drawn seat row per occupied seat')
  const startBtn = ents.filter((e) => Math.floor(e.code) === 300 + START_ID)
  assert.ok(startBtn.length >= 1, 'the START button is drawn')
  // the live map is behind the panel — capture circles present, never a dead screen
  assert.ok(ents.some((e) => Math.floor(e.code) >= 200 && Math.floor(e.code) < 210), 'capture circles on the live map')
  assert.ok(ents.some((e) => Math.floor(e.code) === 320), 'a translucent battleroom panel')
})

test('host clicking START flips PW.scene to battle', () => {
  const { tick, wd } = freshSim(seedRoom())
  const [sx, sy] = pxAt(LOBBY.startX, LOBBY.startY)
  tick(sx, sy, false)      // pointer over START, button UP → edge low, no fire
  assert.equal(wd.__pw.scene, 'lobby', 'still in the lobby before the click lands')
  tick(sx, sy, true)       // button DOWN → rising edge → START fires (host = seat 0)
  assert.equal(wd.__hookError, undefined, 'lobby hook threw: ' + wd.__hookError)
  assert.equal(wd.__pw.scene, 'battle', 'host START flips the room to battle')
  assert.equal(wd.__pw.started, true, 'PW.started latched')
  assert.equal(wd.__started, true, 'wd.__started mirrored for the arena')
})

test('a latched number key posts its canned line into PW.chat', () => {
  const { tick, wd } = freshSim(seedRoom())
  tick(256, 256, false)               // prime the latch (chat_n = 0 → no post)
  assert.equal(wd.__pw.chat.length, 0, 'no chat before a key is pressed')
  wd.players[0].chat_n = 1            // press number key 1 (chat_key already 1)
  wd.players[0].chat_key = 1
  tick(256, 256, false)               // latch delta = 1 → post the canned line
  assert.equal(wd.__hookError, undefined, 'lobby hook threw: ' + wd.__hookError)
  assert.equal(wd.__pw.chat.length, 1, 'exactly one line posted on the rising counter')
  assert.equal(wd.__pw.chat[0].msg, QUICKCHAT[0], 'key 1 → the first canned line')
  assert.equal(wd.__pw.chat[0].seat, 0, 'attributed to my seat')
  // holding the same counter value posts nothing more (latched, not level)
  tick(256, 256, false)
  assert.equal(wd.__pw.chat.length, 1, 'a held counter does not repeat')
})
