// node-runtime · nodes/seed.js
// The seed pipeline as node records. Four LIVE paint nodes prove order +
// ownership + provenance on a real frame; the rest register as STUB graph nodes
// so the page shows the whole build as a graph of itself (the work graph).
// The veilfire clobber is reproduced live: sys.base (u-unowned) vs sys.weapons
// (owns u69–79). Flip order/guard in the UI and watch u69 survive or die.

import { superInit, superRun } from './superpose.js';

let PROV = [];                 // idx -> node (for pixel provenance)
export function provNode(idx) { return PROV[idx]; }

export function registerAll(reg) {
  PROV = [];
  const live = (rec) => {
    const idx = PROV.length; PROV.push(null);
    const node = reg.register(Object.assign({ status: 'live', idx }, rec));
    PROV[idx] = node; return node;
  };

  // ---- LIVE render nodes (order matters; each owns a uniform slot) ----
  live({
    id: 'render.atmos', kind: 'render', order: 0, owns: { uni: [[10, 19]] },
    title: 'atmosphere', detail: 'lit rock + dread · the ground layer',
    prov: { via: 'gradient · ember rock', state: 'u12 dread', means: 'the room itself', cand: null },
    run: ({ frame, node }) => {
      const g = frame.painter(node.idx), W = frame.W, H = frame.H;
      for (let y = 0; y < H; y++) { const t = 1 - y / H;
        g.rect(0, y, W, 1, 26 + 34 * t, 16 + 22 * t, 10 + 14 * t); }
    },
  });
  live({
    id: 'geo.rooms', kind: 'geometry', order: 30, owns: { uni: [[40, 48]] },
    title: 'rooms', detail: 'walls + floor · the far wall (hides a candidate)',
    prov: { via: 'mod_w3_box · tcHallBlock', state: 'u48=0 · mat 6', means: 'side-chamber far wall',
      cand: { node: 'geo.hallway', by: 'opus-a', would: 'carve → walk-through', on: false } },
    run: ({ frame, node }) => {
      const g = frame.painter(node.idx);
      g.rect(0, Math.floor(frame.H * 0.72), frame.W, frame.H, 58, 42, 28);       // floor
      g.rect(Math.floor(frame.W * 0.34), Math.floor(frame.H * 0.16),
             Math.floor(frame.W * 0.34), Math.floor(frame.H * 0.56), 150, 80, 38); // wall
    },
  });
  live({
    id: 'sys.orb', kind: 'system', order: 60, owns: { uni: [[20, 39]] },
    title: 'the orb', detail: 'the boss · owns u20–39',
    prov: { via: 'mod_vf_manifold (TPMS)', state: 'u20=0 · idle', means: 'the orb boss', cand: null },
    run: ({ frame, node }) => {
      const g = frame.painter(node.idx);
      g.disc(Math.floor(frame.W * 0.26), Math.floor(frame.H * 0.5), Math.floor(frame.H * 0.16), 92, 68, 44);
    },
  });
  live({
    id: 'sys.weapons', kind: 'system', order: 100, owns: { uni: [[69, 79]] },
    title: 'weapons', detail: 'owns u69–79 · writes the active-slot lamp LAST',
    prov: { via: 'cf_frame · slots', state: 'u69=active', means: 'weapon HUD', cand: null },
    run: ({ frame, u, node }) => {
      u.set(69, 1);                                  // active weapon → owned slot
      const on = u.get(69) > 0.5;                     // HUD lamp reads u69
      const g = frame.painter(node.idx);
      for (let i = 0; i < 4; i++) {
        const bright = (i === 0 && on) ? 1 : 0.28;
        g.rect(14 + i * 30, 14, 22, 24, 84 * bright + 20, 210 * bright, 221 * bright, 0.95);
      }
    },
  });

  // ---- the clobber actor: sys.base does NOT own u69. In correct order (30) it
  // runs before weapons and is harmless; misordered (999) it runs last and tries
  // to zero u69 — advisory lets it (HUD dies + logs), strict drops it (HUD lives).
  reg.register({
    id: 'sys.base', kind: 'system', order: 30, status: 'live', idx: -1,
    owns: { uni: [[0, 9]] }, title: 'base (movement)', detail: 'owns u0–9 · re-push moves it to the END',
    run: ({ u }) => { u.set(69, 0); },               // NOT owned → the guard decides its fate
  });

  // ---- STUB graph nodes: the rest of the pipeline, to nest into and write ----
  const stub = (id, order, title, detail, owns) => reg.register({ id, order, title, detail, status: 'stub', owns: owns || { uni: [] } });
  stub('render.2d',     20,  'render · 2D field-leak', 'uber-shader behind-param pipeline (SUPERIMPOSITION.md)');
  stub('render.3d',     25,  'render · 3D raymarch',   'geometry manifest → nearest-hit + depth + owner buffer');
  stub('audio.graph',   150, 'audio', 'per-node audio contributions · owned voices (audio.ts / cafe-audio.ts)');
  stub('sys.playback',  250, 'pixel playback', 'deterministic record/replay of frame+input+audio · the non-destructive floor');
  // LIVE: superposition + collapse — candidates coexist, evaluator picks a champion.
  superInit();
  live({
    id: 'sys.tournament', kind: 'system', order: 260, owns: { uni: [[120, 130]] },
    title: 'superposition', detail: 'candidates coexist → evaluate → collapse',
    prov: { via: 'tournament · MULTISTATE §7', state: 'champion = closest to truth', means: 'the collapse', cand: null },
    run: superRun,
  });
  stub('sys.evaluator', 261, 'evaluator', 'truth-stack collapse: pixel ∧ state ∧ meaning + human gate');
  stub('sys.provenance',270, 'provenance (full)', 'pixel → node → code → owned state → candidates, both render paths');

  return reg;
}
