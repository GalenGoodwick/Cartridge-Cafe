// VIGIL — "seeing is touching." A cathedral dark you cross on panes of stained
// glass that exist only where a Watcher's gaze falls on them; where that gaze
// and your carried flame's light CROSS on a pane, the pane's rule flips
// (floor↔door, wall↔bridge). The whole trigger substrate is one marched ray.
//
// Architecture (see VIGIL-OUTLINE.md):
//   • gaze-math.mjs   — ray/plane/ray geometry, unit-tested to 1e-9
//   • vigil-logic.mjs — the mechanic (stepVigil), unit-tested against a fake sim
//   • this file       — WGSL render + the step-hook, which EMBEDS the tested
//                       logic verbatim (stringified) so the shipped code IS the
//                       tested code. No drift between test and live.
//
// Ship: `UC_STOKEN=uc_st_… node vigil-cartridge.mjs --run`  (or via player key,
// see deploy() below). Nothing deploys without --run.

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const _here = dirname(fileURLToPath(import.meta.url))

// ───────────────────────────────────────────────────────── uniform layout ──
// gpuUniforms A[0..40] — the whiteboard the hook publishes and the shader reads.
//   0        t
//   1..3     flame pos xyz          4..6   flame aim xyz
//   7        win                    8      onSolid
//   10..15   watcher0 origin,dir    16..21 watcher1     22..27 watcher2
//   28..31   pane0 cx,cz,lit,rule   32..35 pane1        36..39 pane2
//   40       reliquaryZ
// rule codes: floor 0, door 1, wall 2, bridge 3

// ───────────────────────────────────────────────────────────────── WGSL ──
export const LIB = `
fn vg_box(p: vec3f, b: vec3f) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}
fn vg_capsule(p: vec3f, h: f32, r: f32) -> f32 {
  let q = vec3f(p.x, p.y - clamp(p.y, -h, h), p.z);
  return length(q) - r;
}
fn vg_watcher(p: vec3f, o: vec3f) -> f32 {           // a hooded stone sentinel
  let lp = p - o;
  let body = vg_capsule(vec3f(lp.x, lp.y + 0.4, lp.z), 1.5, 0.55);
  let head = length(lp - vec3f(0.0, 1.25, 0.0)) - 0.42;
  return min(body, head);
}
fn vg_reliquary(p: vec3f, rz: f32) -> f32 {          // the goal at the nave's end
  let lp = p - vec3f(0.0, 1.5, rz);
  let plinth = vg_box(lp + vec3f(0.0, 1.2, 0.0), vec3f(1.3, 0.5, 0.9));
  let ark = vg_box(lp, vec3f(0.9, 1.0, 0.6)) - 0.1;
  return min(plinth, ark);
}
// cathedral: side ledges + central chasm, columns with spire finials, back
// wall, the three standing Watchers, and the reliquary. Fixed geometry (the
// gaze sweeps as beams in the visual; the bodies stand still). Stays exact.
fn vg_map(p: vec3f) -> f32 {
  // ONE central walkway with two GAPS carved out — the gaps are crossed on panes
  // that are only solid where a Watcher's gaze lights them.
  let walk = vg_box(p - vec3f(0.0, -0.5, 13.0), vec3f(2.6, 0.5, 14.0));
  let gap1 = vg_box(p - vec3f(0.0, -0.5, 8.5),  vec3f(3.2, 1.3, 1.7));
  let gap2 = vg_box(p - vec3f(0.0, -0.5, 15.5), vec3f(3.2, 1.3, 1.7));
  var d = max(walk, -min(gap1, gap2));                              // walkway minus the gaps
  // flanking colonnade at x=±4, a column every 6 in z, ball finials
  let cz = clamp(round((p.z - 2.0) / 6.0), 0.0, 4.0) * 6.0 + 2.0;
  let colL = vg_box(vec3f(p.x + 4.0, p.y - 4.0, p.z - cz), vec3f(0.5, 5.0, 0.5));
  let colR = vg_box(vec3f(p.x - 4.0, p.y - 4.0, p.z - cz), vec3f(0.5, 5.0, 0.5));
  d = min(d, min(colL, colR));
  let capL = length(vec3f(p.x + 4.0, p.y - 9.3, p.z - cz)) - 0.8;
  let capR = length(vec3f(p.x - 4.0, p.y - 9.3, p.z - cz)) - 0.8;
  d = min(d, min(capL, capR));
  d = min(d, vg_box(p - vec3f(0.0, 4.0, 26.5), vec3f(6.0, 6.0, 0.5)));  // back wall
  d = min(d, vg_watcher(p, vec3f(-4.0, 3.0, 8.5)));                     // gaze the first gap
  d = min(d, vg_watcher(p, vec3f( 4.0, 3.0, 15.5)));                    // gaze the second gap
  d = min(d, vg_reliquary(p, 24.0));
  return d;
}
fn vg_nrm(p: vec3f) -> vec3f {
  let e = 0.02; let d0 = vg_map(p);
  return normalize(vec3f(
    vg_map(p + vec3f(e, 0.0, 0.0)) - d0,
    vg_map(p + vec3f(0.0, e, 0.0)) - d0,
    vg_map(p + vec3f(0.0, 0.0, e)) - d0));
}
fn vg_march(ro: vec3f, rd: vec3f) -> f32 {
  var t = 0.05;
  for (var i = 0; i < 110; i = i + 1) {
    let d = vg_map(ro + rd * t);
    if (d < 0.002 * t) { return t; }
    t = t + d * 0.85;
    if (t > 120.0) { break; }
  }
  return -1.0;
}`

export const VISUAL = `
fn visual_vigil(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let p = vec2f(uv.x, -uv.y);
  let flame = vec3f(uni(1), uni(2), uni(3));

  // camera follows the flame down the nave, a little behind and above
  let ro = vec3f(0.0, 4.5, flame.z - 8.0);
  let look = normalize(vec3f(0.0, -0.12, 1.0));
  let rt = normalize(cross(vec3f(0.0, 1.0, 0.0), look));
  let up = cross(look, rt);
  let rd = normalize(rt * p.x + up * (p.y * 0.72) + look * 1.4);

  var col = vec3f(0.02, 0.02, 0.03);   // the dark
  var sceneT = 1.0e9;
  let tt = vg_march(ro, rd);
  if (tt > 0.0) {
    sceneT = tt;
    let pt = ro + rd * tt;
    let n = vg_nrm(pt);
    let ao = clamp(0.5 + 0.5 * n.y, 0.2, 1.0);
    var m = vec3f(1.06) - (1.0 - ao) * vec3f(0.10);        // Antichamber: walls GLOW white (HDR>1 → blooms)

    // material: the Watchers are charcoal; the reliquary burns warm
    var wNear = 0.0;
    wNear = max(wNear, 1.0 - smoothstep(0.5, 1.7, length(pt - vec3f(-4.0, 3.0, 8.5))));
    wNear = max(wNear, 1.0 - smoothstep(0.5, 1.7, length(pt - vec3f( 4.0, 3.0, 15.5))));
    m = mix(m, vec3f(0.10, 0.10, 0.13), wNear * 0.9);
    let dz = pt.z - 24.0;
    let relGlow = exp(-(dz * dz) * 0.4) * exp(-(pt.x * pt.x) * 0.12) * (1.0 - smoothstep(2.6, 3.4, pt.y));
    m = m + vec3f(1.0, 0.72, 0.34) * relGlow * 1.3;

    let fd = length(flame - pt);
    m = m + vec3f(1.0, 0.55, 0.2) * exp(-fd * 0.35) * 0.6;  // firelight warms the stone

    // Antichamber linework: black creases (normal deviation) + silhouettes
    let tang = normalize(cross(n, vec3f(0.0, 1.0, 0.0)) + vec3f(0.0001, 0.0, 0.0));
    let bitan = cross(n, tang);
    let ee = 0.05;
    let crease = (1.0 - dot(n, vg_nrm(pt + tang * ee))) + (1.0 - dot(n, vg_nrm(pt + bitan * ee)));
    let edge = smoothstep(0.015, 0.22, crease);
    let sil = smoothstep(0.55, 0.98, pow(1.0 - max(dot(n, -rd), 0.0), 1.5));
    m = mix(m, vec3f(0.015, 0.015, 0.02), max(edge, sil));

    let fog = 1.0 - exp(-tt * 0.012);                      // lighter haze — the glow carries down the nave
    col = mix(m, vec3f(0.02, 0.02, 0.03), fog);
  }

  // panes — glass where lit, tinted by rule, with lead-line grid
  for (var i = 0; i < 3; i = i + 1) {
    let b = 28 + i * 4;
    let cx = uni(b); let cz = uni(b + 1); let lit = uni(b + 2); let rule = uni(b + 3);
    if (lit < 0.5) { continue; }
    if (abs(rd.y) < 1.0e-4) { continue; }
    let ph = (1.0 - ro.y) / rd.y;                 // pane plane at y = 1
    if (ph < 0.0 || ph > sceneT) { continue; }
    let hp = ro + rd * ph;
    if (abs(hp.x - cx) > 2.5 || abs(hp.z - cz) > 1.5) { continue; }   // gap-bridge pane size
    var rc = vec3f(0.9);
    if (rule > 0.5 && rule < 1.5) { rc = vec3f(0.30, 0.90, 1.00); }   // door
    if (rule > 1.5 && rule < 2.5) { rc = vec3f(1.00, 0.70, 0.20); }   // wall
    if (rule > 2.5)              { rc = vec3f(0.40, 1.00, 0.50); }   // bridge
    let gx = abs(fract((hp.x - cx + 1.0) * 2.0) - 0.5);
    let gz = abs(fract((hp.z - cz + 1.0) * 2.0) - 0.5);
    let lead = smoothstep(0.02, 0.06, min(gx, gz));
    col = col + rc * (0.35 + 0.4 * lead);
  }

  // gaze beams — glow along each Watcher ray (closest approach of two lines)
  for (var i = 0; i < 3; i = i + 1) {
    let b = 10 + i * 6;
    let go = vec3f(uni(b), uni(b + 1), uni(b + 2));
    let gdir = vec3f(uni(b + 3), uni(b + 4), uni(b + 5));
    if (length(gdir) < 0.5) { continue; }
    let w0 = ro - go;
    let a = dot(rd, rd); let bb = dot(rd, gdir); let c = dot(gdir, gdir);
    let dd = dot(rd, w0); let e = dot(gdir, w0);
    let den = a * c - bb * bb;
    if (abs(den) < 1.0e-5) { continue; }
    let tc = (bb * e - c * dd) / den;
    let sc = (a * e - bb * dd) / den;
    if (tc < 0.0 || tc > sceneT || sc < 0.0 || sc > 12.0) { continue; }
    let gap = length((ro + rd * tc) - (go + gdir * sc));
    col = col + vec3f(0.7, 0.85, 1.0) * exp(-gap * gap * 3.0) * 0.5;
  }

  // the flame mote
  let tcf = -dot(rd, ro - flame);
  if (tcf > 0.0 && tcf < sceneT) {
    let gap = length((ro + rd * tcf) - flame);
    col = col + vec3f(1.0, 0.6, 0.25) * exp(-gap * gap * 6.0) * 1.4;
  }

  if (uni(7) > 0.5) { col = col + vec3f(0.15, 0.13, 0.10); }   // win bloom
  return vec4f(col, 1.0);   // linear HDR — engine grades it
}`

// ─────────────────────────────────────────────── the hook (one-truth build) ──
// Embed the tested mechanic by reading its SOURCE FILES verbatim and stripping
// module keywords — so the shipped hook is byte-identical to the code the unit
// tests proved, immune to any runtime/​bundler source transform. Single truth.
const stripModule = (src) => src
  .replace(/import\b[\s\S]*?from\s*['"][^'"]+['"]\s*;?/g, '') // drop import statements
  .replace(/^\s*export\s+/gm, '')                            // export const/fn → const/fn
const EMBED = [
  join(_here, '../../../lib/gaze-math.mjs'),
  join(_here, '../../../lib/collision.mjs'),
  join(_here, '../../../lib/vigil-puzzle.mjs'),
  join(_here, '../../../lib/vigil-logic.mjs'),
].map((f) => stripModule(readFileSync(f, 'utf8'))).join('\n')

export const HOOK = `try {
${EMBED}
  const wd = sim.worldData;
  if (!wd.__vg || wd.__vg.v !== 3) wd.__vg = initVigilState();
  const G = wd.__vg;
  const step = Math.min(dt, 1/30);

  // input — keys move the flame, the cursor aims its light
  const L = !!(wd.key_left||wd.key_a), R = !!(wd.key_right||wd.key_d);
  const F = !!(wd.key_up||wd.key_w),   B = !!(wd.key_down||wd.key_s);
  let aimX = 0, aimZ = 1;
  if (wd.mouse_x != null && wd.mouse_y != null) { aimX = (wd.mouse_x-256)/256; aimZ = (256-wd.mouse_y)/256; }
  stepVigil(G, { moveX:(R?1:0)-(L?1:0), moveZ:(F?1:0)-(B?1:0), aimX, aimZ }, step);

  // events → sound
  for (const ev of (G.events||[])) {
    if (ev.type === 'flip') (wd.__play_sound = wd.__play_sound||[]).push({ frequency:200+ev.pane*90, duration:0.18, volume:0.28, type:'sine' });
    if (ev.type === 'win')  (wd.__play_sound = wd.__play_sound||[]).push({ frequency:523, duration:0.7, volume:0.4, type:'triangle' });
  }

  // pin the canvas field so physics never drags the world
  for (const f of sim.fields.values()) { if ((f.name||'') === 'Vigil') { const T=f.transform; T.x=256; T.y=256; T.vx=0; T.vy=0; } }

  // publish the whiteboard
  const A = new Array(48).fill(0);
  A[0]=G.t;
  A[1]=G.flame.pos[0]; A[2]=G.flame.pos[1]; A[3]=G.flame.pos[2];
  A[4]=G.flame.aim[0]; A[5]=G.flame.aim[1]; A[6]=G.flame.aim[2];
  A[7]=G.win||0; A[8]=G.onSolid||0;
  for (let i=0;i<3;i++){ const w=G.watchers[i]; if(!w) continue; const g=watcherGaze(w,G.t); const b=10+i*6;
    A[b]=w.origin[0]; A[b+1]=w.origin[1]; A[b+2]=w.origin[2]; A[b+3]=g.dir[0]; A[b+4]=g.dir[1]; A[b+5]=g.dir[2]; }
  const RC={floor:0,door:1,wall:2,bridge:3};
  for (let i=0;i<3;i++){ const p=G.panes[i]; if(!p) continue; const b=28+i*4;
    A[b]=p.origin[0]+(p.uAxis?p.uAxis[0]/2:1); A[b+1]=p.origin[2]+(p.vAxis?p.vAxis[2]/2:1); A[b+2]=p.lit||0; A[b+3]=0; }
  A[40]=G.reliquaryZ;
  wd.gpuUniforms = A;

  wd.hud = G.win ? [{ id:'vg_win', type:'text', x:'50%', y:'12%', text:'THE RELIQUARY', color:'#ffffff', fontSize:'6px' }] : [];
} catch (e) { try { sim.worldData.last_hook_error = String(e && e.stack || e); } catch (_) {} }`

// ────────────────────────────────────────────────────────────── deploy ──
export function buildBatch() {
  return [
    { type: 'set_world_data', data: { built_by: 'Claude (Fable)', singlePlayer: true,
      instructions: [
        'W A S D / arrows — carry the flame. The cursor aims its light.',
        '',
        'The cathedral is dark. Stone Watchers sweep their gaze through it.',
        'A pane of glass is solid ONLY where a gaze falls on it — step off',
        'the light and you drop. Where a Watcher gaze and your flame light',
        'CROSS on a pane, its rule flips: floor becomes door, wall becomes',
        'bridge. Aim the crossings. Cross the nave. Reach the reliquary.',
      ].join('\\n') } },
    { type: 'set_world_params', params: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 } },
    { type: 'define_module', name: 'vg_lib', wgsl: LIB },
    { type: 'define_visual', name: 'vigil', wgsl: VISUAL },
  ]
}

async function deploy() {
  const BRIDGE = process.env.UC_BRIDGE || 'https://cartridge.cafe/api/engine/bridge'
  const playerKey = process.env.UC_PTOKEN            // uc_pt_ — mints a world token
  let worldTok = process.env.UC_STOKEN               // uc_st_ — builds directly
  const post = (tok, body) => fetch(BRIDGE, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify(body) }).then((r) => r.json())

  if (!worldTok) {
    if (!playerKey) throw new Error('set UC_STOKEN (uc_st_) or UC_PTOKEN (uc_pt_)')
    // create-or-checkout VIGIL as the player, get its uc_st_ world token
    let r = await post(playerKey, { commands: [{ type: 'use_world', slug: 'vigil' }] })
    let res = r.results && r.results[0]
    if (!res || res.error) r = await post(playerKey, { commands: [{ type: 'create_world', name: 'VIGIL' }] }), res = r.results && r.results[0]
    if (!res || !res.token) throw new Error('could not obtain world token: ' + JSON.stringify(r))
    worldTok = res.token
    console.log('world:', res.created || res.world, '→ token acquired')
  }

  console.log(await post(worldTok, { commands: buildBatch() }))
  // IDEMPOTENT field: a redeploy must REUSE the existing Vigil field, never add a
  // second. (A duplicate un-superimposed field composites to nothing → blank
  // screen. That was the live blank-taupe bug.) Check first; create only if none.
  const state0 = await fetch(BRIDGE, { headers: { Authorization: `Bearer ${worldTok}` } }).then((r) => r.json()).catch(() => ({}))
  const dupes = (state0.fields || []).filter((f) => f.name === 'Vigil')
  for (const extra of dupes.slice(1)) await post(worldTok, { commands: [{ type: 'remove_field', fieldId: extra.id }] })
  if (dupes.length === 0) {
    await post(worldTok, { commands: [{ type: 'create_field', name: 'Vigil', shape: 'rect', x: 256, y: 256, width: 512, height: 512, visualType: 'vigil', color: [0.02, 0.02, 0.03, 1], noHit: true }] })
  }
  const state = await fetch(BRIDGE, { headers: { Authorization: `Bearer ${worldTok}` } }).then((r) => r.json()).catch(() => ({}))
  const fld = (state.fields || []).find((f) => f.name === 'Vigil')
  if (fld) await post(worldTok, { commands: [{ type: 'set_property', fieldId: fld.id, key: 'superimpose', value: true }] })
  await post(worldTok, { commands: [{ type: 'add_step_hook', hookId: 'vigil_core', author: 'Claude (Fable)', description: 'VIGIL: gaze-ray ∩ flame-light rule-flip substrate', code: HOOK }] })
  await post(worldTok, { commands: [{ type: 'set_world_data', data: { postProcess: { bloomIntensity: 0.5, bloomThreshold: 0.6, exposure: 1.05, vignetteStrength: 0.4, vignetteRadius: 0.82 } } }] })
  console.log('VIGIL built. open /space/vigil')
}

if (process.argv.includes('--run')) deploy().catch((e) => { console.error(e); process.exit(1) })
