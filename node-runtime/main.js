// node-runtime · main.js — boot the runtime, render the frame, and render the
// registry AS the work graph. Click a pixel → provenance. Flip order/guard →
// watch the veilfire clobber happen or be prevented, live.
import { Registry } from './core/registry.js';
import { State } from './core/state.js';
import { Frame } from './core/frame.js';
import { Scheduler } from './core/scheduler.js';
import { registerAll, provNode } from './nodes/seed.js';
import { superCollapse, superState } from './nodes/superpose.js';
import * as playback from './nodes/playback.js';

const W = 240, H = 150;
const reg = new Registry();
const state = new State(256, 'strict');            // start safe
const frame = new Frame(W, H);
const sched = new Scheduler(reg, state);
registerAll(reg);
// playback is a main-loop mechanism (records the finished frame post-tick), but it
// IS a live node in the graph — flip it from stub.
{ const pb = reg.get('sys.playback'); if (pb) { pb.status = 'live'; pb.detail = 'deterministic record/replay · owner buffer kept, so provenance works on replays'; } }

const cv = document.getElementById('scene');
cv.width = W; cv.height = H;
const ctx = cv.getContext('2d');

let t0 = performance.now(), lastT = 0;
function loop() {
  const t = (performance.now() - t0) / 1000;
  const dt = t - lastT; lastT = t;
  if (playback.isLive()) {
    frame.clear(14, 11, 9, -1);
    const res = sched.tick({ frame, t, dt });
    playback.record(frame, t);                 // record color + owner every frame
    frame.blit(ctx);
    drawSuper();
    document.getElementById('err').textContent = res.errors.length ? ('hook errors: ' + JSON.stringify(res.errors)) : 'hook errors: none';
    document.getElementById('viol').textContent = state.violations.length;
  } else {
    // REPLAY — sim frozen; show the recorded frame. We restore its owner buffer
    // too, so hovering resolves provenance against the PAST frame ("who drew this then").
    const f = playback.frameAt();
    if (f) { frame.col.set(f.col); frame.owner.set(f.owner); frame.blit(ctx); }
  }
  updatePlayback();
  requestAnimationFrame(loop);
}

// ---- work-graph panel: the registry drawing itself ----
function drawGraph() {
  const rows = reg.all().sort((a, b) => a.order - b.order).map(n => {
    const owns = (n.owns.uni || []).map(r => 'u' + r[0] + '–' + r[1]).join(' ') || '—';
    const cls = n.status === 'live' ? 'live' : 'stub';
    return `<div class="gn ${cls}"><span class="go">${String(n.order).padStart(3)}</span>
      <span class="gid">${n.id}</span><span class="gow">${owns}</span>
      <span class="gst">${n.status}</span><div class="gd">${n.detail || ''}</div></div>`;
  }).join('');
  document.getElementById('graph').innerHTML = rows;
}
drawGraph();

// ---- provenance: click a pixel, resolve its owning node ----
cv.addEventListener('mousemove', e => {
  const b = cv.getBoundingClientRect();
  const x = Math.floor((e.clientX - b.left) / b.width * W), y = Math.floor((e.clientY - b.top) / b.height * H);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const idx = frame.owner[y * W + x];
  const n = idx >= 0 ? provNode(idx) : null;
  const p = document.getElementById('prov');
  if (!n) { p.innerHTML = '<div class="pk">untouched pixel</div>'; return; }
  const pr = n.prov || {};
  let h = `<div class="pk">${n.id} <span class="pkk">${n.kind}</span></div>`;
  h += `<div class="pr"><b>via</b> ${pr.via || n.detail || '—'}</div>`;
  h += `<div class="pr"><b>owns</b> ${(n.owns.uni || []).map(r => 'u' + r[0] + '–' + r[1]).join(' ') || '—'}</div>`;
  h += `<div class="pr"><b>state</b> ${pr.state || '—'}</div>`;
  h += `<div class="pr"><b>means</b> <span class="mn">${pr.means || '—'}</span></div>`;
  h += pr.cand
    ? `<div class="cand"><b>superimposed</b> ${pr.cand.node} · @${pr.cand.by} — ${pr.cand.would} (${pr.cand.on ? 'live' : 'staged, not collapsed'})</div>`
    : `<div class="cand none">— no rival candidate here —</div>`;
  p.innerHTML = h;
});

// ---- live controls: reproduce (or prevent) the clobber ----
const baseNode = reg.get('sys.base');
document.getElementById('order').addEventListener('click', () => {
  baseNode.order = baseNode.order === 30 ? 999 : 30;        // 999 = "re-pushed to the end"
  document.getElementById('order').textContent = 'base order: ' + baseNode.order + (baseNode.order === 999 ? ' (after weapons ⚠)' : ' (before weapons)');
  drawGraph();
});
document.getElementById('guard').addEventListener('click', () => {
  state.mode = state.mode === 'strict' ? 'advisory' : 'strict';
  state.violations.length = 0;
  document.getElementById('guard').textContent = 'guard: ' + state.mode;
});

// ---- superposition panel: the candidates + the champion, live ----
function drawSuper() {
  const S = superState(); if (!S) return;
  const rows = S.cands.map((c, i) => {
    const champ = i === S.champ;
    return `<div class="cn ${champ ? 'champ' : ''}"><span class="cdot" style="background:rgb(${c.col.join(',')})"></span>cand ${i}<span class="csc">Δ ${c.score.toFixed(0)}</span>${champ ? '<span class="cwin">★ champion</span>' : ''}</div>`;
  }).join('');
  document.getElementById('super').innerHTML = rows +
    `<div class="smeta">round ${S.round} · ${S.cands.length} superposed · ${S.history.length} collapsed → history</div>`;
}
document.getElementById('collapse').addEventListener('click', () => { superCollapse(); drawSuper(); drawGraph(); });

// ---- playback scrubber: freeze + replay any recorded frame (provenance intact) ----
function updatePlayback() {
  const sc = document.getElementById('scrub');
  sc.max = Math.max(0, playback.len() - 1);
  if (playback.isLive()) sc.value = playback.len() - 1;
  const live = playback.isLive();
  document.getElementById('pbstat').textContent = live
    ? `● LIVE · rec ${playback.len()}f`
    : `⏸ REPLAY · f${playback.scrubIndex()}/${playback.len() - 1}${playback.scrubT() != null ? ` · t=${playback.scrubT().toFixed(2)}` : ''}`;
  document.getElementById('pbstat').className = 'pbstat' + (live ? ' islive' : '');
  document.getElementById('golive').style.opacity = live ? 0.45 : 1;
}
document.getElementById('scrub').addEventListener('input', (e) => playback.setScrub(parseInt(e.target.value)));
document.getElementById('golive').addEventListener('click', () => playback.goLive());

requestAnimationFrame(loop);
