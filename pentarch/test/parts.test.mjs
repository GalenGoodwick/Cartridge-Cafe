// parts.test — verifies parts.mjs is a FAITHFUL port of the v9 shipyard source
// (backlog/parts/v9-parts.json) and that statOf/partOf resolve correctly.
// Node's built-in runner: `node --test pentarch/test/parts.test.mjs`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PARTS, PALETTE, CATEGORIES, statOf, partOf } from '../parts.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const v9 = JSON.parse(readFileSync(join(here, '../backlog/parts/v9-parts.json'), 'utf8'))
const HOOK = v9.hook, VIS = v9.vis

// pull the source-of-truth literals straight out of the frozen v9 hook/visual
function objLits(src, name) {
  const m = src.match(new RegExp(name + '\\s*=\\s*\\{([^}]*)\\}'))
  if (!m) throw new Error('missing ' + name)
  const out = {}
  for (const pair of m[1].split(',')) {
    const mm = pair.match(/(\d+)\s*:\s*(.+)/)
    if (mm) out[+mm[1]] = mm[2].trim()
  }
  return out
}
const COST = objLits(HOOK, 'COST')            // { 0:'0', 1:'10', ... }
const STAT = {}                               // { 0:[0.5,4,0,0,0], ... } (array-valued)
{
  const body = HOOK.match(/STAT\s*=\s*\{([\s\S]*?)\}\s*\n/)[1]
  for (const m of body.matchAll(/(\d+)\s*:\s*(\[[^\]]*\])/g)) STAT[+m[1]] = JSON.parse(m[2])
}
const HPB = objLits(HOOK, 'HPB')              // battle durability
const NAME = HOOK.match(/NAME\s*=\s*\[([^\]]*)\]/)[1]
  .split(',').map(s => s.trim().replace(/^'|'$/g, ''))
const py_col = {}
for (const m of VIS.matchAll(/part\s*==\s*(\d+)\)\s*\{\s*return\s*vec3f\(([^)]*)\)/g)) {
  py_col[+m[1]] = m[2].split(',').map(Number)
}
py_col[0] = VIS.match(/return vec3f\(([^)]*)\);\s*\/\/ *blank/)[1].split(',').map(Number)

test('PARTS has all six codes 0..5, indexed by code', () => {
  assert.equal(PARTS.length, 6)
  PARTS.forEach((p, i) => assert.equal(p.code, i))
})

test('COST matches the v9 hook COST table', () => {
  for (const p of PARTS) assert.equal(p.cost, Number(COST[p.code]), 'cost ' + p.name)
})

test('names match the v9 NAME array', () => {
  for (const p of PARTS) assert.equal(p.name, NAME[p.code], 'name ' + p.code)
})

test('design-STAT vectors match v9 STAT = [mass,hp,dps,thrust,energy]', () => {
  for (const p of PARTS) {
    assert.deepEqual([p.stat.mass, p.stat.hp, p.stat.dps, p.stat.thrust, p.stat.energy], STAT[p.code], 'stat ' + p.name)
  }
})

test('battle durability (hp) matches v9 HPB', () => {
  for (const p of PARTS) assert.equal(p.hp, Number(HPB[p.code]), 'hp ' + p.name)
})

test('colors match the shader py_col', () => {
  for (const p of PARTS) {
    py_col[p.code].forEach((c, k) => assert.ok(Math.abs(p.color[k] - c) < 1e-6, 'color ' + p.name + '[' + k + ']'))
  }
})

test('PALETTE assigns slots 0..4 → part codes 1..5 (v9 s+1 rule)', () => {
  assert.deepEqual(PALETTE, [1, 2, 3, 4, 5])
  assert.equal(CATEGORIES.length, PALETTE.length)
  PALETTE.forEach((code, slot) => assert.equal(PARTS[code].category, CATEGORIES[slot], 'slot ' + slot))
})

test('statOf resolves a numeric code to its stat bundle', () => {
  const g = statOf(3)
  assert.deepEqual(
    { mass: g.mass, hp: g.hp, dps: g.dps, thrust: g.thrust, energy: g.energy },
    { mass: 1.5, hp: 8, dps: 6, thrust: 0, energy: -2 })
  assert.equal(g.durability, 12)
  assert.equal(g.cost, 30)
  assert.equal(g.name, 'GUN')
  assert.equal(g.category, 'GUNS')
})

test('statOf accepts a name (any case) and a design entry {part}', () => {
  assert.equal(statOf('gun').code, 3)
  assert.equal(statOf('ARMOR').code, 2)
  assert.equal(statOf({ part: 5 }).code, 5)
})

test('partOf never throws on junk — falls back to BLANK (code 0)', () => {
  assert.equal(partOf(undefined).code, 0)
  assert.equal(partOf(99).code, 0)
  assert.equal(partOf('nonsense').code, 0)
  assert.equal(partOf(null).code, 0)
})

test('parts.mjs has no imports (inlinable into PRELUDE)', () => {
  const src = readFileSync(join(here, '../parts.mjs'), 'utf8')
  assert.equal(/^\s*import\s/m.test(src), false)
})
