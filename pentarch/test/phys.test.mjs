// phys.test — the ship-physics laws PENTARCH v2 stands on. Every claim in
// DESIGN-ship-systems.md §5 is a test here BEFORE the designer shows a number.
// Run: node --test pentarch/test/phys.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { massProps, edgeNormal, thrusters, wrench, allocate, netWrench, envelope, step, DRAG } from '../phys.mjs'

const tile = (cx, cy, part = null, o = 0, th = 0, mass = 1) => ({ cx, cy, th, part, o, mass })
const MAIN = { kind: 'main', thrust: 10, drain: 2 }
const JET = { kind: 'jet', thrust: 3, drain: 0.5 }
const GYRO = { kind: 'gyro', torque: 4, drain: 1 }

// ── mass properties ──────────────────────────────────────────────────────────
test('massProps: COM of a symmetric pair sits midway, inertia positive', () => {
  const { M, com, I } = massProps([tile(-1, 0), tile(1, 0)])
  assert.equal(M, 2)
  assert.ok(Math.abs(com.x) < 1e-12 && Math.abs(com.y) < 1e-12)
  assert.ok(I >= 2 - 1e-12)
})

test('massProps: heavier tile pulls the COM toward it', () => {
  const { com } = massProps([tile(-1, 0, null, 0, 0, 1), tile(1, 0, null, 0, 0, 3)])
  assert.ok(com.x > 0.4, `com.x=${com.x}`)
})

// ── orientation is destiny ───────────────────────────────────────────────────
test('edgeNormal: the five orientations of one tile are 72° apart', () => {
  const t = { th: 0 }
  for (let o = 0; o < 5; o++) {
    const a = edgeNormal(t, o), b = edgeNormal(t, (o + 1) % 5)
    const dot = a.x * b.x + a.y * b.y
    assert.ok(Math.abs(dot - Math.cos(2 * Math.PI / 5)) < 1e-9)
  }
})

test('ROTATING a part changes the envelope: fwd thruster → speed, side thruster → strafe', () => {
  // one hull tile + one MAIN thruster tile; find the orientation whose normal
  // is closest to +x (forward) vs closest to +y (lateral)
  const base = [tile(0, 0)]
  let bestFwd = 0, bestLat = 0, oF = 0, oL = 0
  for (let o = 0; o < 5; o++) {
    const n = edgeNormal({ th: 0 }, o)
    if (-n.x > bestFwd) { bestFwd = -n.x; oF = o }   // nozzle backward → thrust +x
    if (-n.y > bestLat) { bestLat = -n.y; oL = o }
  }
  const shipF = [...base, tile(-1, 0, MAIN, oF)]
  const shipL = [...base, tile(-1, 0, MAIN, oL)]
  const eF = envelope(shipF), eL = envelope(shipL)
  assert.ok(eF.aFwd > eL.aFwd, 'forward-oriented main gives more forward accel')
  assert.ok(eL.aLat > eF.aLat, 'side-oriented main gives more strafe')
})

// ── wrench: force through COM = no torque; offset = torque ───────────────────
test('thruster aimed through the COM produces (near) zero torque', () => {
  const tiles = [tile(0, 0), tile(-2, 0, MAIN, 0, 0)]
  const { com } = massProps(tiles)
  const ths = thrusters(tiles, com)
  // orientation 0 at th=0: normal at angle π/2+0.5·72° — NOT through COM in
  // general. Construct directly instead: a thruster whose dir points at COM.
  const th = { pos: { x: -1, y: 0 }, dir: { x: 1, y: 0 }, F: 10, T: 0 }
  const w = wrench(th, 1)
  assert.ok(Math.abs(w.tq) < 1e-12, 'no lever arm → no torque')
  assert.ok(ths.filter(t => !t.rcs).length === 1, 'sanity: one REAL thruster extracted (plus the RCS floor entries)')
})

test('offset thruster produces torque = F × lever arm', () => {
  const th = { pos: { x: 0, y: 1 }, dir: { x: 1, y: 0 }, F: 10, T: 0 }
  const w = wrench(th, 1)
  assert.ok(Math.abs(w.tq - (-10)) < 1e-12, `r×F = 0·0 - 1·10 = -10, got ${w.tq}`)
})

test('gyro: pure torque, zero force', () => {
  const tiles = [tile(0, 0), tile(1, 0, GYRO)]
  const { com } = massProps(tiles)
  const ths = thrusters(tiles, com)
  const w = wrench(ths[0], 1)
  assert.equal(Math.hypot(w.fx, w.fy), 0)
  assert.equal(w.tq, 4)
})

// ── allocation ───────────────────────────────────────────────────────────────
test('allocate: opposed thrusters never fight — only the aligned one fires', () => {
  const ths = [
    { pos: { x: 0, y: 0 }, dir: { x: 1, y: 0 }, F: 10, T: 0 },   // pushes +x
    { pos: { x: 0, y: 0 }, dir: { x: -1, y: 0 }, F: 10, T: 0 },  // pushes -x
  ]
  const us = allocate(ths, { fwd: 1, lat: 0, turn: 0 })
  assert.ok(us[0] > 0.9, '+x thruster fires')
  assert.equal(us[1], 0, '-x thruster stays silent')
})

test('allocate: turn command fires only the torque-agreeing side', () => {
  const ths = [
    { pos: { x: 0, y: 1 }, dir: { x: 1, y: 0 }, F: 10, T: 0 },   // tq = -10 (CW)
    { pos: { x: 0, y: -1 }, dir: { x: 1, y: 0 }, F: 10, T: 0 },  // tq = +10 (CCW)
  ]
  const us = allocate(ths, { fwd: 0, lat: 0, turn: 1 })   // want CCW (+)
  const w = netWrench(ths, us)
  assert.ok(w.tq > 0, `net torque follows the command, got ${w.tq}`)
})

// ── envelope honesty ─────────────────────────────────────────────────────────
test('envelope: a bare hull has only the RCS whisper (crawls, never flies)', () => {
  const e = envelope([tile(0, 0), tile(1, 0)])
  assert.ok(e.aFwd > 0 && e.aFwd < 0.5, `whisper thrust: ${e.aFwd}`)
  assert.ok(e.alpha > 0, 'every ship answers the stick')
  assert.ok(e.aFwd < 1, 'but a real engine is an order of magnitude more')
})

test('envelope: adding a second main thruster raises aFwd (more engine = more go)', () => {
  let oF = 0, best = -2
  for (let o = 0; o < 5; o++) { const n = edgeNormal({ th: 0 }, o); if (-n.x > best) { best = -n.x; oF = o } }
  const one = envelope([tile(0, 0), tile(-1, 1, MAIN, oF)])
  const two = envelope([tile(0, 0), tile(-1, 1, MAIN, oF), tile(-1, -1, MAIN, oF)])
  assert.ok(two.aFwd > one.aFwd, `${two.aFwd} > ${one.aFwd}`)
})

test('envelope: gyro adds alpha — and may UNLOCK thrust (it counter-balances engine torque)', () => {
  let oF = 0, best = -2
  for (let o = 0; o < 5; o++) { const n = edgeNormal({ th: 0 }, o); if (-n.x > best) { best = -n.x; oF = o } }
  const noGyro = envelope([tile(0, 0), tile(-1, 0, MAIN, oF)])
  const withGyro = envelope([tile(0, 0), tile(-1, 0, MAIN, oF), tile(1, 0, GYRO)])
  assert.ok(withGyro.alpha > noGyro.alpha)
  assert.ok(withGyro.aFwd >= noGyro.aFwd - 1e-9, 'a gyro never costs thrust — it frees the engine from its own spin')
})

test('envelope: mass matters — same engines on a heavier hull accelerate less', () => {
  let oF = 0, best = -2
  for (let o = 0; o < 5; o++) { const n = edgeNormal({ th: 0 }, o); if (-n.x > best) { best = -n.x; oF = o } }
  const light = envelope([tile(0, 0), tile(-1, 0, MAIN, oF)])
  const heavy = envelope([tile(0, 0), tile(1, 0), tile(2, 0), tile(3, 0), tile(-1, 0, MAIN, oF)])
  assert.ok(heavy.aFwd < light.aFwd)
})

// ── integration: flight ──────────────────────────────────────────────────────
test('step: full-forward from rest accelerates then saturates near vMax', () => {
  let oF = 0, best = -2
  for (let o = 0; o < 5; o++) { const n = edgeNormal({ th: 0 }, o); if (-n.x > best) { best = -n.x; oF = o } }
  // TWIN engines mirrored about the axis: parasitic torques cancel. (A single
  // off-center engine spins the ship — that is correct physics, not a bug, and
  // exactly what the designer's envelope readout will teach.)
  const tiles = [tile(0, 0), tile(-1, 1, MAIN, oF), tile(-1, -1, MAIN, oF)]
  const e = envelope(tiles)
  const st = { x: 0, y: 0, vx: 0, vy: 0, th: 0, om: 0 }
  for (let i = 0; i < 600; i++) step(st, tiles, { fwd: 1, lat: 0, turn: 0 }, 1 / 60)
  const v = Math.hypot(st.vx, st.vy)
  assert.ok(v > 0.5 * e.vMax, `reached ${v} of vMax ${e.vMax}`)
  assert.ok(v < 1.2 * e.vMax, `did not exceed drag-limited top speed (${v} vs ${e.vMax})`)
  assert.ok(st.x > 0, 'moved forward')
})

test('step: drain is reported and scales with throttle', () => {
  let oF = 0, best = -2
  for (let o = 0; o < 5; o++) { const n = edgeNormal({ th: 0 }, o); if (-n.x > best) { best = -n.x; oF = o } }
  const tiles = [tile(0, 0), tile(-1, 0, MAIN, oF)]
  const full = step({ x: 0, y: 0, vx: 0, vy: 0, th: 0, om: 0 }, tiles, { fwd: 1, lat: 0, turn: 0 }, 1 / 60)
  const idle = step({ x: 0, y: 0, vx: 0, vy: 0, th: 0, om: 0 }, tiles, { fwd: 0, lat: 0, turn: 0 }, 1 / 60)
  assert.ok(full.drain > 0)
  assert.equal(idle.drain, 0)
})

// ── the control-system law (Galen): angled engines COUNTER-BALANCE at full ──
test('CONTROL: mirrored 45° engines both fire ~FULL going straight; drift cancels', () => {
  const ths = [
    { pos: { x: 0, y: 1 }, dir: { x: Math.SQRT1_2, y: Math.SQRT1_2 }, F: 10, T: 0 },
    { pos: { x: 0, y: -1 }, dir: { x: Math.SQRT1_2, y: -Math.SQRT1_2 }, F: 10, T: 0 },
  ]
  const us = allocate(ths, { fwd: 1, lat: 0, turn: 0 })
  assert.ok(us[0] > 0.9 && us[1] > 0.9, `both saturate: ${us.map(u => u.toFixed(2))}`)
  const w = netWrench(ths, us)
  assert.ok(Math.abs(w.fy) < 0.4, `lateral bleed cancels (fy=${w.fy.toFixed(2)})`)
  assert.ok(Math.abs(w.tq) < 0.6, `torques cancel (tq=${w.tq.toFixed(2)})`)
  assert.ok(w.fx > 12, `net forward beats a single engine (fx=${w.fx.toFixed(1)})`)
})

test('CONTROL: a lone skewed engine is throttled back (its drift has no partner)', () => {
  const lone = [{ pos: { x: 0, y: 0 }, dir: { x: Math.SQRT1_2, y: Math.SQRT1_2 }, F: 10, T: 0 }]
  const us = allocate(lone, { fwd: 1, lat: 0, turn: 0 })
  const pair = allocate([lone[0], { pos: { x: 0, y: 0 }, dir: { x: Math.SQRT1_2, y: -Math.SQRT1_2 }, F: 10, T: 0 }], { fwd: 1, lat: 0, turn: 0 })
  assert.ok(us[0] < pair[0], `lone ${us[0].toFixed(2)} < paired ${pair[0].toFixed(2)} — the partner unlocks full throttle`)
})

// ── MOUNT / GIMBAL laws (Galen's spec, Jul 31 night) ─────────────────────────
import { MOUNTS, shipMass, aimGimbal } from '../phys.mjs'

test('MOUNTS: two RING engines on a turn command spin the ship (near-zero net force)', () => {
  const tiles = [
    tile(0, 0),
    { cx: -2, cy: 0, th: 0, part: MAIN, o: 0, mass: 1, mount: 'ring' },
    { cx: 2, cy: 0, th: 0, part: MAIN, o: 0, mass: 1, mount: 'ring' },
  ]
  const { com } = massProps(tiles)
  const ths = thrusters(tiles, com)
  const us = allocate(ths, { fwd: 0, lat: 0, turn: 1 })
  const aimed = ths.map((th, i) => ({ ...th, dir: us.dirs[i] }))
  const w = netWrench(aimed, us)
  assert.ok(w.tq > 8, `strong spin (tq=${w.tq.toFixed(1)})`)
  assert.ok(Math.hypot(w.fx, w.fy) < 0.25 * Math.abs(w.tq), `tangent aims cancel drift (|F|=${Math.hypot(w.fx, w.fy).toFixed(2)})`)
})

test('MOUNTS: one RING engine reverses freely but strafes only weakly (off-COM side force spins); a fore+aft RING PAIR strafes clean', () => {
  const one = [tile(0, 0), { cx: -1, cy: 0, th: 0, part: MAIN, o: 0, mass: 1, mount: 'ring' }]
  const fixed = [tile(0, 0), { cx: -1, cy: 0, th: 0, part: MAIN, o: 1, mass: 1 }]   // o=1 → nozzle 198° (backward) → thrust forward
  const pair = [tile(0, 0), { cx: -1, cy: 0, th: 0, part: MAIN, o: 0, mass: 1, mount: 'ring' },
    { cx: 1, cy: 0, th: 0, part: MAIN, o: 0, mass: 1, mount: 'ring' }]
  const e1 = envelope(one), eF = envelope(fixed), e2 = envelope(pair)
  assert.ok(e1.aFwd > 1 && e1.aBack > 1, `gimbal reverses: ${JSON.stringify(e1)}`)
  assert.ok(eF.aBack < e1.aBack, 'fixed engine only thrust-dump brakes; a RING truly reverses')
  assert.ok(e1.aLat < e1.aFwd * 0.5, 'lone off-COM engine strafes poorly (parasitic spin — honest)')
  assert.ok(e2.aLat > e1.aLat * 2, `fore+aft pair cancels the spin and strafes clean (${e2.aLat.toFixed(2)} vs ${e1.aLat.toFixed(2)})`)
})

test('MOUNTS: a SWIVEL (±36°) cannot reach the reverse direction', () => {
  const th = { pos: { x: 0, y: 0 }, dir: { x: 1, y: 0 }, ang: 0, half: MOUNTS.swivel.half, F: 10, T: 0 }
  const aimed = aimGimbal(th, -1, 0)   // want reverse
  assert.ok(aimed.x > 0.7, `clamped to the arc edge, still mostly forward (x=${aimed.x.toFixed(2)})`)
})

test('WEIGHT: the algorithm is explicit — mounts and modules add real mass', () => {
  const bare = shipMass([{ cx: 0, cy: 0, mass: 1 }])[0].mass
  const ringed = shipMass([{ cx: 0, cy: 0, mass: 1, mount: 'ring', moduleMass: 1.5 }])[0].mass
  assert.equal(bare, 1)
  assert.equal(ringed, 1 + MOUNTS.ring.mass + 1.5)
  // and it shows up in flight: same engine, ring-mounted ship is slower per kg
  const light = envelope([tile(0, 0), { cx: -1, cy: 0, th: 0, part: MAIN, o: 1, mass: 1 }])
  const heavy = envelope(shipMass([
    { cx: 0, cy: 0, th: 0, part: null, o: 0, mass: 1, mount: 'ring', moduleMass: 2 },
    { cx: -1, cy: 0, th: 0, part: MAIN, o: 1, mass: 1 },
  ]))
  assert.ok(heavy.aFwd < light.aFwd, `mass costs speed (${heavy.aFwd.toFixed(2)} < ${light.aFwd.toFixed(2)})`)
})

test('DESTRUCTION: losing engines degrades honestly — the ship does what it can', () => {
  let oF = 0, b = -2
  for (let o = 0; o < 5; o++) { const n = edgeNormal({ th: 0 }, o); if (-n.x > b) { b = -n.x; oF = o } }
  const full = [tile(0, 0), tile(-1, 1, MAIN, oF), tile(-1, -1, MAIN, oF), tile(1, 0, GYRO)]
  const crippled = full.slice(0, 2)          // lost an engine + the gyro
  const brick = [tile(0, 0)]                 // lost everything
  const eF = envelope(full), eC = envelope(crippled), eB = envelope(brick)
  assert.ok(eC.aFwd < eF.aFwd, 'half the engines, less go')
  assert.ok(eC.aFwd > 0, 'but it still limps')
  assert.ok(eB.aFwd < 0.5 && eB.aFwd < eC.aFwd, 'stripped to the hull: only the RCS whisper remains')
})

test('ISTROLID LAW: four FIXED up/down engines can still turn the ship (differential)', () => {
  let oU = 0, b = -2
  for (let o = 0; o < 5; o++) { const n = edgeNormal({ th: 0 }, o); if (-n.y > b) { b = -n.y; oU = o } }   // thrust UP = nozzle down
  let oD = 0; b = -2
  for (let o = 0; o < 5; o++) { const n = edgeNormal({ th: 0 }, o); if (n.y > b) { b = n.y; oD = o } }   // thrust DOWN = nozzle up
  const tiles = [
    tile(0, 0),
    tile(-2, 1, MAIN, oU), tile(2, 1, MAIN, oD),    // bow up · stern down = CCW couple... 
    tile(-2, -1, MAIN, oD), tile(2, -1, MAIN, oU),
  ]
  const e = envelope(tiles)
  assert.ok(e.alpha > 0.5, `differential thrust turns the ship (α=${e.alpha.toFixed(2)})`)
})
