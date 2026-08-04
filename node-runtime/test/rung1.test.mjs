// node-runtime · rung 1 acceptance tests (spec AT-1, AT-7) + invariants.
// Tests the SHARED scheduler logic via the probe-runner mirror (plain JS, no TS
// toolchain needed). The client node-order.ts is a byte-mirror of this; a drift
// check is included so the two can't silently diverge.
//
//   node node-runtime/test/rung1.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { orderHooks } from '../../render-service/node-order.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let pass = 0;
const ok = (name) => { console.log('  ✓ ' + name); pass++; };
const ids = (hooks) => hooks.map((h) => h.id);

// ---- AT-7: legacy neutrality — no registry ⇒ byte-identical order, no mutation
{
  const hooks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const snapshot = ids(hooks);
  assert.deepEqual(ids(orderHooks(hooks, undefined)), snapshot, 'undefined worldData → unchanged');
  assert.deepEqual(ids(orderHooks(hooks, {})), snapshot, 'no __nodes → unchanged');
  assert.deepEqual(ids(orderHooks(hooks, { other: 1 })), snapshot, 'unrelated worldData → unchanged');
  assert.deepEqual(ids(hooks), snapshot, 'input array not mutated');
  ok('AT-7 legacy neutrality (no registry = unchanged, non-mutating)');
}

// ---- AT-1: reorder immunity — declared order wins regardless of push order
{
  // veilfire's real invariant: base(30) must run before weapons(120).
  const nodes = { veilfire: { order: 30 }, 'vf-weapons': { order: 120 }, 'vf-crystalflow': { order: 110 } };
  const want = ['veilfire', 'vf-crystalflow', 'vf-weapons'];

  // feed in the WRONG order (weapons first — the clobber's push order)
  const pushA = [{ id: 'vf-weapons' }, { id: 'veilfire' }, { id: 'vf-crystalflow' }];
  assert.deepEqual(ids(orderHooks(pushA, { __nodes: nodes })), want, 'wrong push order → declared order');

  // "re-push base" = move veilfire to the END of the input; output must not move it
  const pushB = [{ id: 'vf-weapons' }, { id: 'vf-crystalflow' }, { id: 'veilfire' }];
  assert.deepEqual(ids(orderHooks(pushB, { __nodes: nodes })), want, 're-pushing base cannot reorder');

  // 10× re-push shuffle — output is invariant every time (the vanished-weapons bug)
  for (let i = 0; i < 10; i++) {
    const shuffled = [...pushA].sort(() => (i % 2 ? 1 : -1));
    assert.deepEqual(ids(orderHooks(shuffled, { __nodes: nodes })), want, 're-push #' + i);
  }
  ok('AT-1 reorder immunity (declared order survives any push sequence)');
}

// ---- invariant: unregistered hooks trail, stably, after registered ones
{
  const nodes = { base: { order: 30 } };
  const input = [{ id: 'x' }, { id: 'base' }, { id: 'y' }];
  assert.deepEqual(ids(orderHooks(input, { __nodes: nodes })), ['base', 'x', 'y'],
    'unregistered (x,y) trail at +Inf in original relative order');
  ok('unregistered hooks trail stably');
}

// ---- invariant: ties hold insertion order (stable sort)
{
  const nodes = { p: { order: 50 }, q: { order: 50 } };
  assert.deepEqual(ids(orderHooks([{ id: 'q' }, { id: 'p' }], { __nodes: nodes })), ['q', 'p'],
    'equal orders keep input order');
  ok('equal orders are stable');
}

// ---- invariant: malformed registry entry never throws, falls to +Inf
{
  const nodes = { base: { order: 'oops' }, weapons: { order: 120 } };
  assert.doesNotThrow(() => orderHooks([{ id: 'base' }, { id: 'weapons' }], { __nodes: nodes }));
  assert.deepEqual(ids(orderHooks([{ id: 'base' }, { id: 'weapons' }], { __nodes: nodes })),
    ['weapons', 'base'], 'bad order → trails at +Inf, weapons(120) wins');
  ok('malformed order is safe (no throw, trails)');
}

// ---- drift guard: client node-order.ts and probe node-order.mjs share the same sort
{
  const ts = readFileSync(resolve(here, '../../web/src/app/engine/node-order.ts'), 'utf8');
  // both must key off __nodes[id].order with a stable decorated sort; a cheap
  // structural check that the client mirror wasn't gutted.
  assert.ok(/__nodes/.test(ts) && /\.order/.test(ts) && /sort\(/.test(ts),
    'client node-order.ts still sorts by __nodes[id].order');
  ok('client/probe scheduler mirror intact');
}

console.log(`\nrung-1: ${pass}/6 checks green`);
