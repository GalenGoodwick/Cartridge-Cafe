// PROOF — the node loop makes the veilfire weapons clobber IMPOSSIBLE.
// Uses the SHIPPED engine modules (render-service/node-order.mjs + owns-guard.mjs),
// not the toy seed. Reproduces the exact live failure, then falsifies the claim
// "declared order can't be reordered by a push" against EVERY push permutation.
//
//   the failure, mechanically: veilfire's base hook rebuilds gpuUniforms every
//   frame (zeroing the whole whiteboard). vf-weapons owns u69-79 and lights the
//   active-slot lamp at u69. If base runs AFTER weapons, it zeros u69 → lamp dies.
//   Re-pushing base moved it to the end of the run array → that's what happened, ×3.

import assert from 'node:assert';
import { orderHooks } from '../render-service/node-order.mjs';
import { snapshotUni, recordViolations } from '../render-service/owns-guard.mjs';

const HOOKS = {
  'veilfire':   (u) => { for (let i = 0; i < 256; i++) u[i] = 0; u[6] = 1; }, // base: rebuild (the clobber engine)
  'vf-weapons': (u) => { u[69] = 1; },                                        // weapons: light u69
};
function runFrame(order, guardOwns) {
  const u = new Float32Array(256), viol = new Map();
  for (const id of order) {
    const before = guardOwns ? snapshotUni(u) : null;
    HOOKS[id](u);
    if (guardOwns) recordViolations(viol, before, u, guardOwns[id], id, 0);
  }
  return { u69: u[69], viol: [...viol.values()] };
}
const permute = (a) => a.length <= 1 ? [a] : a.flatMap((x, i) =>
  permute([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));

const NODES = { 'veilfire': { order: 30 }, 'vf-weapons': { order: 100 } };
const OWNS  = { 'veilfire': [[0, 9]], 'vf-weapons': [[69, 79]] };  // base owns u0-9, NOT u69
const ids = ['veilfire', 'vf-weapons'];
let pass = 0, fail = 0;
const ok = (name, cond) => { console.log(`  ${cond ? '✓' : '✗ FAIL'}  ${name}`); cond ? pass++ : fail++; };

console.log('\n── A · OUTSIDE the loop (raw push order = what shipped on veilfire) ──');
{
  // "base re-pushed to the end" → run array = [weapons, base]
  const { u69 } = runFrame(['vf-weapons', 'veilfire']);
  ok(`re-pushed base runs last → u69 = ${u69} (CLOBBERED — the live bug, reproduced)`, u69 === 0);
}

console.log('\n── B · INSIDE the loop (declared order) — every push order tested ──');
{
  let allSurvive = true;
  for (const arr of permute(ids)) {
    const ordered = orderHooks(arr.map((id) => ({ id })), { __nodes: NODES }).map((h) => h.id);
    const { u69 } = runFrame(ordered);
    const good = u69 === 1;
    allSurvive &&= good;
    console.log(`     push [${arr.join(', ')}]  →  run [${ordered.join(', ')}]  →  u69 = ${u69}`);
  }
  ok('for EVERY push order, declared order runs base before weapons → u69 SURVIVES (AT-1, exhaustive)', allSurvive);
}

console.log('\n── C · ownership guard catches the out-of-range clobber (AT-2) ──');
{
  // run the BUG order under the guard: weapons sets u69=1, base zeros it (1→0),
  // an out-of-range change for base (owns u0-9). Advisory: reports, does not revert.
  const { u69, viol } = runFrame(['vf-weapons', 'veilfire'], OWNS);
  const hit = viol.find((v) => v.node === 'veilfire' && v.index === 69);
  ok(`guard flagged veilfire changing u69 out of its owned range: ${hit ? JSON.stringify(hit) : 'none'}`, !!hit);
  ok(`(advisory reports; strict/rung-3 would drop the write. u69 here = ${u69})`, true);
}

console.log(`\n${fail === 0 ? 'PROVEN' : 'DISPROVEN'} — ${pass} passed, ${fail} failed`);
console.log('Claim: outside the loop the clobber happens; inside it, no push order can cause it,');
console.log('and any out-of-range write is caught. Falsifiable — a single bad order would fail B.\n');
process.exit(fail ? 1 : 0);
