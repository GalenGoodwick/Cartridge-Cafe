// turret.test — arc-earned-by-placement laws: interior mounts are blind, tips
// see wide, contiguous free edges merge, traverse is rate-limited and clamped,
// firing needs aim+arc+range+cooldown. Run: node --test pentarch/test/turret.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layout } from '../penta-core.mjs'
import { arcOf, arcWidth, inArc, clampToArc, newMount, traverse, canFire, fire, cool, wrap, SECTOR_HALF } from '../turret.mjs'

const design = (seq) => {
  const d = [{ parent: -1, edge: -1, part: 'hull' }]
  for (const e of seq) d.push({ parent: d.length - 1, edge: e, part: 'hull' })
  return d
}
const tilesOf = (seq) => layout(design(seq)).tiles

test('single tile: all 5 edges free → full-circle arc', () => {
  const tiles = tilesOf([])
  const sectors = arcOf(tiles, 0)
  assert.equal(sectors.length, 5)
  assert.ok(Math.abs(arcWidth(sectors) - 2 * Math.PI) < 1e-9)
  for (let k = 0; k < 12; k++) assert.ok(inArc(sectors, (k / 12) * 2 * Math.PI - Math.PI))
})

test('tip of a chain: 4 free edges → 288° of sky', () => {
  const tiles = tilesOf([2, 2])
  const tip = arcOf(tiles, 2)
  assert.equal(tip.length, 4)
  assert.ok(Math.abs(arcWidth(tip) - 4 * 2 * SECTOR_HALF) < 1e-9)
})

test('mid-chain tile sees less than the tip (two contacts eat two sectors)', () => {
  const tiles = tilesOf([2, 2])
  assert.equal(arcOf(tiles, 1).length, 3)
})

test('the blocked direction is actually blocked', () => {
  const tiles = tilesOf([2])                       // tile 0 touches tile 1
  const s0 = arcOf(tiles, 0)
  // direction from tile 0 toward tile 1 = the used edge's normal — must be out of arc
  const toward = Math.atan2(tiles[1].cy - tiles[0].cy, tiles[1].cx - tiles[0].cx)
  assert.equal(inArc(s0, toward), false, 'cannot aim through your own hull neighbor')
  // the opposite direction is open
  assert.equal(inArc(s0, wrap(toward + Math.PI)), true)
})

test('clampToArc: inside stays, outside snaps to the nearest sector edge', () => {
  const tiles = tilesOf([2])
  const s0 = arcOf(tiles, 0)
  const toward = Math.atan2(tiles[1].cy - tiles[0].cy, tiles[1].cx - tiles[0].cx)
  const clamped = clampToArc(s0, toward)
  assert.ok(inArc(s0, clamped), 'clamped aim is legal')
  assert.ok(Math.abs(wrap(clamped - toward)) >= SECTOR_HALF - 1e-6, 'sits at the sector boundary, not inside the hull')
})

test('interior mount is blind: clamp has nothing to give', () => {
  // flower: base + 5 around it → tile 0 fully enclosed
  const tiles = tilesOf([])   // build by hand: 5 children on tile 0
  const d = [{ parent: -1, edge: -1, part: 'hull' }]
  for (let e = 0; e < 5; e++) d.push({ parent: 0, edge: e, part: 'hull' })
  const t2 = layout(d).tiles
  const s = arcOf(t2, 0)
  assert.equal(s.length, 0, 'no free edges, no arc')
  assert.equal(clampToArc(s, 1.0), null)
  assert.ok(tiles.length === 1)   // (sanity on the unused fixture)
})

test('traverse: rate-limited — cannot snap across the arc in one tick', () => {
  const tiles = tilesOf([])
  const m = newMount(tiles, 0, { rate: 1.0 })
  const start = m.aim
  traverse(m, wrap(start + Math.PI), 0.1)   // want 180° away, rate 1 rad/s, dt .1
  assert.ok(Math.abs(wrap(m.aim - start)) <= 0.1 + 1e-9, 'moved at most rate·dt')
})

test('traverse converges onto a legal target', () => {
  const tiles = tilesOf([])
  const m = newMount(tiles, 0, { rate: 3.0 })
  const target = 2.0
  for (let i = 0; i < 100; i++) traverse(m, target, 1 / 30)
  assert.ok(Math.abs(wrap(m.aim - target)) < 1e-6)
})

test('canFire: needs weapon + aim + arc + range + cooldown; fire() charges a price', () => {
  const tiles = tilesOf([2])
  const W = { range: 10, damage: 3, energyPerShot: 5, cooldown: 0.5 }
  const m = newMount(tiles, 0, { rate: 8, weapon: W })
  const toward = Math.atan2(tiles[1].cy - tiles[0].cy, tiles[1].cx - tiles[0].cx)
  const open = wrap(toward + Math.PI)
  for (let i = 0; i < 120; i++) traverse(m, open, 1 / 30)
  assert.equal(canFire(m, open, 5), true)
  assert.equal(canFire(m, open, 11), false, 'out of range')
  assert.equal(canFire(m, toward, 5), false, 'target parked behind own hull')
  const price = fire(m)
  assert.equal(price, 5)
  assert.equal(canFire(m, open, 5), false, 'cooling down')
  cool(m, 0.6)
  assert.equal(canFire(m, open, 5), true, 'cooled')
})

test('no weapon on the mount = a dead turret (never fires)', () => {
  const tiles = tilesOf([])
  const m = newMount(tiles, 0, {})
  assert.equal(canFire(m, m.aim, 1), false)
})
