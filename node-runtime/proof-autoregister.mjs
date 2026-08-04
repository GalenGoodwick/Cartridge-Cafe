// PROOF — auto-register (rung 3) makes node-design the DEFAULT and the veilfire
// weapons clobber impossible WITH ZERO MANUAL register_node.
//
// Drives the SHIPPED modules, not a toy:
//   render-service/node-autoregister.mjs  (the exact code space-store.ts calls on every add_step_hook)
//   render-service/node-order.mjs         (the run-order the 3 engine runners use)
//
// The clobber, mechanically: veilfire's base hook rebuilds gpuUniforms every frame
// (a computed-index loop that zeros the whole whiteboard). vf-weapons writes u69 (the
// active-slot lamp). If base runs AFTER weapons it zeros u69 → lamp dies. Re-pushing
// base moved it to the END of the run array → that's what shipped, ×3. Auto-register
// pins base's order the first time it's seen, so no re-push can move it again.

import assert from 'node:assert';
import { orderHooks } from '../render-service/node-order.mjs';
import { autoRegisterHook } from '../render-service/node-autoregister.mjs';
import { snapshotUni, recordViolations } from '../render-service/owns-guard.mjs';

// ── the two hooks, exactly as an AI would author them (code TEXT + its behavior) ──
const HOOKS = {
  'veilfire':   { code: 'for(let i=0;i<256;i++) u[i]=0; u[6]=1;', fn: (u) => { for (let i = 0; i < 256; i++) u[i] = 0; u[6] = 1; } },
  'vf-weapons': { code: 'u[69]=1;',                                fn: (u) => { u[69] = 1; } },
};

// ── mirror of space-store.ts add_step_hook: filter-replace, then AUTO-REGISTER ──
// This is the DEFAULT path. The AI calls add_step_hook. It never calls register_node.
function addHook(world, id) {
  world.stepHooks = world.stepHooks.filter((h) => h.id !== id);
  world.stepHooks.push({ id, code: HOOKS[id].code });
  autoRegisterHook(world.worldData, id, HOOKS[id].code);   // ← the only new line in the engine
}
function runFrame(world, guard) {
  const ordered = orderHooks(world.stepHooks, world.worldData);
  const u = new Float32Array(256), viol = new Map();
  for (const h of ordered) {
    const before = guard ? snapshotUni(u) : null;
    HOOKS[h.id].fn(u);
    if (guard) {
      const owns = world.worldData.__nodes[h.id]?.owns?.uni || [];
      recordViolations(viol, before, u, owns, h.id, 0);
    }
  }
  return { u69: u[69], run: ordered.map((h) => h.id), viol: [...viol.values()] };
}

let pass = 0, fail = 0;
const ok = (name, cond) => { console.log(`  ${cond ? '✓' : '✗ FAIL'}  ${name}`); cond ? pass++ : fail++; };

console.log('\n── A · the AI builds the world the DEFAULT way (add_step_hook, NO register_node) ──');
const world = { stepHooks: [], worldData: {} };
addHook(world, 'veilfire');
addHook(world, 'vf-weapons');
const N = world.worldData.__nodes;
ok(`base auto-registered as a node (order ${N['veilfire'].order}, auto:${N['veilfire'].auto})`, N['veilfire'].auto === true);
ok(`weapons auto-registered as a node (order ${N['vf-weapons'].order}, auto:${N['vf-weapons'].auto})`, N['vf-weapons'].auto === true);
ok(`insertion order preserved: base.order(${N['veilfire'].order}) < weapons.order(${N['vf-weapons'].order}) — legacy-neutral`, N['veilfire'].order < N['vf-weapons'].order);
ok(`owns INFERRED from code (no human): weapons owns u69 → ${JSON.stringify(N['vf-weapons'].owns.uni)}`, JSON.stringify(N['vf-weapons'].owns.uni) === '[[69,69]]');
{ const { u69 } = runFrame(world); ok(`fresh world renders the lamp: u69 = ${u69}`, u69 === 1); }

console.log('\n── B · re-push base 10× (the exact move that clobbered us ×3) — order must not budge ──');
{
  let stable = true, survives = true;
  const order0 = N['veilfire'].order;
  for (let k = 1; k <= 10; k++) {
    addHook(world, 'veilfire');                       // re-push, the DEFAULT way
    const same = N['veilfire'].order === order0;
    const { u69, run } = runFrame(world);
    stable &&= same; survives &&= (u69 === 1);
    if (k <= 3 || k === 10) console.log(`     re-push #${k}: base.order=${N['veilfire'].order} · run [${run.join(', ')}] · u69=${u69}`);
  }
  ok('base.order NEVER changed across 10 re-pushes (idempotent order)', stable);
  ok('weapons lamp SURVIVED every re-push — the clobber is impossible by default (AT-3)', survives);
}

console.log('\n── C · falsify: turn auto-register OFF (raw push order) → the clobber returns ──');
{
  // no worldData.__nodes → orderHooks is a no-op → run order == raw stepHooks array,
  // and "base re-pushed last" is [weapons, base] → base zeros u69.
  const raw = { stepHooks: [{ id: 'vf-weapons' }, { id: 'veilfire' }], worldData: {} };
  const { u69 } = runFrame(raw);
  ok(`without the node substrate, re-pushed base runs last → u69 = ${u69} (CLOBBERED — proves the fix is load-bearing)`, u69 === 0);
}

console.log('\n── D · the auto-inferred owns still powers the guard (AT-2, no human ranges) ──');
{
  // run the world but force the BUG order to show the guard catches base's out-of-range
  // u69 write using the range auto-register INFERRED, not one a human typed.
  const bug = { stepHooks: [{ id: 'vf-weapons' }, { id: 'veilfire' }],
    worldData: { __nodes: { 'veilfire': N['veilfire'], 'vf-weapons': N['vf-weapons'] }, __nodeSeq: 20 } };
  // (bug order forced by giving base a higher order for this check)
  bug.worldData.__nodes = { 'veilfire': { ...N['veilfire'], order: 999 }, 'vf-weapons': N['vf-weapons'] };
  const { viol } = runFrame(bug, true);
  const hit = viol.find((v) => v.node === 'veilfire' && v.index === 69);
  ok(`guard flagged base changing u69 out of its INFERRED range ${JSON.stringify(N['veilfire'].owns.uni)}: ${hit ? 'yes' : 'no'}`, !!hit);
}

console.log(`\n${fail === 0 ? 'PROVEN' : 'DISPROVEN'} — ${pass} passed, ${fail} failed`);
console.log('Claim: adding hooks the ordinary way auto-registers them; no re-push can reorder a node;');
console.log('so the weapons clobber cannot happen without any manual register_node. Falsifiable — C shows');
console.log('the bug returns the moment the substrate is removed, and any B row failing would disprove it.\n');
process.exit(fail ? 1 : 0);
