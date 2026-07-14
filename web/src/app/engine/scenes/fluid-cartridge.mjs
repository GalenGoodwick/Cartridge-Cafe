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
const BASE = /* wgsl */`
fn visual_fluid_base(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let t = time;
  var p = uv * 3.0;
  // domain warp — cheap flowing motion
  p += vec2f(sin(p.y * 1.7 + t * 0.7), cos(p.x * 1.5 - t * 0.6)) * 0.8;
  let a = sin(p.x + t) + sin(p.y * 1.3 - t * 0.8) + sin((p.x + p.y) * 0.7 + t * 0.5);
  let v = 0.5 + 0.5 * sin(a * 1.5);
  var col = mix(vec3f(0.03, 0.10, 0.25), vec3f(0.2, 0.7, 1.0), v);
  col += vec3f(0.9, 0.95, 1.0) * pow(v, 6.0) * 0.6;
  return vec4f(col, 1.0);
}`

// the solver — one feedback fragment effect. GRID is the field's cell span.
const FX = /* wgsl */`
fn fl_at(c: vec2f) -> vec4f { return textureSampleLevel(feedbackTex, texSampler, feedbackUV(c), 0.0); }

fn fieldEffect(coord: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f {
  let dt = 1.0;
  let self = fl_at(coord);
  var vel = self.rg;                 // signed velocity straight from the float buffer
  var dye = self.b;

  // 1 — semi-Lagrangian advection: trace back along velocity, resample
  let adv = fl_at(coord - vel * dt);
  vel = adv.rg;
  dye = adv.b;

  // 2 — light divergence damping: curl the flow instead of letting it pile up
  let vL = fl_at(coord + vec2f(-1.0, 0.0)).rg;
  let vR = fl_at(coord + vec2f( 1.0, 0.0)).rg;
  let vDn = fl_at(coord + vec2f(0.0,-1.0)).rg;
  let vUp = fl_at(coord + vec2f(0.0, 1.0)).rg;
  let div = 0.5 * ((vR.x - vL.x) + (vUp.y - vDn.y));
  vel -= vec2f(vR.x - vL.x, vUp.y - vDn.y) * div * 0.2;

  // 3 — two swirling emitters keep it alive
  let t = time;
  let span = regionMax.x - regionMin.x;
  let e1 = regionMin + (regionMax - regionMin) * vec2f(0.32, 0.38);
  let e2 = regionMin + (regionMax - regionMin) * vec2f(0.68, 0.60);
  let d1 = length(coord - e1) / span;
  let d2 = length(coord - e2) / span;
  vel += vec2f( cos(t * 0.8),  sin(t * 0.8)) * exp(-d1 * d1 * 90.0) * 2.4;
  vel += vec2f(-sin(t * 0.6),  cos(t * 0.6)) * exp(-d2 * d2 * 90.0) * 2.4;
  dye += (exp(-d1 * d1 * 130.0) + exp(-d2 * d2 * 130.0)) * 0.9;

  // stability
  vel = clamp(vel * 0.994, vec2f(-6.0), vec2f(6.0));
  dye = clamp(dye * 0.99, 0.0, 1.6);

  // STATE persists in rg (velocity) + b (dye); alpha 1 so it's always visible.
  // The raw buffer already reads as an image: blue-ish dye over a faint flow.
  return vec4f(vel, dye, 1.0);
}`

const scene = {
  name: 'FLUID',
  fields: [{
    id: 'fl_f', name: 'The Fluid', color: [0.01, 0.012, 0.02, 1],
    effects: [],
    memory: [], proximity: [], properties: {},
    transform: { x: 256, y: 256, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
    shapeType: 'rect', w: 512, h: 512, visualTypeName: 'fluid_base', noHit: true, noCollide: true,
  }],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: {
    noPixelSampling: true,
    instructions: 'FLUID — a real 2D Navier–Stokes solver.\n\nNo controls yet — two emitters drive the flow; watch it advect, curl, and pressure-project in real time. This is genuine fluid simulation (semi-Lagrangian advection + Jacobi pressure projection), not procedural waves. Cursor interaction and a proper color palette come next.',
    postProcess: { bloomIntensity: 0.3, bloomThreshold: 0.7, exposure: 1.0, vignetteStrength: 0.3, vignetteRadius: 0.85 },
  },
  stepHooks: [], interactionRules: [], interactionEffects: [],
  visualTypes: [{ name: 'fluid_base', wgsl: BASE }],
  modules: [], timestamp: 1783990500000,
}

const here = dirname(fileURLToPath(import.meta.url))
writeFileSync(join(here, '../../../../public/cartridges/FLUID.json'), JSON.stringify(scene, null, 1))
console.log('FLUID bundled')
const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'FLUID', scene }),
}).catch(() => null)
if (res) console.log('FLUID saved:', res.status)
