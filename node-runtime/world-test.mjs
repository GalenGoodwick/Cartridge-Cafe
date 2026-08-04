// Headless proof: the LAYERED owner buffer resolves pixel → source across 3D + 2D.
// Ticks the same scene as world-main.js, then asserts owner[x,y] → the right node.
import { Registry } from './core/registry.js';
import { State } from './core/state.js';
import { Frame } from './core/frame.js';
import { Scheduler } from './core/scheduler.js';
import { render3dNode } from './nodes/render3d.js';

const W = 320, H = 200;
const reg = new Registry(), state = new State(256, 'advisory'), frame = new Frame(W, H), sched = new Scheduler(reg, state);
const PROV = [];
const live = (rec) => { const idx = PROV.length; PROV.push(null); const n = reg.register(Object.assign({ status: 'live', idx }, rec)); PROV[idx] = n; return n; };

const floor  = live({ id: 'w3.floor',  kind: 'geometry', order: 5, layer: '3D world', run: () => {} });
const orb    = live({ id: 'w3.orb',    kind: 'geometry', order: 5, layer: '3D world', run: () => {} });
const pillar = live({ id: 'w3.pillar', kind: 'geometry', order: 5, layer: '3D world', run: () => {} });
live(render3dNode({ 'w3.floor': floor.idx, 'w3.orb': orb.idx, 'w3.pillar': pillar.idx }));
const uiHud  = live({ id: 'ui.hud',     kind: 'render', order: 200, layer: '2D UI', run: ({ frame, node }) => { const g = frame.painter(node.idx); g.rect(0, Math.floor(H * 0.82), W, H, 20, 26, 36, 0.92); } });
const btnFire = live({ id: 'ui.btn.fire', kind: 'render', order: 210, layer: '2D UI', run: ({ frame, node }) => { const g = frame.painter(node.idx); g.rect(24, Math.floor(H * 0.86), 60, 22, 180, 70, 50); } });

sched.tick({ frame, t: 0, dt: 1 / 60 });
const at = (x, y) => { const idx = frame.owner[y * W + x]; return idx >= 0 ? PROV[idx].id : 'sky'; };

let pass = 0, fail = 0;
const ok = (name, cond, got) => { console.log(`  ${cond ? 'ok ' : 'FAIL'} ${name}  → ${got}`); cond ? pass++ : fail++; };
console.log('LAYERED owner buffer — pixel → source (3D world under, 2D UI on top):\n');

// 3D WORLD layer: raymarched surfaces resolve to their geometry node
ok('center-ish → the orb (3D)',  at(127, 118) === 'w3.orb',   at(127, 118));
ok('right column → the pillar (3D)', at(200, 107) === 'w3.pillar', at(200, 107));
ok('lower band → the floor (3D)', at(160, 150) === 'w3.floor', at(160, 150));
ok('top → sky (unowned)',        at(160, 20) === 'sky',      at(160, 20));

// 2D UI layer on top: buttons/panel OVERWRITE the world owner where opaque
ok('FIRE button pixel → ui.btn.fire (2D over 3D)', at(50, Math.floor(H * 0.86) + 10) === 'ui.btn.fire', at(50, Math.floor(H * 0.86) + 10));
ok('HUD strip (not a button) → ui.hud (2D)',       at(250, Math.floor(H * 0.86) + 10) === 'ui.hud',     at(250, Math.floor(H * 0.86) + 10));

// the KEY property: the SAME click resolver reads one owner buffer for both layers.
const worldPixels = [[127,118],[200,107],[160,150]].map(([x,y]) => at(x,y));
const uiPixels    = [[50, Math.floor(H*0.86)+10],[250, Math.floor(H*0.86)+10]].map(([x,y]) => at(x,y));
ok('unified: world pixels are 3D nodes, UI pixels are 2D nodes, one buffer',
   worldPixels.every(p => p.startsWith('w3.')) && uiPixels.every(p => p.startsWith('ui.')),
   `world=${worldPixels.join(',')} ui=${uiPixels.join(',')}`);

console.log(`\n${fail === 0 ? 'PROVEN' : 'FAILED'} — ${pass}/${pass + fail}. One owner buffer; click resolves 3D world OR 2D UI, no layer logic.`);
process.exit(fail ? 1 : 0);
