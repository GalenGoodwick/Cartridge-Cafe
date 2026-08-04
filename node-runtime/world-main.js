// world-main.js — PROVES the layered node-to-pixel pipeline (Galen's design):
//   3D WORLD (raymarched) underneath  +  2D UI (HUD) on top  =  ONE owner buffer.
// Click any pixel → owner[x,y] → node → source. Works across BOTH layers with no
// layer logic at the click: 2D draws after 3D, so the topmost thing owns the pixel.
import { Registry } from './core/registry.js';
import { State } from './core/state.js';
import { Frame } from './core/frame.js';
import { Scheduler } from './core/scheduler.js';
import { render3dNode } from './nodes/render3d.js';

const W = 320, H = 200;
const reg = new Registry();
const state = new State(256, 'advisory');
const frame = new Frame(W, H);
const sched = new Scheduler(reg, state);

// ---- provenance registry: idx -> node (the click resolver reads this) ----
const PROV = [];
const provNode = (idx) => PROV[idx];
const live = (rec) => { const idx = PROV.length; PROV.push(null); const n = reg.register(Object.assign({ status: 'live', idx }, rec)); PROV[idx] = n; return n; };

// ── 3D WORLD geometry nodes — each owns a MATERIAL + carries its code/provenance.
//    They don't paint directly; render.3d paints for them and stamps their idx.
const floor  = live({ id: 'w3.floor',  kind: 'geometry', order: 5, layer: '3D world', owns: { uni: [[50, 51]] },
  title: 'floor', detail: 'the ground plane', prov: { via: 'sdPlane(p, -1.0)', state: 'mat 0', means: 'the world floor', code: 'sdPlane(p,-1.0)', cand: null }, run: () => {} });
const orb    = live({ id: 'w3.orb',    kind: 'geometry', order: 5, layer: '3D world', owns: { uni: [[52, 53]] },
  title: 'the orb', detail: 'a sphere boss', prov: { via: 'sdSphere(c=[-0.9,-0.2,4], r=0.9)', state: 'mat 1', means: 'the orb', code: 'sdSphere(p,[-.9,-.2,4],.9)', cand: { node: 'w3.orb.spikes', by: 'opus-a', would: 'graft spikes SDF', on: false } }, run: () => {} });
const pillar = live({ id: 'w3.pillar', kind: 'geometry', order: 5, layer: '3D world', owns: { uni: [[54, 55]] },
  title: 'pillar', detail: 'a box column', prov: { via: 'sdBox(c=[1.2,0,4.5], b=[.5,1.2,.5])', state: 'mat 2', means: 'a wall pillar', code: 'sdBox(p,[1.2,0,4.5],[.5,1.2,.5])', cand: null }, run: () => {} });
const nodeIdx = { 'w3.floor': floor.idx, 'w3.orb': orb.idx, 'w3.pillar': pillar.idx };

// the RENDER node that marches the world into color+owner (order 5 → runs FIRST)
const r3d = render3dNode(nodeIdx);
live(r3d);

// ── 2D UI nodes — drawn AFTER the world (higher order), each owns its pixels.
//    Clicking a button resolves to ITS node; clicking the world resolves to the surface.
const uiHud = live({ id: 'ui.hud', kind: 'render', order: 200, layer: '2D UI', owns: { uni: [[60, 61]] },
  title: 'HUD bar', detail: 'the bottom panel container', prov: { via: 'rect · bottom strip', state: 'container', means: 'the UI panel', code: "g.rect(0,H*.82,W,H,20,26,36)", cand: null },
  run: ({ frame, node }) => { const g = frame.painter(node.idx); g.rect(0, Math.floor(H * 0.82), W, H, 20, 26, 36, 0.92); } });
const btnFire = live({ id: 'ui.btn.fire', kind: 'render', order: 210, layer: '2D UI', owns: { uni: [[62, 62]] },
  title: 'FIRE button', detail: 'a UI button', prov: { via: 'rect · button', state: 'idle', means: 'the fire button', code: "g.rect(24,H*.86,60,20,180,70,50)", cand: null },
  run: ({ frame, node }) => { const g = frame.painter(node.idx); g.rect(24, Math.floor(H * 0.86), 60, 22, 180, 70, 50); } });
const btnMenu = live({ id: 'ui.btn.menu', kind: 'render', order: 210, layer: '2D UI', owns: { uni: [[63, 63]] },
  title: 'MENU button', detail: 'a UI button', prov: { via: 'rect · button', state: 'idle', means: 'the menu button', code: "g.rect(96,H*.86,60,20,60,90,140)", cand: null },
  run: ({ frame, node }) => { const g = frame.painter(node.idx); g.rect(96, Math.floor(H * 0.86), 60, 22, 60, 90, 140); } });

// ---- loop ----
const cv = document.getElementById('scene'); cv.width = W; cv.height = H;
const ctx = cv.getContext('2d');
let t0 = performance.now();
function loop() {
  const t = (performance.now() - t0) / 1000;
  frame.clear(10, 12, 16, -1);
  sched.tick({ frame, t, dt: 1 / 60 });     // render.3d (world) → ui.* (UI on top), one owner buffer
  frame.blit(ctx);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---- CLICK / HOVER → owner → node → source (the whole point) ----
function resolve(e) {
  const b = cv.getBoundingClientRect();
  const x = Math.floor((e.clientX - b.left) / b.width * W), y = Math.floor((e.clientY - b.top) / b.height * H);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const idx = frame.owner[y * W + x];
  const n = idx >= 0 ? provNode(idx) : null;
  const el = document.getElementById('prov');
  if (!n) { el.innerHTML = '<div class="pk" style="color:#6c6154">sky — unowned (a click here hits nothing)</div>'; return; }
  const p = n.prov || {};
  el.innerHTML = `<div class="pk">${n.id} <span class="pkk">${n.kind} · <b>${n.layer}</b></span></div>`
    + `<div class="pr"><b>via</b> ${p.via || '—'}</div>`
    + `<div class="pr"><b>code</b> <span class="mn">${p.code || '—'}</span></div>`
    + `<div class="pr"><b>means</b> <span class="mn">${p.means || '—'}</span></div>`
    + (p.cand ? `<div class="cand"><b>candidate</b> ${p.cand.node} @${p.cand.by} — ${p.cand.would}</div>` : '');
}
cv.addEventListener('mousemove', resolve);
cv.addEventListener('click', resolve);

// draw the graph list
document.getElementById('graph').innerHTML = reg.all().sort((a, b) => a.order - b.order).map(n =>
  `<div class="gn"><span class="go">${n.order}</span><span class="gid">${n.id}</span><span class="gow">${n.layer || ''}</span></div>`).join('');
