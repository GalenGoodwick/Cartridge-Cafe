// node-runtime · rung 2 — advisory ownership-guard tests (spec AT-2 core + AT-3-adjacent).
// Tests the pure diff primitive. The probe-runner splice (snapshot per node →
// ownershipDiff → render_probe.ownershipViolations) wires this in; the load-bearing
// logic is proven here first (proper-always).
//
//   node node-runtime/test/rung2.test.mjs
import assert from 'node:assert/strict';
import { inRanges, snapshotUni, ownershipDiff, recordViolations } from '../../render-service/owns-guard.mjs';

let pass = 0;
const ok = (name) => { console.log('  ✓ ' + name); pass++; };

// veilfire's real ownership: base owns the sim/camera slots, weapons owns u69–79.
const BASE_OWNS = [[0, 8], [15, 17], [240, 247]];
const WEAPONS_OWNS = [[69, 79]];

// ---- inRanges basics
{
  assert.equal(inRanges(70, WEAPONS_OWNS), true, '70 in [69,79]');
  assert.equal(inRanges(69, WEAPONS_OWNS), true, 'inclusive low');
  assert.equal(inRanges(79, WEAPONS_OWNS), true, 'inclusive high');
  assert.equal(inRanges(68, WEAPONS_OWNS), false, 'below');
  assert.equal(inRanges(80, WEAPONS_OWNS), false, 'above');
  assert.equal(inRanges(245, BASE_OWNS), true, 'multi-range hit');
  assert.equal(inRanges(100, BASE_OWNS), false, 'multi-range miss');
  assert.equal(inRanges(5, undefined), false, 'no ranges = owns nothing');
  ok('inRanges — inclusive, multi-range, empty-safe');
}

// ---- in-range write is silent
{
  const prev = new Float32Array(256);
  const next = prev.slice(); next[70] = 1.0; next[75] = 3.0; // weapons writes its own slots
  assert.deepEqual(ownershipDiff(prev, next, WEAPONS_OWNS, 'vf-weapons', 42), [],
    'weapons writing u70/u75 → no violation');
  ok('in-range writes are silent');
}

// ---- out-of-range write is logged (advisory)
{
  const prev = new Float32Array(256);
  const next = prev.slice(); next[5] = 9.0; // weapons stomps a base slot
  assert.deepEqual(ownershipDiff(prev, next, WEAPONS_OWNS, 'vf-weapons', 42),
    [{ node: 'vf-weapons', index: 5, frame: 42 }],
    'weapons writing u5 → one violation at index 5');
  ok('out-of-range write is logged with {node,index,frame}');
}

// ---- THE clobber: base rebuilds the whole frame and stomps u69–79 (the vanished weapons)
{
  const prev = new Float32Array(256);
  for (let i = 60; i < 90; i++) prev[i] = 7; // weapons had written its band earlier this frame
  const next = new Float32Array(256);         // base does a whole-array rebuild → zeros u69–79
  for (let i = 60; i < 90; i++) if (i < 69 || i > 79) next[i] = 7; // only the weapons band gets stomped
  const viol = ownershipDiff(prev, next, BASE_OWNS, 'veilfire', 100);
  const stomped = viol.filter((v) => v.index >= 69 && v.index <= 79).map((v) => v.index);
  assert.deepEqual(stomped, [69,70,71,72,73,74,75,76,77,78,79],
    'base rebuild that wipes u69–79 → all 11 slots flagged as violations');
  assert.ok(viol.every((v) => v.node === 'veilfire' && v.frame === 100), 'attributed to base@frame100');
  ok('AT-2 core: whole-array rebuild wiping u69–79 is caught (the weapons clobber)');
}

// ---- NaN is not a phantom write
{
  const prev = new Float32Array([NaN, 1, 2]);
  const next = new Float32Array([NaN, 1, 2]);
  assert.deepEqual(ownershipDiff(prev, next, [], 'n', 1), [], 'NaN→NaN unchanged (no phantom violation)');
  const next2 = new Float32Array([5, 1, 2]);
  assert.deepEqual(ownershipDiff(prev, next2, [], 'n', 1), [{ node: 'n', index: 0, frame: 1 }], 'NaN→5 is a write');
  ok('NaN handled (NaN→NaN silent, NaN→value logged)');
}

// ---- array growth: a node that appends new slots outside its band is flagged
{
  const prev = new Float32Array(8);
  const next = new Float32Array(12); next[10] = 1; // grew + wrote u10
  assert.deepEqual(ownershipDiff(prev, next, [[0, 7]], 'g', 3), [{ node: 'g', index: 10, frame: 3 }],
    'appended out-of-range slot flagged');
  ok('array growth outside owns is caught');
}

// ---- snapshot is an independent copy (mutating live uni does not change the snapshot)
{
  const uni = new Float32Array([1, 2, 3]);
  const snap = snapshotUni(uni);
  uni[0] = 99;
  assert.equal(snap[0], 1, 'snapshot decoupled from live array');
  assert.equal(snapshotUni(null), null, 'null-safe');
  ok('snapshotUni is an independent, null-safe copy');
}

// ---- recordViolations: dedup by node|index across ticks, keep first frame + count
{
  const map = new Map();
  const owns = [[0, 7]];
  for (const frame of [5, 6, 7]) {           // same node stomps u70 on three ticks
    const prev = new Float32Array(80);
    const next = prev.slice(); next[70] = frame;
    recordViolations(map, prev, next, owns, 'g', frame);
  }
  const rows = [...map.values()];
  assert.equal(rows.length, 1, 'one deduped row for node g index 70');
  assert.deepEqual(rows[0], { node: 'g', index: 70, frame: 5, count: 3 }, 'first frame kept, count=3');
  ok('recordViolations dedups by node|index (first frame + count)');
}

console.log(`\nrung-2 guard: ${pass}/8 checks green`);
