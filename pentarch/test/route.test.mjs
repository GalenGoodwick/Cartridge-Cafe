// route.test — the "calculates what is possible" laws: arc-to-point geometry,
// curvature speed caps, three-pass speed profile (slow into hairpins, arrive at
// rest), and closed-loop: a phys ship actually FLIES a planned route.
// Run: node --test pentarch/test/route.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arcToPoint, maxSpeedForKappa, clickCommand, resample, curvatures, speedProfile, follow } from '../route.mjs'
import { envelope, step, edgeNormal } from '../phys.mjs'

// a competent little ship: twin mains, port+starboard jets, gyro
const MAIN = { thrust: 10, drain: 2 }, JET = { thrust: 4, drain: 0.5 }, GYRO = { torque: 6, drain: 1 }
const tile = (cx, cy, part = null, o = 0) => ({ cx, cy, th: 0, part, o, mass: 1 })
// nozzle opposite the wanted thrust (rocket convention)
const oBest = (fx, fy) => { let bo = 0, b = -2; for (let o = 0; o < 5; o++) { const n = edgeNormal({ th: 0 }, o); const d = -(n.x * fx + n.y * fy); if (d > b) { b = d; bo = o } } return bo }
const SHIP = [
  tile(0, 0),
  tile(-1, 1, MAIN, oBest(1, 0)), tile(-1, -1, MAIN, oBest(1, 0)),
  tile(0, 1, JET, oBest(0, -1)), tile(0, -1, JET, oBest(0, 1)),
  tile(1, 0, GYRO),
]
const ENV = envelope(SHIP)

test('arcToPoint: dead ahead needs zero curvature; abeam needs plenty', () => {
  const ahead = arcToPoint({ x: 0, y: 0 }, 0, { x: 10, y: 0 })
  assert.ok(Math.abs(ahead.kappa) < 1e-9)
  const abeam = arcToPoint({ x: 0, y: 0 }, 0, { x: 0, y: 5 })
  assert.ok(Math.abs(abeam.kappa) > 0.3, `κ=${abeam.kappa}`)
  assert.ok(abeam.kappa > 0, 'left target → positive (CCW) curvature')
})

test('maxSpeedForKappa: straight = vMax, tighter = slower, monotone', () => {
  assert.equal(maxSpeedForKappa(ENV, 0), ENV.vMax)
  const v1 = maxSpeedForKappa(ENV, 0.5), v2 = maxSpeedForKappa(ENV, 2), v3 = maxSpeedForKappa(ENV, 8)
  assert.ok(v1 > v2 && v2 > v3, `${v1} > ${v2} > ${v3}`)
})

test('clickCommand advises a speed the arc can actually be held at', () => {
  const c = clickCommand({ x: 0, y: 0 }, 0, { x: 3, y: 3 }, ENV)
  assert.ok(c.vAdvise <= maxSpeedForKappa(ENV, c.kappa) + 1e-9)
  assert.ok(c.vAdvise > 0)
})

test('resample: even spacing, endpoints preserved', () => {
  const raw = [{ x: 0, y: 0 }, { x: 0.07, y: 0 }, { x: 1.9, y: 0 }, { x: 4, y: 0 }]
  const pts = resample(raw, 0.5)
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    assert.ok(Math.abs(d - 0.5) < 1e-6, `spacing ${d}`)
  }
  assert.deepEqual(pts[0], { x: 0, y: 0 })
  const last = pts[pts.length - 1]
  assert.ok(Math.hypot(last.x - 4, last.y) < 1e-9)
})

test('curvatures: a straight line is zero, a circle is 1/r', () => {
  const line = resample([{ x: 0, y: 0 }, { x: 10, y: 0 }], 0.5)
  assert.ok(curvatures(line).every(k => Math.abs(k) < 1e-9))
  const r = 3, circ = []
  for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI; circ.push({ x: r * Math.cos(a), y: r * Math.sin(a) }) }
  const ks = curvatures(circ)
  const mid = ks[Math.floor(ks.length / 2)]
  assert.ok(Math.abs(Math.abs(mid) - 1 / r) < 0.02, `|κ|≈1/3, got ${mid}`)
})

test('speedProfile: hairpin forces a slowdown exactly at the corner', () => {
  // out 8, hairpin, back 8
  const wish = [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8.4, y: 0.35 }, { x: 8, y: 0.7 }, { x: 0, y: 0.7 }]
  const pts = resample(wish, 0.3)
  const prof = speedProfile(pts, ENV, 0)
  const vs = prof.points.map(p => p.v)
  const straightV = Math.max(...vs)
  // find the hairpin zone (x near 8+)
  const cornerV = Math.min(...prof.points.filter(p => p.x > 7.5).map(p => p.v))
  assert.ok(cornerV < straightV * 0.55, `corner ${cornerV.toFixed(2)} ≪ straight ${straightV.toFixed(2)}`)
  assert.equal(vs[vs.length - 1], 0, 'arrives at rest')
  assert.ok(Number.isFinite(prof.eta) && prof.eta > 0)
})

test('speedProfile: accel/brake ramps respected between neighbors', () => {
  const pts = resample([{ x: 0, y: 0 }, { x: 20, y: 0 }], 0.4)
  const prof = speedProfile(pts, ENV, 0)
  for (let i = 1; i < prof.points.length; i++) {
    const a = prof.points[i - 1], b = prof.points[i]
    const ds = Math.hypot(b.x - a.x, b.y - a.y)
    assert.ok(b.v * b.v <= a.v * a.v + 2 * ENV.aFwd * ds + 1e-6, `accel ramp broken at ${i}`)
    const brake = Math.max(ENV.aBack, 1e-6) + 0.6 * b.v      // the drag-honest brake law (route.mjs)
    assert.ok(a.v * a.v <= b.v * b.v + 2 * brake * ds + 1e-6, `brake ramp broken at ${i}`)
  }
})

test('a faster hull is allowed a faster profile (envelope drives it)', () => {
  // genuinely slower: ONE engine hauling five dead hull tiles (worse
  // thrust-to-weight). First attempt used a 2-tile ship — which was FASTER
  // than the big one (better T/W), the physics calling out the test's premise.
  const slowShip = [tile(0, 0), tile(1, 0), tile(2, 0), tile(0, 2), tile(1, 2), tile(-1, 1, MAIN, oBest(1, 0))]
  const eSlow = envelope(slowShip)
  const pts = resample([{ x: 0, y: 0 }, { x: 15, y: 0 }], 0.4)
  const fast = speedProfile(pts, ENV, 0), slow = speedProfile(pts, eSlow, 0)
  assert.ok(fast.eta <= slow.eta + 1e-9, `fast eta ${fast.eta} ≤ slow eta ${slow.eta}`)
})

test('CLOSED LOOP: the phys ship flies the planned route to its end', () => {
  const wish = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 9, y: 2.5 }, { x: 12, y: 2.5 }]
  const prof = speedProfile(resample(wish, 0.3), ENV, 0)
  const st = { x: 0, y: 0, vx: 0, vy: 0, th: 0, om: 0 }
  let done = false
  for (let i = 0; i < 60 * 60 && !done; i++) {   // up to 60 sim-seconds
    const cmd = follow(st, prof, ENV)
    done = cmd.done
    if (!done) step(st, SHIP, cmd.want, 1 / 60)
  }
  const end = wish[wish.length - 1]
  assert.ok(done, 'follow() reported arrival')
  assert.ok(Math.hypot(st.x - end.x, st.y - end.y) < 1.2, `parked near the end (${st.x.toFixed(2)},${st.y.toFixed(2)})`)
})
