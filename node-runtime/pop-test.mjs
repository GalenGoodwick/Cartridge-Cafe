// Proof: ENTITY-LEVEL provenance — one field, N parts, click resolves the SPECIFIC part.
// This is pentarch's need: the ship is one field of many part-entities; clicking a
// part must resolve to THAT part's source, not "the ship field".
import { Registry } from './core/registry.js';
import { State } from './core/state.js';
import { Frame } from './core/frame.js';
import { Scheduler } from './core/scheduler.js';
import { shipParts, renderPopNode } from './nodes/render-pop.js';

const W = 240, H = 150;
const reg = new Registry(), state = new State(256, 'advisory'), frame = new Frame(W, H), sched = new Scheduler(reg, state);
const PROV = [];
const register = (rec) => { const idx = PROV.length; PROV.push(null); const n = reg.register(Object.assign({ status: 'live', idx }, rec)); PROV[idx] = n; return n; };

const parts = shipParts(register);
register(renderPopNode(parts));
sched.tick({ frame, t: 0, dt: 1 / 60 });

const at = (fx, fy) => { const idx = frame.owner[(Math.floor(fy * H)) * W + Math.floor(fx * W)]; return idx >= 0 ? PROV[idx] : null; };
let pass = 0, fail = 0;
const ok = (n, c, got) => { console.log(`  ${c ? 'ok ' : 'FAIL'} ${n}  → ${got}`); c ? pass++ : fail++; };
console.log('ENTITY-LEVEL provenance — one field, N parts, click the specific part:\n');

// each part center resolves to THAT part's node (not "the field")
const core = at(0.50, 0.55), gun = at(0.50, 0.40), engine = at(0.50, 0.70), armorL = at(0.30, 0.42);
ok('click center → the CORE part', core?.id.endsWith('core'), core?.id);
ok('click top → the GUN part',     gun?.id.endsWith('gun'),   gun?.id);
ok('click bottom → the ENGINE part', engine?.id.endsWith('engine'), engine?.id);
ok('click upper-left → an ARMOR part', armorL?.id.includes('armor'), armorL?.id);
ok('the GUN carries its CODE + candidate', gun?.prov?.code?.includes('turret') && !!gun?.prov?.cand,
   `${gun?.prov?.code} · cand=${gun?.prov?.cand?.node}`);
// the KEY property: distinct parts in ONE field resolve to DISTINCT sources
const distinct = new Set([core, gun, engine, armorL].map(p => p?.id)).size;
ok('4 clicks in one field → 4 distinct part sources', distinct === 4, distinct + ' distinct');
ok('background (no part) → nothing', at(0.05, 0.05) === null, String(at(0.05, 0.05)));

console.log(`\n${fail === 0 ? 'PROVEN' : 'FAILED'} — ${pass}/${pass + fail}. Per-ENTITY owner: one field, click resolves the exact part → its code. This is pentarch's ship-part provenance.`);
process.exit(fail ? 1 : 0);
