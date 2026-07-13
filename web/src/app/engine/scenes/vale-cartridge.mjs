// VALE — elemental physics fields, tended by behaviors.
//
// The whole screen is three coupled fields living in the frame itself
// (cell shaders): HEAT spreads and climbs, eats GROWTH for fuel, dies to
// WATER (steam); WATER diffuses and runs downhill along the terrain,
// evaporates near heat, feeds growth; GROWTH creeps into moisture.
//
// Three keepers manage the reactions — behavior zones over a living PDE:
//   the RAIN SPRITE seeks the hottest dry ground and rains on it
//   the FIRE IMP seeks the lushest grove, torches it, and flees the sprite
//   the GARDENER TURTLE walks to moist barren land and sows
// Their bodies ARE their element: drawing themselves writes heat/water/seed
// into the world — to act is to exist. You join with a pouring hand.
//
// Encode trick: the terrain T(uv) is deterministic, so state stores as
// T + element and decodes exactly: display floor = the landscape.
// Save+load: node vale-cartridge.mjs
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const WORLD = /* wgsl */`
// ── the land, painted: relief light, hill shadows, strata, valley ambience ──
fn vl_height(uv: vec2f) -> f32 {
  return fbm(uv * 2.1 + vec2f(7.3, 2.9), 4);
}
fn vl_terr(uv: vec2f) -> vec3f {
  let h = vl_height(uv);
  var c = mix(vec3f(0.055, 0.042, 0.030), vec3f(0.135, 0.105, 0.068), smoothstep(0.25, 0.6, h));
  c = mix(c, vec3f(0.10, 0.095, 0.10), smoothstep(0.60, 0.78, h));
  c = mix(c, c * 0.75, smoothstep(0.62, 0.78, h) * step(0.5, fract(h * 26.0)));
  c *= 0.88 + 0.24 * fbm(uv * 14.0, 3);
  let e = 0.010;
  let gx = vl_height(uv + vec2f(e, 0.0)) - h;
  let gy = vl_height(uv + vec2f(0.0, e)) - h;
  let n3 = normalize(vec3f(-gx * 6.0, -gy * 6.0, 1.0));
  let l3 = normalize(vec3f(-0.55, -0.65, 0.55));
  var lit = 0.35 + 0.85 * max(dot(n3, l3), 0.0);
  var occ = 0.0;
  for (var sm2 = 1; sm2 <= 3; sm2++) {
    let hs = vl_height(uv + vec2f(0.03, 0.035) * f32(sm2));
    occ = max(occ, (hs - h) - 0.05 * f32(sm2));
  }
  lit *= 1.0 - clamp(occ * 2.2, 0.0, 0.5);
  return c * lit + vec3f(0.010, 0.014, 0.022) * smoothstep(0.4, 0.15, h);
}

// element color space: fire is ORANGE, growth is FOLIAGE, water is BASIN
// BLUE — a fixed invertible matrix, decoded exactly through its inverse
const VL_M = mat3x3f(
  vec3f(1.05000, 0.42000, 0.06000),
  vec3f(0.06000, 0.46000, 0.09000),
  vec3f(0.02000, 0.12000, 0.50000));
const VL_MI = mat3x3f(
  vec3f(1.00460, -0.92944, 0.04675),
  vec3f(-0.12924, 2.40059, -0.41660),
  vec3f(-0.00917, -0.53896, 2.09811));

// per-element texture — deterministic, divided right back out on decode
fn vl_tex(uv: vec2f) -> vec3f {
  let h = vl_height(uv);
  let flameGrain = 0.85 + 0.35 * fbm(uv * 22.0 + 5.0, 2);
  let canopy = 0.55 + 0.85 * smoothstep(0.25, 0.85, fbm(uv * 9.0 + 13.0, 3));
  let depth = 0.65 + 0.9 * smoothstep(0.4, 0.18, h);
  return vec3f(flameGrain, canopy, depth);
}
fn vl_dec(uv: vec2f, px: vec4f) -> vec3f {
  let ee = VL_MI * (px.rgb - vl_terr(uv));
  let tx = vl_tex(uv);
  return max(vec3f(ee.x / tx.x, ee.y / tx.y, ee.z / tx.z), vec3f(0.0));   // H, G, W
}
fn vl_enc(uv: vec2f, H: f32, G: f32, W: f32) -> vec3f {
  let tx = vl_tex(uv);
  return vl_terr(uv) + VL_M * vec3f(H * tx.x, G * tx.y, W * tx.z);
}

fn visual_vale(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let t = time;
  let booted = uni(3) > 0.5;
  let upp = 2.0 / max(frame.resolution.y, 1.0);

  if (!booted) {
    let h = vl_height(uv);
    let W0 = smoothstep(0.34, 0.20, h) * 0.9;
    let G0 = smoothstep(0.44, 0.33, h) * (1.0 - W0) * 0.85 * smoothstep(0.35, 0.6, fbm(uv * 6.0, 3));
    return vec4f(vl_enc(uv, 0.0, G0, W0), 1.0);
  }

  let cs = vl_dec(uv, prevHere());
  var H = cs.x;
  var G = cs.y;
  var W = cs.z;
  var lapH = -H;
  var lapW = -W;
  var lapG = -G;
  var NO = array<vec2f, 4>(vec2f(2.0, 0.0), vec2f(-2.0, 0.0), vec2f(0.0, 2.0), vec2f(0.0, -2.0));
  for (var j = 0; j < 4; j++) {
    let o = NO[j];
    let n = vl_dec(uv + o * upp, prevAt(o));
    lapH += 0.25 * n.x;
    lapG += 0.25 * n.y;
    lapW += 0.25 * n.z;
  }
  let e2 = 0.02;
  let hh = vl_height(uv);
  let dh = vec2f(vl_height(uv + vec2f(e2, 0.0)) - hh, vl_height(uv + vec2f(0.0, e2)) - hh);
  let up2 = normalize(dh + vec2f(1e-5)) * 2.0;
  let uphill = vl_dec(uv + up2 * upp, prevAt(up2)).z;

  // reactions — the flame is alive: turbulence licks, embers crackle at fronts
  let burn = smoothstep(0.20, 0.5, H) * G;
  let quench = 2.4 * H * W;
  let flick = (hash21(floor(uv * 260.0) + floor(t * 24.0)) - 0.5);
  // fire needs fuel: on bare ground it starves fast — flicker is texture, not energy
  let starve = 0.055 + 0.11 * (1.0 - smoothstep(0.0, 0.12, G));
  H = H + 0.50 * lapH + burn * 0.9 - starve * H - quench * 0.016 + flick * min(H, 0.7) * 0.12;
  H = H + vl_dec(uv + vec2f(0.0, 2.0) * upp, prevAt(vec2f(0.0, 2.0))).x * 0.04;
  if (burn > 0.08 && hash21(floor(uv * 300.0) + floor(t * 9.0) * 3.7) > 0.997) { H += 0.25; }
  W = W + 0.32 * lapW + (uphill - W) * 0.10 * clamp(length(dh) * 18.0, 0.0, 1.0) - 0.35 * H * W * 0.016 - 0.0012;
  G = G + 0.045 * lapG + 0.14 * W * (1.0 - G) * smoothstep(0.02, 0.10, G + lapG) * 0.16 - burn * 0.05 - 0.0004 * G;
  if (hash21(floor(uv * 220.0) + floor(t * 0.5)) > 0.99993 && W > 0.15) { G = max(G, 0.25); }

  for (var k = 0; k < 3; k++) {
    let kp = vec2f(uni(4 + k * 3), uni(5 + k * 3));
    let act = uni(6 + k * 3);
    let d2 = dot(uv - kp, uv - kp);
    if (k == 0) {
      let rainCol = uv - kp - vec2f(sin(t * 7.0 + uv.y * 30.0) * 0.01, 0.05);
      W += (exp(-d2 * 900.0) * 0.010 + exp(-dot(rainCol, rainCol) * 300.0) * 0.028 * act);
    } else if (k == 1) {
      H += exp(-d2 * 1400.0) * (0.006 + 0.05 * act);
    } else {
      G += exp(-d2 * 1600.0) * (0.004 + 0.03 * act) * step(0.03, W);
    }
  }
  let m = vec2f(uni(0), uni(1));
  let pour = uni(2);
  if (pour > 0.5) {
    let pd = exp(-dot(uv - m, uv - m) * 1400.0);
    if (pour < 1.5) { H += pd * 0.10; }
    else if (pour < 2.5) { W += pd * 0.10; }
    else { G += pd * 0.06 * step(0.02, W + 0.02); }
  }

  H = clamp(H, 0.0, 2.4);
  W = clamp(W, 0.0, 1.4);
  G = clamp(G, 0.0, 1.0);
  var outp = vl_enc(uv, H, G, W);
  if (outp.x != outp.x || outp.y != outp.y || outp.z != outp.z) { outp = vl_terr(uv); }
  return vec4f(clamp(outp, vec3f(0.0), vec3f(8.0)), 1.0);
}`

const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__vl || !wd.__vl.grid) {
    wd.__vl = { age: 0, pour: 0, elem: 1, keys: {}, mn: 0,
      grid: { H: new Array(400).fill(0), W: new Array(400).fill(0), G: new Array(400).fill(0), init: 0 },
      keepers: [
        { x: -0.4, y: -0.4, tx: 0, ty: 0, act: 0, t: 1, sp: 0.26 },   // rain sprite
        { x: 0.5, y: 0.3, tx: 0, ty: 0, act: 0, t: 2, sp: 0.20 },     // fire imp
        { x: 0.0, y: 0.5, tx: 0, ty: 0, act: 0, t: 3, sp: 0.07 },     // gardener turtle
      ] }
  }
  const S = wd.__vl
  if (wd.__fresh) { delete wd.__fresh; S.age = 0; S.keys = {}; S.pour = 0 }
  const pdt = Math.min(dt, 0.05)
  S.age += pdt

  // ── the keepers' mental map: a coarse CPU shadow of the same ecology ──
  const N = 20
  const gI = (x, y) => (Math.max(0, Math.min(N - 1, y)) * N + Math.max(0, Math.min(N - 1, x)))
  const g = S.grid
  if (!g.init) {
    g.init = 1
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = (x / N) * 2 - 1, v = (y / N) * 2 - 1
      const h = 0.5 + 0.3 * Math.sin(u * 4 + 7.3) * Math.cos(v * 3 + 2.9)
      g.W[gI(x, y)] = h < 0.4 ? 0.7 : 0
      g.G[gI(x, y)] = h >= 0.4 && h < 0.55 ? 0.6 : 0
    }
  }
  // coarse dynamics, a few cells a frame is plenty
  for (let s2 = 0; s2 < 24; s2++) {
    const x = Math.floor(Math.random() * N), y = Math.floor(Math.random() * N)
    const i = gI(x, y)
    const burn = g.H[i] > 0.25 ? g.G[i] * 0.5 : 0
    g.H[i] = Math.max(0, g.H[i] * 0.97 + burn - g.W[i] * g.H[i] * 0.8)
    g.W[i] = Math.max(0, g.W[i] - g.H[i] * 0.05 - 0.001)
    g.G[i] = Math.max(0, Math.min(1, g.G[i] + g.W[i] * 0.004 - burn))
    // spread heat to a neighbor
    if (g.H[i] > 0.3) { const j = gI(x + (Math.random() < 0.5 ? 1 : -1), y); g.H[j] = Math.min(2, g.H[j] + g.H[i] * 0.15 * Math.max(0.1, g.G[j])) }
  }
  const cellUv = (x, y) => [((x + 0.5) / N) * 2 - 1, ((y + 0.5) / N) * 2 - 1]

  // ── keeper utility: each seeks what its element is FOR ──
  const K = S.keepers
  const seek = (score) => {
    let bx = 0, by = 0, best = -1e9
    for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) {
      const s3 = score(gI(x, y), x, y)
      if (s3 > best) { best = s3; bx = x; by = y }
    }
    return { c: cellUv(bx, by), v: best }
  }
  for (let k = 0; k < 3; k++) {
    const kp = K[k]
    kp.t -= pdt
    const dd = Math.hypot(kp.tx - kp.x, kp.ty - kp.y)
    if (dd > 0.03) {
      kp.x += (kp.tx - kp.x) / dd * Math.min(dd, kp.sp * pdt)
      kp.y += (kp.ty - kp.y) / dd * Math.min(dd, kp.sp * pdt)
      kp.act = 0
    } else if (kp.t > 0) {
      kp.act = 1
      // acting updates the mental map too
      const cx = Math.floor((kp.x + 1) / 2 * N), cy = Math.floor((kp.y + 1) / 2 * N)
      if (k === 0) { g.W[gI(cx, cy)] = Math.min(1.4, g.W[gI(cx, cy)] + pdt * 0.5); g.H[gI(cx, cy)] = Math.max(0, g.H[gI(cx, cy)] - pdt * 1.2) }
      if (k === 1) { g.H[gI(cx, cy)] = Math.min(2, g.H[gI(cx, cy)] + pdt * 0.8) }
      if (k === 2) { g.G[gI(cx, cy)] = Math.min(1, g.G[gI(cx, cy)] + pdt * 0.4) }
    }
    if (kp.t <= 0) {
      kp.t = 3 + Math.random() * 4
      if (k === 0) {
        // the sprite goes where it burns hottest and driest
        const tgt = seek(i => g.H[i] * 2 - g.W[i])
        kp.tx = tgt.c[0]; kp.ty = tgt.c[1]
      } else if (k === 1) {
        // the imp covets the lushest grove — but fears the rain
        const spr = K[0]
        const tgt = seek((i, x, y) => {
          const [ux, uy] = cellUv(x, y)
          return g.G[i] * 2 - g.H[i] + Math.hypot(ux - spr.x, uy - spr.y) * 0.8
        })
        kp.tx = tgt.c[0]; kp.ty = tgt.c[1]
      } else {
        // the turtle tends moist barren earth
        const tgt = seek(i => g.W[i] * (1 - g.G[i]) - g.H[i] * 2)
        kp.tx = tgt.c[0]; kp.ty = tgt.c[1]
      }
    }
  }

  // ── your hand ──
  const mx = ((wd.mouse_x ?? 256) - 256) / 256
  const my = ((wd.mouse_y ?? 256) - 256) / 256
  const edge = k => { const n = wd['key_' + k + '_n'] || 0; const was = S.keys[k] || 0; S.keys[k] = n; return n > was }
  if (edge('space')) S.elem = (S.elem % 3) + 1
  if (edge('r')) { S.age = 0; S.grid.init = 0; wd.__play_sound = { frequency: 240, duration: 0.25, volume: 0.3, type: 'sine' } }
  S.pour = wd.mouse_down ? S.elem : 0
  if (S.pour) {
    const cx = Math.floor((mx + 1) / 2 * N), cy = Math.floor((my + 1) / 2 * N)
    const i = gI(cx, cy)
    if (S.elem === 1) g.H[i] = Math.min(2, g.H[i] + pdt * 1.5)
    if (S.elem === 2) g.W[i] = Math.min(1.4, g.W[i] + pdt * 1.5)
    if (S.elem === 3) g.G[i] = Math.min(1, g.G[i] + pdt * 0.8)
  }

  const u = [mx, my, S.pour, S.age > 0.4 ? 1 : 0]
  for (const kp of K) u.push(kp.x, kp.y, kp.act)
  wd.gpuUniforms = u
  // cursor glyph: overlay HUD, so it can never pollute the element fields
  const iw = (typeof window !== 'undefined') ? window.innerWidth : 1024
  const ih = (typeof window !== 'undefined') ? window.innerHeight : 1024
  const side = Math.min(iw, ih)
  const cxp = Math.round((iw - side) / 2 + ((mx + 1) / 2) * side)
  const cyp = Math.round((ih - side) / 2 + ((my + 1) / 2) * side)
  wd.hud = [
    { id: 'vl_e', type: 'text', x: '14px', y: '12px',
      text: 'VALE \\u00b7 hand: ' + ['', 'FIRE', 'WATER', 'SEED'][S.elem] + ' (space cycles)', color: '#c9b370', fontSize: '13px' },
    { id: 'vl_cur', type: 'text', x: (cxp + 14) + 'px', y: (cyp - 22) + 'px',
      text: ['', '\\ud83d\\udd25', '\\ud83d\\udca7', '\\ud83c\\udf31'][S.elem],
      color: ['', '#ff8830', '#5ab8ff', '#7ade6a'][S.elem], fontSize: '17px' },
  ]
} catch (e) { /* the vale endures */ }
`

const scene = {
  name: 'VALE',
  fields: [{
    id: 'vl_f', name: 'The Vale',
    color: [0.05, 0.05, 0.04, 1],
    effects: [], memory: [], proximity: [], properties: {},
    transform: { x: 256, y: 256, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
    shapeType: 'rect', w: 512, h: 512, visualTypeName: 'vale', noHit: true, noCollide: true,
  }],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: {
    noPixelSampling: true,
    instructions: 'VALE — elemental fields, living in the frame: FIRE spreads and eats the green, WATER runs downhill and quenches it, GROWTH creeps into moisture.\n\nHOLD — pour your element where the cursor is. SPACE — cycle FIRE / WATER / SEED. R — begin the vale again.\n\nThree keepers manage the reactions with behaviors of their own: the rain sprite hunts fires, the fire imp torches the lushest grove (and flees the sprite), the gardener turtle sows moist barren earth. Their bodies ARE their element — existing is acting.\n\nThe point: set fires, flood valleys, plant forests — then watch the keepers argue with you.',
    postProcess: { bloomIntensity: 0.55, bloomThreshold: 0.6, exposure: 1.05, vignetteStrength: 0.3, vignetteRadius: 0.85 },
  },
  stepHooks: [{ id: 'vl_keepers', author: 'fable', description: 'VALE: keeper behaviors managing elemental reactions over a coarse mental map', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [{ name: 'vale', wgsl: WORLD }],
  modules: [],
  timestamp: Date.now(),
}

const here = dirname(fileURLToPath(import.meta.url))
writeFileSync(join(here, '../../../../public/cartridges/VALE.json'), JSON.stringify(scene, null, 1))
console.log('VALE bundled')

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'VALE', scene }),
}).catch(() => null)
if (res) console.log('saved:', res.status)
