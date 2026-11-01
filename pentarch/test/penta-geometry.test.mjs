// penta-geometry — the geometry modules against recorded truth, plus the law
// that every inlined copy (battle-engine.js GEOMETRY section, base/hook.js) is
// GENERATED from penta-core.mjs / penta-holes.mjs and never drifts from them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { APOTHEM, CIRCUM, attachPose, overlaps, layout, contacts, freeEdges, voids, edgeNormalAngle } from '../penta-core.mjs'
import { holes, classify } from '../penta-holes.mjs'

const here = (f) => new URL(f, import.meta.url)
const read = (f) => readFileSync(here(f), 'utf8')
// the two builders strip differently; mirror each exactly
const stripEngine = (src) => src.split('\n').filter(l => !/^import /.test(l)).join('\n').replace(/^export function /gm, 'function ').replace(/^export const /gm, 'const ')   // build-engine-v2.mjs
const stripHook = (src) => src.replace(/^[ \t]*import\b.*$/gm, '').replace(/^([ \t]*)export\s+/gm, '$1')                                                                       // base/build-base.mjs
const ring = (n) => layout([{ part: 'hull' }, ...Array.from({ length: n - 1 }, (_, k) => ({ parent: k, edge: 2, part: 'hull' }))]).tiles

test('constants: unit-side regular pentagon', () => {
  assert.ok(Math.abs(APOTHEM - 1 / (2 * Math.tan(Math.PI / 5))) < 1e-15)
  assert.ok(Math.abs(CIRCUM - 1 / (2 * Math.sin(Math.PI / 5))) < 1e-15)
})

test('specimens: holes() reproduces every recorded shape exactly', () => {
  const spec = JSON.parse(read('../penta-specimens.json'))
  const sig = (h) => [h.shape, h.area, h.verts, h.spikes, h.reflex].join(':')
  for (const [name, s] of Object.entries(spec)) {
    assert.deepEqual(holes(s.tiles).map(sig).sort(), s.holes.map(sig).sort(), `specimen ${name}`)
  }
  assert.ok(Object.keys(spec).length >= 4, 'specimen file covers the four shapes')
})

test('touch law: flush is touching, a hair closer is overlap, every edge', () => {
  const base = { cx: 0.3, cy: -0.2, th: 0.4 }
  for (let e = 0; e < 5; e++) {
    const flush = attachPose(base, e)
    assert.equal(overlaps(base, flush), false, `edge ${e} flush`)
    const n = edgeNormalAngle(base, e)
    const closer = { ...flush, cx: base.cx + 2 * APOTHEM * 0.999 * Math.cos(n), cy: base.cy + 2 * APOTHEM * 0.999 * Math.sin(n) }
    assert.equal(overlaps(base, closer), true, `edge ${e} 0.1% closer`)
  }
  assert.equal(overlaps(base, { ...base, th: base.th + 1 }), true, 'coincident centres always overlap')
})

test('rosette: the same-edge chain closes into a 10-ring with one re-touch', () => {
  const tiles = ring(10)
  assert.equal(tiles.length, 10)
  const cs = contacts(tiles)
  assert.equal(cs.length, 10)
  assert.equal(cs.filter(c => c.retouch).length, 1)
  assert.equal(freeEdges(tiles).length, 30, '5 edges × 10 tiles − 2 per contact')
  const inner = holes(tiles)
  assert.equal(inner.length, 1, 'the ring encloses exactly one hole')
  assert.equal(inner[0].shape, 'bay')
})

test('flower: five 36° wedge voids, each pointing away from the base', () => {
  const flower = layout([{ part: 'hull' }, ...Array.from({ length: 5 }, (_, e) => ({ parent: 0, edge: e, part: 'hull' }))]).tiles
  const vs = voids(flower)
  assert.equal(vs.length, 5)
  for (const v of vs) {
    assert.equal(v.gapDeg, 36)
    assert.equal(v.tiles.length, 3)
    assert.ok(Math.abs(Math.hypot(v.dir.x, v.dir.y) - 1) < 1e-12, 'dir is a unit vector')
    assert.ok(v.x * v.dir.x + v.y * v.dir.y > 0, 'void opens outward from the flower centre')
  }
})

test('classify: a hole polygon is reported CCW with consistent counts', () => {
  const diamond = classify([{ x: 0, y: 0 }, { x: 1, y: -0.3 }, { x: 2, y: 0 }, { x: 1, y: 0.3 }])
  assert.equal(diamond.shape, 'diamond')
  assert.equal(diamond.spikes, 2)
  assert.equal(diamond.reflex, 0)
  assert.equal(diamond.verts, 4)
})

test('generated copies are in sync with the modules (rerun the builders if this fails)', () => {
  const eng = read('../battle-engine.js')
  const m = eng.match(/\/\/ ═+ GEOMETRY \([^\n]*\n([\s\S]*?)\/\/ ═+ end GEOMETRY ═+\n/)
  assert.ok(m, 'battle-engine.js has GEOMETRY markers')
  const want = stripEngine(read('../penta-core.mjs')) + '\n' + stripEngine(read('../penta-holes.mjs')) + '\n'
  assert.equal(m[1], want, 'battle-engine.js GEOMETRY ≠ penta-core + penta-holes → node pentarch/build-engine-v2.mjs')
  const hook = read('../base/hook.js')
  assert.ok(hook.includes(stripHook(read('../penta-core.mjs'))), 'base/hook.js lacks the current penta-core → node pentarch/base/build-base.mjs')
  assert.ok(!/const AP = 1 \/ \(2 \* Math\.tan/.test(hook), 'base/hook.js still carries a hand copy of the geometry')
})
