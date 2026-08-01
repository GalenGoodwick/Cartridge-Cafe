// hull.test — verifies hull.mjs turns a berth DESIGN into a live fighting UNIT:
// stats summed from the tested parts table, motion derived from thrust/mass,
// the contact-graph route walked for SHED (matching the frozen yard-route-test
// semantics against real geometry), and the shape-payout tech tree applied.
// Node's built-in runner: `node --test pentarch/test/hull.test.mjs`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { makeUnit, routeGraph, reachableFrom, aliveTiles, shapePayout, holeKey } from '../hull.mjs'
import { layout } from '../penta-core.mjs'
import { statOf } from '../parts.mjs'

const here = dirname(fileURLToPath(import.meta.url))

// build a design like the frozen yard tests: a chain, each tile on the prev's edge `e`.
const mk = (seq, part = 1) => {
  const t = [{ parent: -1, edge: -1, part }]
  for (const e of seq) t.push({ parent: t.length - 1, edge: e, part })
  return t
}

test('makeUnit lays out every legal tile and carries part codes', () => {
  const u = makeUnit(mk([2, 2, 2], 1))
  assert.equal(u.tiles.length, 4)
  assert.equal(u.rejected.length, 0)
  assert.equal(u.tiles[0].part, 1)
})

test('stats are the SUM of the tested parts table (hp/mass/thrust/dps/cost/energy)', () => {
  // tile0 HULL(1), then GUN(3), ENGINE(4), GEN(5)
  const design = [
    { parent: -1, edge: -1, part: 1 },
    { parent: 0, edge: 2, part: 3 },
    { parent: 1, edge: 2, part: 4 },
    { parent: 2, edge: 2, part: 5 },
  ]
  const u = makeUnit(design)
  assert.equal(u.tiles.length, 4)
  let mass = 0, thrust = 0, dps = 0, cost = 0, hp = 0, gen = 0, use = 0
  for (const t of u.tiles) {
    const s = statOf(t.part)
    mass += s.mass; thrust += s.thrust; dps += s.dps; cost += s.cost; hp += s.durability
    if (s.energy > 0) gen += s.energy; else use += -s.energy
  }
  assert.equal(u.stats.mass, mass)
  assert.equal(u.stats.thrust, thrust)
  assert.equal(u.stats.dps, dps)
  assert.equal(u.stats.cost, cost)
  assert.equal(u.cost, cost)
  assert.equal(u.stats.hp, hp)           // no shape payout on an open chain → hpMul 1
  assert.equal(u.stats.energyGen, gen)
  assert.equal(u.stats.energyUse, use)
  assert.equal(u.stats.power, gen - use)
})

test('per-tile hp starts full and totals the ship hp', () => {
  const u = makeUnit(mk([2, 2, 2], 2)) // all ARMOR
  assert.deepEqual(u.tileHp, u.tileMaxHp)
  assert.equal(u.tileHp.reduce((a, b) => a + b, 0), u.stats.hp)
  assert.equal(u.tileMaxHp[0], statOf(2).durability)
})

test('speed rises with thrust, falls with mass; turn falls as the hull grows', () => {
  const oneEngine = makeUnit(mk([2], 4))          // 2 ENGINE tiles
  const heavy = makeUnit([                         // 1 ENGINE dragging 1 ARMOR
    { parent: -1, edge: -1, part: 4 },
    { parent: 0, edge: 2, part: 2 },
  ])
  assert.ok(oneEngine.stats.speed > 0)
  assert.ok(oneEngine.stats.speed > heavy.stats.speed, 'more thrust-per-mass → faster')
  const small = makeUnit(mk([2], 4))
  const big = makeUnit(mk([2, 2, 2, 2], 4))
  // same thrust/mass ratio (all ENGINE) → same speed but bigger inertia → slower turn
  assert.ok(Math.abs(small.stats.speed - big.stats.speed) < 1e-9)
  assert.ok(big.stats.turn < small.stats.turn, 'bigger hull turns slower')
})

test('a hull with no engines cannot move (speed/turn 0, no divide-by-zero)', () => {
  const u = makeUnit(mk([2, 2], 2)) // all ARMOR, no thrust
  assert.equal(u.stats.thrust, 0)
  assert.equal(u.stats.speed, 0)
  assert.equal(u.stats.turn, 0)
  assert.equal(Number.isFinite(u.stats.turn), true)
})

test('brownout flag trips when energy use exceeds generation', () => {
  const gunboat = makeUnit(mk([2, 2], 3)) // 3 GUN tiles, no GEN → net negative
  assert.ok(gunboat.stats.power < 0)
  assert.equal(gunboat.stats.brownout, true)
  const gen = makeUnit(mk([2, 2], 5))     // all GEN → positive
  assert.ok(gen.stats.power > 0)
  assert.equal(gen.stats.brownout, false)
})

// ── ROUTE / SHED — the same behavior the frozen yard-route-test asserts, now
//    against the battle route graph reachableFrom(adj, dead, 0). ──
test('routeGraph is the undirected contact graph (parent + re-touch)', () => {
  const { tiles } = layout(mk([2, 2], 1)) // 3-tile open chain
  const adj = routeGraph(tiles)
  assert.equal(adj.length, 3)
  assert.deepEqual(adj[0].sort(), [1])
  assert.deepEqual(adj[1].sort(), [0, 2])
})

test('a RING survives a single cut (loop reroutes — 9 of 10 remain)', () => {
  const { tiles } = layout(mk(Array(9).fill(2), 1)) // the 10-rosette (curls closed)
  const adj = routeGraph(tiles)
  assert.equal(tiles.length, 10)
  const alive = reachableFrom(adj, new Set([5]))    // kill a middle tile
  assert.equal(alive.size, 9)                        // all the rest still connected
})

test('an OPEN CHAIN cut orphans everything downstream', () => {
  const { tiles } = layout(mk([2, 2, 2, 2], 1))     // 5-tile chain
  const adj = routeGraph(tiles)
  const alive = reachableFrom(adj, new Set([2]))     // cut the middle
  assert.deepEqual([...alive].sort((a, b) => a - b), [0, 1])
})

test('tile-0 death destroys the whole unit', () => {
  const { tiles } = layout(mk([2, 2, 2, 2], 1))
  const adj = routeGraph(tiles)
  assert.equal(reachableFrom(adj, new Set([0])).size, 0)
})

test('aliveTiles reads current tileHp and sheds orphans', () => {
  const u = makeUnit(mk([2, 2, 2, 2], 1)) // 5-tile chain
  assert.equal(aliveTiles(u).size, 5)      // all full
  u.tileHp[2] = 0                          // middle tile destroyed
  const alive = aliveTiles(u)
  assert.deepEqual([...alive].sort((a, b) => a - b), [0, 1]) // 3,4 shed off with 2
  u.tileHp[0] = 0                          // core destroyed
  assert.equal(aliveTiles(u).size, 0)
})

// ── SHAPE PAYOUTS — the topology tech tree. holeList entries are minimal
//    {shape, cx, cy} stand-ins (shapePayout only reads those two fields). ──
const h = (shape, cx = 0, cy = 0) => ({ shape, cx, cy })
test('shapePayout applies the proven ladder (no choice made = default behavior)', () => {
  const base = shapePayout([])
  assert.equal(base.hpMul, 1); assert.equal(base.powerBonus, 0); assert.equal(base.hangars, 0); assert.equal(base.star, false)
  assert.equal(shapePayout([h('diamond')]).hpMul, 1.15)
  assert.ok(Math.abs(shapePayout([h('diamond', 0, 0), h('diamond', 1, 1)]).hpMul - 1.3225) < 1e-9) // stacks
  assert.equal(shapePayout([h('moon')]).powerBonus, 3)
  assert.equal(shapePayout([h('bay', 0, 0), h('bay', 1, 1)]).hangars, 2)
  assert.equal(shapePayout([h('star')]).star, true)
})

test('a per-shape-instance CHOICE overrides that one shape\'s default effect', () => {
  const diamond = h('diamond', 2, 3)
  const picked = shapePayout([diamond], { [holeKey(diamond)]: 'reflect' })
  assert.ok(Math.abs(picked.hpMul - 1.08) < 1e-9, 'REFLECT gives +8% HP, not +15%')
  assert.equal(picked.reflective, true, 'REFLECT flags the unit as reflective')

  const moon = h('moon', 5, -1)
  const cell = shapePayout([moon], { [holeKey(moon)]: 'cell' })
  assert.equal(cell.powerBonus, 0, 'CELL does not grant the default +3 power')
  assert.equal(cell.battery, 12, 'CELL grants +12 battery instead')

  const bay = h('bay', -4, 2)
  const mend = shapePayout([bay], { [holeKey(bay)]: 'mend' })
  assert.equal(mend.hangars, 0, 'MEND does not grant the default hangar')
  assert.ok(mend.regenRate > 0, 'MEND grants passive regen instead')

  // an UNCHOSEN diamond elsewhere on the same ship keeps its default
  const untouched = h('diamond', 9, 9)
  const mixed = shapePayout([diamond, untouched], { [holeKey(diamond)]: 'reflect' })
  assert.ok(Math.abs(mixed.hpMul - 1.08 * 1.15) < 1e-9, 'only the CHOSEN instance is overridden')
})

test('per-tile max HP is durability × the shape hpMul, rounded', () => {
  // no holes → hpMul 1 → per-tile max = raw durability
  const plain = makeUnit(mk([2, 2], 2))
  const per = statOf(2).durability
  assert.equal(plain.hpMul, 1)
  assert.equal(plain.tileMaxHp[0], per)
  // the diamond bonus (+15%) would raise it to round(durability·1.15)
  assert.equal(Math.round(per * 1.15), 46) // ARMOR 40 → 46 under one diamond
})

test('a sealed hull carries its shape list (the 10-rosette encloses a bay)', () => {
  const u = makeUnit(mk(Array(9).fill(2), 1))
  assert.equal(u.tiles.length, 10)
  assert.deepEqual(u.shapes, ['bay'])
  assert.equal(u.hangars, 1)
})

test('makeUnit attaches battle placement/ownership from opts', () => {
  const u = makeUnit(mk([2], 1), { seat: 3, owner: 3, x: 5, y: -2, a: 1.1 })
  assert.equal(u.seat, 3)
  assert.equal(u.owner, 3)
  assert.equal(u.x, 5)
  assert.equal(u.y, -2)
  assert.equal(u.a, 1.1)
})

test('makeUnit is robust to empty/degenerate designs', () => {
  // layout() always seeds an implicit base tile, so [] → a lone HULL (no thrust)
  const u = makeUnit([])
  assert.equal(u.tiles.length, 1)
  assert.equal(u.stats.speed, 0)
  assert.equal(u.stats.turn, 0)
  assert.equal(aliveTiles(u).size, 1)
  assert.equal(makeUnit(undefined).tiles.length, 1) // undefined design guarded too
})

test('hull.mjs imports only the tested foundations (inlinable into PRELUDE)', () => {
  const src = readFileSync(join(here, '../hull.mjs'), 'utf8')
  const imports = [...src.matchAll(/^\s*import\s.*from\s*'([^']+)'/gm)].map((m) => m[1])
  assert.deepEqual(imports.sort(), ['./parts.mjs', './penta-core.mjs', './penta-holes.mjs'])
})
