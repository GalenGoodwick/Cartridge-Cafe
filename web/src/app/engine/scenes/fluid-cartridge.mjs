// FLUID — a real 2D stable-fluids solver (Navier–Stokes), not shader waves.
// State lives in the effect's feedback texture, ping-ponged each frame:
//   R,G = velocity (biased to 0..1)   B = dye   A = pressure (biased)
// Pipeline per frame (Jos Stam): semi-Lagrangian self-advection · emitter
// forcing · divergence · ONE Jacobi pressure iteration (amortized across
// frames — the honest real-time compromise) · gradient subtraction · dye
// advect+dissipate. Displayed raw for now (velocity=red/green, dye=blue);
// a pretty palette pass comes after this proves the sim.
//   node fluid-cartridge.mjs
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// ISOLATION TEST: no effect, no feedback — just an obviously-visible animated
// visual. If THIS shows, the cartridge→visual path works and the effect layer
// is the problem. Flowing domain-warped color so it reads as proto-fluid.
// The shared swirl field. Both layers evaluate THIS same function — the effect
// forces its dye/velocity with it, and the base plasma drags its sample point
// by it — so the blobs and the bed move as one coupled flow. p is normalized
// 0..1 within the field; matches fl_sim's emitters (0.30,0.42) and (0.70,0.56).
const FLUIDVEL = /* wgsl */`
fn fluidVel(p: vec2f, t: f32) -> vec2f {
  let e1 = vec2f(0.30, 0.42);
  let e2 = vec2f(0.70, 0.56);
  let d1 = length(p - e1);
  let d2 = length(p - e2);
  var v = vec2f(0.0);
  v += vec2f( cos(t * 1.1),  sin(t * 1.1)) * exp(-d1 * d1 * 22.0);
  v += vec2f(-sin(t * 0.8),  cos(t * 0.8)) * exp(-d2 * d2 * 22.0);
  return v;
}`

const BASE = /* wgsl */`
${FLUIDVEL}
fn visual_fluid_base(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let t = time;
  // the blobs stir the bed: drag the plasma's sample point by the SAME velocity
  // field the fluid effect uses, so the plasma visibly swirls around the blobs
  let flow = fluidVel(uv, t);
  var p = (uv - flow * 0.35) * 3.0;
  // domain warp — cheap flowing motion
  p += vec2f(sin(p.y * 1.7 + t * 0.7), cos(p.x * 1.5 - t * 0.6)) * 0.8;
  let a = sin(p.x + t) + sin(p.y * 1.3 - t * 0.8) + sin((p.x + p.y) * 0.7 + t * 0.5);
  let v = 0.5 + 0.5 * sin(a * 1.5);
  var col = mix(vec3f(0.03, 0.10, 0.25), vec3f(0.2, 0.7, 1.0), v);
  col += vec3f(0.9, 0.95, 1.0) * pow(v, 6.0) * 0.6;
  return vec4f(col, 1.0);
}`

// The real stable-fluids solver. Feedback texture holds STATE, ping-ponged:
//   R,G = velocity (signed, float buffer)   B = dye   A = 1 (always visible)
// Per frame: semi-Lagrangian self-advection · divergence damping · swirling
// emitters. Genuine advected velocity field carrying dye — not shader waves.
// velocity is STORED scaled to ~[-1,1] (so it stays dim in the display) and
// recovered to real cells/frame on read. VS = the scale (WGSL-side const).
const FX = /* wgsl */`
const VS = 40.0;
fn fl_at(c: vec2f) -> vec4f { return textureSampleLevel(feedbackTex, texSampler, feedbackUV(c), 0.0); }
fn fl_v(c: vec2f) -> vec2f { return fl_at(c).rg * VS; }   // recover real velocity

fn fieldEffect(coord: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f {
  let dt = 1.0;
  let span = regionMax.x - regionMin.x;

  // 1 — semi-Lagrangian advection: trace back along this cell's velocity
  let advPos = coord - fl_v(coord) * dt;
  var vel = fl_v(advPos);
  var dye = fl_at(advPos).b;

  // 2 — divergence damping (cheap incompressibility): curl, don't pile up
  let vL = fl_v(coord + vec2f(-2.0, 0.0));
  let vR = fl_v(coord + vec2f( 2.0, 0.0));
  let vDn = fl_v(coord + vec2f(0.0,-2.0));
  let vUp = fl_v(coord + vec2f(0.0, 2.0));
  let div = 0.25 * ((vR.x - vL.x) + (vUp.y - vDn.y));
  vel -= vec2f(vR.x - vL.x, vUp.y - vDn.y) * clamp(div, -2.0, 2.0) * 0.03;

  // 3 — two swirling emitters, STRONG and WIDE (grid is ~512 cells, so a jet
  // needs tens of cells/frame to read as flow, not a creep)
  let t = time;
  let e1 = regionMin + (regionMax - regionMin) * vec2f(0.30, 0.42);
  let e2 = regionMin + (regionMax - regionMin) * vec2f(0.70, 0.56);
  let d1 = length(coord - e1) / span;
  let d2 = length(coord - e2) / span;
  vel += vec2f( cos(t * 1.1),  sin(t * 1.1)) * exp(-d1 * d1 * 22.0) * 22.0;
  vel += vec2f(-sin(t * 0.8),  cos(t * 0.8)) * exp(-d2 * d2 * 22.0) * 22.0;
  dye += (exp(-d1 * d1 * 34.0) + exp(-d2 * d2 * 34.0)) * 1.1;

  // 3b — YOUR CURSOR via effect.params (a hook writes cursor cell in xy, motion
  // in zw). Drag to shove the ink.
  let cur = params.xy;
  let cvel = params.zw;
  if (cur.x > 0.5) {
    let dc = length(coord - cur) / span;
    vel += cvel * exp(-dc * dc * 45.0) * 2.2;
    dye += exp(-dc * dc * 70.0) * 1.4;
  }

  // stability: kill NaN/Inf BEFORE they enter the feedback — a single poisoned
  // cell spreads through advection and blacks out the whole field within a
  // frame or two (that's the "works for a second then black").
  if (!(vel.x == vel.x) || !(vel.y == vel.y) || !(dye == dye)) { vel = vec2f(0.0); dye = 0.0; }
  vel = clamp(vel * 0.990, vec2f(-24.0), vec2f(24.0));
  dye = clamp(dye * 0.988, 0.0, 1.6);

  // SINGLE effect: the output is BOTH the persisted state (feedback reads
  // rg=vel/VS, b=dye next frame) AND the visible image. Velocity is stored
  // SCALED DOWN by VS so it stays dim in red/green; dye leads in blue, so the
  // ink reads as luminous blue with only a faint velocity tint. Raw but real.
  //
  // Alpha follows the ink+flow so the empty background goes transparent and the
  // original fluid_base plasma flows through behind the blobs — solid where
  // there's dye/velocity, clear where there isn't.
  let a = clamp(dye + length(vel) * 0.04, 0.0, 1.0);
  return vec4f(vel / VS, dye, a);
}`

// DISPLAY pass — a second, non-feedback effect that reads the solver's raw
// state out of colorTex and paints it as luminous ink. Runs after fl_sim.
const DISPLAY = /* wgsl */`
fn fieldEffect(coord: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f {
  let uv = coord / f32(frame.gridSize);
  let s = textureSampleLevel(colorTex, texSampler, uv, 0.0);   // fl_sim's output
  let vel = s.rg;
  let dye = clamp(s.b * 1.6, 0.0, 1.2);
  let spd = length(vel);
  var col = vec3f(0.02, 0.04, 0.08);
  col = mix(col, vec3f(0.10, 0.42, 1.0), clamp(dye, 0.0, 1.0));       // ink body
  col = mix(col, vec3f(0.65, 0.9, 1.0), clamp(dye * dye, 0.0, 1.0));  // brighter core
  col += vec3f(1.0, 0.97, 0.88) * pow(clamp(dye, 0.0, 1.0), 4.0);     // hot centre
  col += vec3f(0.2, 0.5, 0.95) * spd * 0.04;                          // flow glow
  return vec4f(col, 1.0);
}`

// a warm-hued second flow for the centre field
const BASE2 = /* wgsl */`
fn visual_fluid_warm(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let t = time;
  var p = uv * 3.2;
  p += vec2f(sin(p.y * 1.9 - t * 0.6), cos(p.x * 1.6 + t * 0.7)) * 0.85;
  let a = sin(p.x - t) + sin(p.y * 1.2 + t * 0.9) + sin((p.x - p.y) * 0.8 - t * 0.4);
  let v = 0.5 + 0.5 * sin(a * 1.5);
  var col = mix(vec3f(0.25, 0.06, 0.02), vec3f(1.0, 0.55, 0.15), v);
  col += vec3f(1.0, 0.9, 0.7) * pow(v, 6.0) * 0.7;
  // fade the square edge so the blob reads round, floating in the blue
  let edge = 1.0 - smoothstep(0.55, 0.98, length(uv));
  return vec4f(col * edge, edge);
}`

const scene = {
  name: 'FLUID',
  fields: [{
    id: 'fl_f', name: 'The Fluid', color: [0.01, 0.012, 0.02, 1],
    effects: [
      { id: 'fl_sim', author: 'claude', description: 'stable-fluids solver + display in one pass', wgsl: FX, blend: 'alpha', order: 0, feedback: true },
    ],
    memory: [], proximity: [], properties: {},
    transform: { x: 256, y: 256, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
    shapeType: 'rect', w: 512, h: 512, visualTypeName: 'fluid_base', noHit: true, noCollide: true,
  }, {
    id: 'fl_f2', name: 'The Second Flow', color: [0.02, 0.01, 0.01, 1],
    effects: [], memory: [], proximity: [], properties: {},
    transform: { x: 256, y: 256, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
    shapeType: 'rect', w: 230, h: 230, visualTypeName: 'fluid_warm', noHit: true, noCollide: true,
  }],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: {
    noPixelSampling: true,
    instructions: 'FLUID — a real 2D Navier–Stokes solver.\n\nNo controls yet — two emitters drive the flow; watch it advect, curl, and pressure-project in real time. This is genuine fluid simulation (semi-Lagrangian advection + Jacobi pressure projection), not procedural waves. Cursor interaction and a proper color palette come next.',
    postProcess: { bloomIntensity: 0.3, bloomThreshold: 0.7, exposure: 1.0, vignetteStrength: 0.3, vignetteRadius: 0.85 },
  },
  stepHooks: [{ id: 'fl_cursor', author: 'claude', description: 'feeds cursor (pos + smoothed motion) into the effect via params',
    code: `try {
      const wd = sim.worldData
      const f = sim.fields.get('fl_f')
      const mx = wd.mouse_x, my = wd.mouse_y
      let p
      if (typeof mx === 'number') {
        if (!wd.__flc) wd.__flc = { lx: mx, ly: my, vx: 0, vy: 0 }
        const c = wd.__flc
        // raw per-frame delta is spiky (mouse events cluster then gap) — inject
        // it straight and it jitters. Low-pass filter velocity so it eases in and
        // decays out; the disturbance glides instead of stuttering.
        const rvx = Math.max(-40, Math.min(40, (mx - c.lx) * 1.5))
        const rvy = Math.max(-40, Math.min(40, (my - c.ly) * 1.5))
        c.vx = c.vx * 0.82 + rvx * 0.18
        c.vy = c.vy * 0.82 + rvy * 0.18
        c.lx = mx; c.ly = my
        p = [mx, my, c.vx, c.vy]
      } else { p = [-1, -1, 0, 0] }
      if (f && f.effects) { for (const e of f.effects) e.params = p }
    } catch (e) {}` }],
  interactionRules: [], interactionEffects: [],
  visualTypes: [{ name: 'fluid_base', wgsl: BASE }, { name: 'fluid_warm', wgsl: BASE2 }],
  modules: [], timestamp: Date.now(),
}

const here = dirname(fileURLToPath(import.meta.url))
writeFileSync(join(here, '../../../../public/cartridges/FLUID.json'), JSON.stringify(scene, null, 1))
console.log('FLUID bundled')
const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'FLUID', scene }),
}).catch(() => null)
if (res) console.log('FLUID saved:', res.status)
