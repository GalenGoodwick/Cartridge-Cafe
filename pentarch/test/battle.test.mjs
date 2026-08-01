// battle.test — the WAR SCENE mechanics, proven off hull.makeUnit() units so the
// combat is verified without a render. THIS FILE is co-owned by the battle
// mechanic nodes (bt-econ/bt-move/bt-damage/bt-win); each adds its own block.
//
// bt-damage slice: per-tile beam damage → nearest enemy TILE, route-BFS SHED of
// orphaned tiles, tile-0 death kills the unit, and the STAR super-weapon (armed
// only while its pentagram hole survives; a charged lance deals AoE, then
// disarms if the hole breaks). Node's built-in runner:
//   node --test pentarch/test/battle.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  tileWorldPos, nearestEnemyTile, applyBeam, shedUnit, unitDead,
  starArmed, chargeStar, fireLance, enemyKey,
  BEAM_DMG, STAR_DMG,
} from '../mod-battle.mjs'
import { makeUnit, aliveTiles } from '../hull.mjs'

// a chain design: base HULL(part), then one tile per edge in `seq` on the prev.
const mk = (seq, part = 1) => {
  const t = [{ parent: -1, edge: -1, part }]
  for (const ch of String(seq)) t.push({ parent: t.length - 1, edge: +ch, part })
  return t
}
// the minimal STAR specimen (penta-hunt: base + edge-2 first, then '21313213').
const STAR_SEQ = '221313213'
const starUnit = (opts) => makeUnit(mk(STAR_SEQ), opts)

// ── tile → world mapping ─────────────────────────────────────────────────────
test('tileWorldPos rotates the hull pose and translates to the unit', () => {
  const u = makeUnit(mk('22'), { x: 10, y: -5, a: 0 })
  u.x = 10; u.y = -5; u.a = 0
  const p0 = tileWorldPos(u, 0, 1)              // tile 0 is at local (0,0)
  assert.ok(Math.abs(p0.x - 10) < 1e-9 && Math.abs(p0.y + 5) < 1e-9)
  // a 90° heading turns local +x into world +y around the unit centre
  u.a = Math.PI / 2
  const t1 = u.tiles[1]
  const p1 = tileWorldPos(u, 1, 1)
  assert.ok(Math.abs(p1.x - (10 - t1.cy)) < 1e-6)
  assert.ok(Math.abs(p1.y - (-5 + t1.cx)) < 1e-6)
})

// ── beam targeting: nearest ENEMY tile, never friendly, never dead ───────────
test('nearestEnemyTile picks the nearest live enemy tile and ignores friendlies', () => {
  const me = makeUnit(mk('2'), { seat: 0, x: 0, y: 0 }); me.x = 0; me.y = 0
  const near = makeUnit(mk('22'), { seat: 1 }); near.x = 0.2; near.y = 0
  const far = makeUnit(mk('22'), { seat: 1 }); far.x = 5; far.y = 0
  const ally = makeUnit(mk('22'), { seat: 0 }); ally.x = 0.05; ally.y = 0
  const hit = nearestEnemyTile(me, [me, near, far, ally], { scale: 0.06 })
  assert.ok(hit, 'an enemy tile is found')
  assert.equal(hit.unit, near, 'the closer enemy, not the far one')
  assert.notEqual(hit.unit, ally, 'never a friendly (same seat)')
})

test('nearestEnemyTile respects range and skips dead tiles', () => {
  const me = makeUnit(mk('2'), { seat: 0 }); me.x = 0; me.y = 0
  const foe = makeUnit(mk('22'), { seat: 1 }); foe.x = 1; foe.y = 0
  assert.equal(nearestEnemyTile(me, [me, foe], { range: 0.5 }), null, 'out of range → no target')
  assert.ok(nearestEnemyTile(me, [me, foe], { range: 2 }), 'in range → target')
  // a foe whose every tile is dead is untargetable
  const dead = makeUnit(mk('22'), { seat: 1 }); dead.x = 0.1; dead.y = 0
  dead.tileHp.fill(0)
  assert.equal(nearestEnemyTile(me, [me, dead], { range: 2 }), null)
})

// ── per-tile damage ──────────────────────────────────────────────────────────
test('applyBeam subtracts hp, clamps at 0, and reports the kill', () => {
  const u = makeUnit(mk('222', 2))            // ARMOR chain, durable
  const max = u.tileHp[1]
  assert.equal(applyBeam(u, 1, 5), false)     // survives
  assert.equal(u.tileHp[1], max - 5)
  assert.equal(applyBeam(u, 1, max), true)    // killed (crosses to 0)
  assert.equal(u.tileHp[1], 0)
  assert.equal(applyBeam(u, 1, 5), false, 'already-dead tile → no re-kill')
  assert.equal(applyBeam(u, 99, 5), false, 'out-of-range index is a no-op')
})

test('applyBeam default damage is BEAM_DMG', () => {
  const u = makeUnit(mk('22', 2))
  const max = u.tileHp[1]
  applyBeam(u, 1)
  assert.equal(u.tileHp[1], max - BEAM_DMG)
})

// ── route-shed: the frozen yard-route semantics, now on battle units ─────────
test('shedUnit shears the downstream orphans of an open-chain cut', () => {
  const u = makeUnit(mk('2222', 1))           // 5-tile open chain (0-1-2-3-4)
  assert.equal(aliveTiles(u).size, 5)
  u.tileHp[2] = 0                              // kill the middle tile
  const alive = shedUnit(u)
  assert.deepEqual([...alive].sort((a, b) => a - b), [0, 1])
  assert.equal(u.tileHp[3], 0, 'orphan 3 sheared to 0')
  assert.equal(u.tileHp[4], 0, 'orphan 4 sheared to 0')
})

test('shedUnit: a RING reroutes around a single cut (9 of 10 survive)', () => {
  const u = makeUnit(mk('222222222', 1))      // the 10-rosette (curls closed)
  assert.equal(u.tiles.length, 10)
  u.tileHp[5] = 0                              // cut one tile
  const alive = shedUnit(u)
  assert.equal(alive.size, 9, 'the loop reroutes; nothing else orphans')
  assert.ok(u.tileHp.filter((h) => h > 0).length === 9)
})

test('unitDead: tile-0 death destroys the whole unit', () => {
  const u = makeUnit(mk('2222', 1))
  assert.equal(unitDead(u), false)
  u.tileHp[0] = 0
  assert.equal(unitDead(u), true)
  assert.equal(shedUnit(u).size, 0)
})

// ── STAR super-weapon ────────────────────────────────────────────────────────
test('starArmed is true for an intact star hull and false without a star', () => {
  const star = starUnit()
  assert.equal(star.hasStar, true)
  assert.equal(starArmed(star), true)
  const plain = makeUnit(mk('22', 1))
  assert.equal(plain.hasStar, false)
  assert.equal(starArmed(plain), false)
})

test('breaking the pentagram DISARMS the star even while the unit lives', () => {
  const star = starUnit()
  star.tileHp[5] = 0                           // kill one boundary tile
  const alive = shedUnit(star)
  assert.ok(alive.size >= 8, 'the unit is still alive')
  assert.equal(starArmed(star), false, 'the star hole re-opened → disarmed')
})

test('chargeStar accumulates only while armed and caps at 1', () => {
  const star = starUnit()
  assert.equal(chargeStar(star, 0), 0)
  chargeStar(star, 3)                          // 3s
  const c1 = star.starCharge
  assert.ok(c1 > 0 && c1 <= 1)
  chargeStar(star, 100)                        // way past full
  assert.equal(star.starCharge, 1, 'caps at ready')
  // disarm mid-charge → charge bleeds to 0
  star.tileHp[5] = 0; shedUnit(star)
  assert.equal(chargeStar(star, 1), 0)
  assert.equal(star.starCharge, 0)
})

test('fireLance: a charged star deals AoE, then resets; unready → null', () => {
  const star = starUnit({ seat: 0 }); star.x = 0; star.y = 0
  const foeA = makeUnit(mk('22', 2), { seat: 1 }); foeA.x = 0.1; foeA.y = 0
  const foeB = makeUnit(mk('22', 2), { seat: 1 }); foeB.x = 3; foeB.y = 0   // far — outside AoE
  const ally = makeUnit(mk('22', 2), { seat: 0 }); ally.x = 0.1; ally.y = 0 // never hit
  const units = [star, foeA, foeB, ally]
  // not charged yet → null, no damage
  assert.equal(fireLance(star, units, { center: { x: 0, y: 0 } }), null)
  const foeAmax = foeA.tileHp.slice()
  const allymax = ally.tileHp.slice()
  // charge to full, then fire centred on foeA
  star.starCharge = 1
  const hits = fireLance(star, units, { center: { x: 0.1, y: 0 }, radius: 0.35, dmg: STAR_DMG })
  assert.ok(Array.isArray(hits) && hits.length > 0, 'the lance hit tiles')
  assert.ok(foeA.tileHp.some((h, i) => h < foeAmax[i]), 'foeA took AoE damage')
  assert.deepEqual(ally.tileHp, allymax, 'allies are never hit')
  assert.deepEqual(foeB.tileHp, foeB.tileMaxHp, 'a foe outside the radius is untouched')
  assert.equal(star.starCharge, 0, 'the charge is spent')
  // an unarmed hull can never fire
  const plain = makeUnit(mk('22', 1), { seat: 0 }); plain.starCharge = 1
  assert.equal(fireLance(plain, units), null)
})

// ── side identity ────────────────────────────────────────────────────────────
test('enemyKey prefers seat, falls back to owner', () => {
  assert.equal(enemyKey({ seat: 2, owner: 9 }), 2)
  assert.equal(enemyKey({ seat: null, owner: 3 }), 3)
})

// ═════════════════════════════════════════════════════════════════════════════
// bt-move slice — STEERING + GUNS + ENERGY. Proven off hull.makeUnit() units.
// ═════════════════════════════════════════════════════════════════════════════
import {
  angDiff, steer, edgeUsage, outwardEdge, gunPorts, fireInterval, gunBeams,
  GUN_PART, GUN_DMG, FIRE_PERIOD, DEFAULT_SCALE,
} from '../mod-battle.mjs'

// HULL(1) base + one GUN(3) on edge 2. Add a GEN(5) to sustain (no brownout).
const HULL_GUN = [{ parent: -1, edge: -1, part: 1 }, { parent: 0, edge: 2, part: 3 }]
const HULL_GUN_GEN = [...HULL_GUN, { parent: 0, edge: 3, part: 5 }]

// ── angle math ────────────────────────────────────────────────────────────────
test('angDiff returns the signed shortest turn, wrapped to (-π,π]', () => {
  assert.ok(Math.abs(angDiff(0, Math.PI / 2) - Math.PI / 2) < 1e-9)
  // from 0.1 rad to -0.1 rad the short way is negative, not almost +2π
  assert.ok(angDiff(0.1, -0.1) < 0)
  // crossing the ±π seam takes the short arc
  assert.ok(Math.abs(angDiff(3.0, -3.0)) < 0.3)
})

// ── BLOOP steering ────────────────────────────────────────────────────────────
test('steer drives forward toward a target already ahead', () => {
  const u = makeUnit(mk('2'), { x: 0, y: 0, a: 0 }); u.x = 0; u.y = 0; u.a = 0
  steer(u, 5, 0, 0.1, { speed: 2, turn: 4 })
  assert.ok(u.x > 0, 'advanced toward +x')
  assert.ok(Math.abs(u.y) < 1e-6 && Math.abs(u.a) < 1e-6, 'no turn needed when aligned')
})

test('steer turns toward a target behind and barely advances', () => {
  const u = makeUnit(mk('2'), { x: 0, y: 0, a: 0 }); u.x = 0; u.y = 0; u.a = 0
  const x0 = u.x
  steer(u, -5, 0, 0.1, { speed: 2, turn: 4 })   // target directly behind
  assert.ok(Math.abs(u.a) > 0, 'heading rotated toward the target')
  assert.ok(Math.abs(u.a) <= 4 * 0.1 + 1e-9, 'turn is clamped by turn·dt')
  assert.ok(u.x - x0 < 0.05, 'little to no forward step while still facing away')
})

test('steer never overshoots the target', () => {
  const u = makeUnit(mk('2'), { x: 0, y: 0, a: 0 }); u.x = 0; u.y = 0; u.a = 0
  steer(u, 0.01, 0, 1, { speed: 100, turn: 10 })   // huge speed, tiny distance
  assert.ok(u.x <= 0.01 + 1e-9 && u.x >= 0, 'clamped to the target, no overshoot')
})

test('steer with default (no-thrust) stats does not move', () => {
  const u = makeUnit(HULL_GUN, { x: 0, y: 0, a: 0 }); u.x = 0; u.y = 0; u.a = 0
  assert.equal(u.stats.thrust, 0)
  steer(u, 5, 0, 0.1)                              // uses hull.stats → speed 0
  assert.ok(Math.abs(u.x) < 1e-9 && Math.abs(u.y) < 1e-9, 'no thrust → no move')
})

// ── gun ports: outward edge-normal arcs in world space ───────────────────────
test('gunPorts finds one outward port per alive gun tile', () => {
  const u = makeUnit(HULL_GUN, { seat: 0, x: 0, y: 0, a: 0 }); u.x = 0; u.y = 0; u.a = 0
  const ports = gunPorts(u)
  assert.equal(ports.length, 1, 'the single gun tile fires from one outward edge')
  assert.equal(ports[0].tileIdx, 1, 'the port is anchored to the gun tile (index 1)')
  // the outward edge is a FREE edge (not shared with the hull base)
  const used = edgeUsage(u.tiles)
  assert.ok(!used.has(ports[0].tileIdx + ':' + ports[0].edge), 'the firing edge is free')
})

test('a unit with no gun has no ports', () => {
  const u = makeUnit(mk('222', 2), { seat: 0 })   // an all-ARMOR chain
  assert.deepEqual(gunPorts(u), [])
})

test('gunPorts places the port in WORLD space under the unit pose', () => {
  const base = makeUnit(HULL_GUN, { seat: 0, x: 0, y: 0, a: 0 }); base.x = 0; base.y = 0; base.a = 0
  const p0 = gunPorts(base)[0]
  // translate the whole unit → the port translates by the same vector
  const moved = makeUnit(HULL_GUN, { seat: 0, x: 3, y: -2, a: 0 }); moved.x = 3; moved.y = -2; moved.a = 0
  const p1 = gunPorts(moved)[0]
  assert.ok(Math.abs((p1.ox - p0.ox) - 3) < 1e-9 && Math.abs((p1.oy - p0.oy) + 2) < 1e-9, 'port follows the unit')
  // rotating the unit rotates the port direction by the same amount
  const spun = makeUnit(HULL_GUN, { seat: 0, x: 0, y: 0, a: Math.PI / 2 }); spun.x = 0; spun.y = 0; spun.a = Math.PI / 2
  const p2 = gunPorts(spun)[0]
  assert.ok(Math.abs(angDiff(p0.dir, p2.dir) - Math.PI / 2) < 1e-6, 'firing arc rotates with the hull')
})

test('a dead gun tile stops firing (excluded from ports)', () => {
  const u = makeUnit(HULL_GUN, { seat: 0 })
  assert.equal(gunPorts(u).length, 1)
  // kill the gun tile (index 1); tile 0 survives so the unit lives but is unarmed
  u.tileHp[1] = 0
  assert.deepEqual(gunPorts(u), [], 'the destroyed gun no longer fires')
})

// ── energy / brownout: GEN sustains, brownout halves the fire rate ───────────
test('brownout doubles the fire interval; a sustained hull fires at base rate', () => {
  const starved = makeUnit(HULL_GUN, { seat: 0 })        // GUN draws -2, no GEN → brownout
  assert.equal(starved.stats.brownout, true)
  assert.equal(fireInterval(starved), FIRE_PERIOD * 2, 'brownout → half rate')

  const sustained = makeUnit(HULL_GUN_GEN, { seat: 0 })  // GEN +4 covers the -2 gun
  assert.equal(sustained.stats.brownout, false)
  assert.equal(fireInterval(sustained), FIRE_PERIOD, 'sustained → full rate')
})

// ── gun cadence: fires on cooldown, queues beams for bt-damage ───────────────
test('gunBeams fires a beam on cooldown elapse, then waits the interval', () => {
  const u = makeUnit(HULL_GUN_GEN, { seat: 2, x: 0, y: 0, a: 0 }); u.x = 0; u.y = 0; u.a = 0
  // first tick from cold: cooldown starts ≤0 → fires immediately
  const first = gunBeams(u, 1 / 30)
  assert.ok(first.length === 1, 'one beam from the single gun')
  assert.equal(first[0].seat, 2, 'the beam carries the firing seat')
  assert.equal(first[0].dmg, GUN_DMG)
  assert.ok(typeof first[0].ox === 'number' && typeof first[0].oy === 'number', 'a world origin')
  // immediately after firing it is on cooldown → no shot
  assert.deepEqual(gunBeams(u, 1 / 30), [], 'still cooling down')
  // advance past the full interval → it fires again
  const again = gunBeams(u, FIRE_PERIOD)
  assert.equal(again.length, 1, 'refires after the interval elapses')
})

test('a brownout hull fires half as often as a sustained one', () => {
  const brown = makeUnit(HULL_GUN, { seat: 0 })         // brownout
  const full = makeUnit(HULL_GUN_GEN, { seat: 0 })      // sustained
  // both fire once from cold, then cool down
  gunBeams(brown, 0.001); gunBeams(full, 0.001)
  // step FIRE_PERIOD: the sustained hull is ready again, the brownout one is not
  assert.equal(gunBeams(full, FIRE_PERIOD).length, 1, 'sustained refires after one period')
  assert.equal(gunBeams(brown, FIRE_PERIOD).length, 0, 'brownout still cooling (2× interval)')
  assert.equal(gunBeams(brown, FIRE_PERIOD).length, 1, 'brownout refires after two periods')
})

test('a gunless unit never fires', () => {
  const u = makeUnit(mk('22', 2), { seat: 0 })          // ARMOR only
  assert.deepEqual(gunBeams(u, 10), [])
  assert.deepEqual(gunBeams(u, 10), [])
})

// ── the beams a move-tick queues feed bt-damage's resolver ───────────────────
test('a queued gun beam damages the nearest enemy tile (bt-move → bt-damage)', () => {
  const shooter = makeUnit(HULL_GUN_GEN, { seat: 0, x: 0, y: 0, a: 0 }); shooter.x = 0; shooter.y = 0; shooter.a = 0
  const foe = makeUnit(mk('22', 2), { seat: 1, x: 0.2, y: 0 }); foe.x = 0.2; foe.y = 0
  const beam = gunBeams(shooter, 1)[0]
  assert.ok(beam, 'the shooter fired')
  // resolve exactly as bt-damage does: nearest enemy tile from the beam origin
  const hit = nearestEnemyTile({ seat: beam.seat, x: beam.ox, y: beam.oy }, [foe], { scale: DEFAULT_SCALE })
  assert.ok(hit && hit.unit === foe, 'the beam finds the enemy hull')
  const before = foe.tileHp[hit.tileIdx]
  applyBeam(hit.unit, hit.tileIdx, beam.dmg)
  assert.ok(foe.tileHp[hit.tileIdx] < before, 'the enemy tile took gun damage')
})

// ── bt-econ: capture rings + income + spawn-from-berths ───────────────────────
import {
  ringHolder, tickIncome, unitCost, trySpawn, CAPTURE_RADIUS, RING_RATE, TRICKLE,
  seatsWithUnits, allRingsHeldBy, checkWin, RING_HOLD_TIME,
} from '../mod-battle.mjs'

test('ringHolder: a lone seat inside the radius holds the ring', () => {
  const ring = { x: 0, y: 0 }
  const mine = makeUnit(mk('2'), { seat: 0 }); mine.x = 0.1; mine.y = 0
  assert.equal(ringHolder(ring, [mine]), 0, 'sole occupant holds it')
})
test('ringHolder: two seats inside the radius = contested (neutral)', () => {
  const ring = { x: 0, y: 0 }
  const a = makeUnit(mk('2'), { seat: 0 }); a.x = 0.05; a.y = 0
  const b = makeUnit(mk('2'), { seat: 1 }); b.x = 0.1; b.y = 0
  assert.equal(ringHolder(ring, [a, b]), null, 'contested → no holder')
  const far = makeUnit(mk('2'), { seat: 1 }); far.x = 5; far.y = 0
  assert.equal(ringHolder(ring, [a, far]), 0, 'an enemy out of range does not contest')
})
test('tickIncome: a sole-held ring pays its holder; every seat gets the trickle', () => {
  const mine = makeUnit(mk('2'), { seat: 0 }); mine.x = 0; mine.y = 0
  const bt = { seats: [0, 1], rings: [{ x: 0, y: 0 }], units: [mine], income: {} }
  tickIncome(bt, 1)
  assert.ok(Math.abs(bt.income[0] - (RING_RATE + TRICKLE)) < 1e-9, 'holder gets ring rate + trickle')
  assert.ok(Math.abs(bt.income[1] - TRICKLE) < 1e-9, 'a shut-out seat still gets the trickle')
  assert.equal(bt.rings[0].owner, 0, 'ring owner recorded')
})
test('trySpawn: affordable → a unit spawns at the dock and cost is deducted; broke → null', () => {
  const design = mk('22')
  const cost = unitCost(design)
  assert.ok(cost > 0, 'a design has a positive cost')
  const bt = { units: [], income: { 0: cost + 5 }, docks: { 0: { x: 3, y: -2 } } }
  const u = trySpawn(bt, 0, design)
  assert.ok(u && bt.units.length === 1, 'the unit joined the fleet')
  assert.equal(u.seat, 0); assert.equal(u.x, 3); assert.equal(u.y, -2)
  assert.ok(Math.abs(bt.income[0] - 5) < 1e-9, 'cost was deducted')
  const bt2 = { units: [], income: { 0: cost - 1 } }
  assert.equal(trySpawn(bt2, 0, design), null, 'cannot afford → no spawn')
  assert.equal(bt2.units.length, 0)
})

// ── bt-win: domination timer + last-seat-standing elimination ─────────────────
test('checkWin: holding ALL rings for the hold time wins by domination', () => {
  const bt = { rings: [{ x: 0, y: 0, owner: 0 }, { x: 1, y: 0, owner: 0 }], units: [] }
  assert.equal(checkWin(bt, 5), null, 'not held long enough yet')
  assert.equal(checkWin(bt, RING_HOLD_TIME), 0, 'held all rings past the timer → seat 0 wins')
  bt.rings[1].owner = 1
  const bt2 = { rings: [{ x: 0, y: 0, owner: 0 }, { x: 1, y: 0, owner: 1 }], units: [] }
  assert.equal(checkWin(bt2, RING_HOLD_TIME), null, 'a split map never dominates')
})
test('checkWin: once combat is joined, the last seat with a unit wins by elimination', () => {
  const a = makeUnit(mk('2'), { seat: 0 })
  const b = makeUnit(mk('2'), { seat: 1 })
  const bt = { rings: [], units: [a, b] }
  assert.equal(checkWin(bt, 0.1), null, 'two live seats → no winner')
  assert.ok(bt.combatStarted, 'combat latched once ≥2 seats fielded')
  b.tileHp[0] = 0                              // seat 1 wiped
  assert.equal(seatsWithUnits(bt).size, 1)
  assert.equal(checkWin(bt, 0.1), 0, 'seat 0 is the last standing → wins')
})
test('elimination does NOT fire before combat is joined (a lone opening spawn is not a win)', () => {
  const a = makeUnit(mk('2'), { seat: 0 })
  const bt = { rings: [], units: [a] }
  assert.equal(checkWin(bt, 0.1), null, 'only one seat ever fielded → not a win')
})
