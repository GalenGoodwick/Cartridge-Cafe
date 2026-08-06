// GLOAM — attention is the only light.
//
// You are not in this world; you are the looking. A coin of light travels with
// your pointer, and the ground — and a small wandering life — exist ONLY where
// the light falls. Left unlit, the world is void, and the wanderer falls through
// it. CLICK to tend a star where you look: a self-lit floating stepping-stone
// across the dark. But the sky holds only six; tend a seventh and the oldest
// fades. Forgetting is built in. Light the wanderer's path east, bridge three
// chasms with stars, and carry it home to the far warmth.
//
// ARCHITECTURE (the one-truth pattern from CINDERFELL):
//   · The terrain gl_h(x) is written TWICE — once in WGSL (renders the hills),
//     once in the JS step hook (collides the wanderer) — kept identical.
//   · The whiteboard (worldData.gpuUniforms, 40 floats) is the only channel: the
//     hook simulates, the shader only reads.
//   · "Lit" is a pure function of the gaze coin + the tended stars — no grid, no
//     texture — so existence itself is recomputed every pixel and every step.
//
// Whiteboard:
//   0 t   1 moteX  2 moteY  3 vx  4 vy  5 alive01
//   6 gazeX 7 gazeY 8 gazeStr  9 camX 10 camY  11 dawn01 12 goalX 13 win01
//   14 anchorCount 15 intro01 16 respawn
//   20+i*3 : anchor[i] x / y / life   (i = 0..5)
//
//   Save+load:  node gloam-cartridge.mjs   (then open /hub/GLOAM)

// ───────────────────────────────────────────────────────── the visual ──
const WORLD = /* wgsl */`
fn gl_hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn gl_noise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gl_hash(i), gl_hash(i + vec2f(1.0, 0.0)), u.x),
             mix(gl_hash(i + vec2f(0.0, 1.0)), gl_hash(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn gl_fbm(p: vec2f) -> f32 {
  var v = 0.0; var a = 0.5; var q = p;
  for (var i = 0; i < 4; i++) { v += a * gl_noise(q); q = q * 2.02 + vec2f(11.0, 7.0); a *= 0.5; }
  return v;
}
// THE TERRAIN — the one truth. Mirrored exactly in the JS hook.
fn gl_h(x: f32) -> f32 {
  var h = 74.0 + 30.0 * sin(x * 0.0060 + 0.5) + 16.0 * sin(x * 0.0130 + 2.1) + 8.0 * sin(x * 0.0270 + 4.0);
  h = mix(h, 96.0, exp(-(x * x) / 40000.0));                          // the start pad
  h = mix(h, 88.0, 0.9 * exp(-((x - 2600.0) * (x - 2600.0)) / 20000.0)); // the home terrace
  return h;
}
// the three chasms — where no ground exists at all (bridge them with stars)
fn gl_chasm(x: f32) -> f32 {
  let c1 = smoothstep(628.0, 652.0, x) * (1.0 - smoothstep(918.0, 942.0, x));
  let c2 = smoothstep(1468.0, 1492.0, x) * (1.0 - smoothstep(1748.0, 1772.0, x));
  let c3 = smoothstep(2108.0, 2132.0, x) * (1.0 - smoothstep(2328.0, 2352.0, x));
  return max(c1, max(c2, c3));
}

fn visual_gloam(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let t = uni(0);
  let HALF = 300.0;
  let su = vec2f(uv.x, -uv.y);                     // compute path: +y is down; flip to y-up
  let camX = uni(9); let camY = uni(10);
  let wp = vec2f(camX + su.x * HALF, camY + su.y * HALF);
  let gx = uni(6); let gy = uni(7); let gstr = uni(8);
  let mx = uni(1); let my = uni(2); let alive = uni(5);
  let dawn = uni(11); let win = uni(13); let goalX = uni(12);
  let intro = uni(15);

  // ── the gloam: deep dark, a breath of indigo, cold star-motes in the void ──
  let depth = clamp((camY - wp.y) / 600.0, 0.0, 1.0);
  var c = mix(vec3f(0.011, 0.014, 0.026), vec3f(0.003, 0.004, 0.010), depth);
  c += vec3f(0.010, 0.014, 0.030) * gl_fbm(wp * 0.004 + vec2f(0.0, t * 0.02));   // faint nebula
  {
    let sp = wp * 0.05;
    let id = floor(sp);
    let r = gl_hash(id);
    let off = (vec2f(gl_hash(id + 3.0), gl_hash(id + 7.0)) - 0.5) * 0.7;
    let d = length(fract(sp) - 0.5 - off);
    let tw = 0.6 + 0.4 * sin(t * (1.0 + r * 2.5) + r * 40.0);
    c += vec3f(0.5, 0.6, 0.85) * smoothstep(0.985, 0.999, r) * smoothstep(0.20, 0.02, d) * tw * 0.7;
  }

  // ── the light field: your gaze coin + the tended stars ──
  var L = 0.0;
  var warm = vec3f(0.0);
  if (gstr > 0.01) {
    let dg = length(wp - vec2f(gx, gy));
    let coin = gstr * exp(-(dg * dg) / (2.0 * 78.0 * 78.0));
    L += coin;
    warm += vec3f(1.0, 0.86, 0.62) * coin;
  }
  for (var i = 0; i < 6; i++) {
    let ax = uni(20 + i * 3); let ay = uni(21 + i * 3); let al = uni(22 + i * 3);
    if (al > 0.01) {
      let da = length(wp - vec2f(ax, ay));
      let pool = al * exp(-(da * da) / (2.0 * 52.0 * 52.0));
      L += pool;
      warm += vec3f(1.0, 0.80, 0.55) * pool;
    }
  }
  // the two shores are always faintly held — start and home, so you have landmarks
  let ds = (wp.x - 30.0) / 120.0;    L += 0.16 * exp(-ds * ds);
  let dh = (wp.x - goalX) / 170.0;   L += 0.14 * exp(-dh * dh);
  L = clamp(L, 0.0, 1.4);

  // ── ground: exists only where light falls (attention is existence) ──
  let solidM = 1.0 - gl_chasm(wp.x);
  let Hs = gl_h(wp.x);
  let below = Hs - wp.y;                            // >0 = underground
  let aa = 1.4;
  let groundBody = smoothstep(-aa, aa, below) * solidM;
  if (groundBody > 0.001) {
    let lit = smoothstep(0.02, 0.28, L);
    let n1 = gl_fbm(wp * 0.05);
    let n2 = gl_fbm(wp * 0.22);
    var g = mix(vec3f(0.05, 0.08, 0.07), vec3f(0.10, 0.12, 0.10), n1);
    g *= 0.6 + 0.8 * n2;
    g = g * (0.35 + 1.5 * L) + warm * 0.22;
    let edge = smoothstep(6.0, 0.0, abs(below));    // a grass-line at the surface
    g += vec3f(0.5, 0.7, 0.4) * edge * lit * 0.5;
    c = mix(c, g, groundBody * lit);
  }

  // ── the tended stars: a steady bright point + soft halo, dimming as it ages ──
  for (var i = 0; i < 6; i++) {
    let ax = uni(20 + i * 3); let ay = uni(21 + i * 3); let al = uni(22 + i * 3);
    if (al > 0.02) {
      let d = length(wp - vec2f(ax, ay));
      let core = exp(-(d * d) / (2.0 * 3.5 * 3.5));
      let halo = exp(-(d * d) / (2.0 * 16.0 * 16.0));
      c += vec3f(1.5, 1.25, 0.85) * core * al * 1.4 + vec3f(0.8, 0.65, 0.45) * halo * al * 0.5;
    }
  }

  // ── the gaze coin (you) — a warm eye of light, an outline and a soft fill ──
  if (gstr > 0.01) {
    let d = length(wp - vec2f(gx, gy));
    let ring = smoothstep(80.0, 74.0, d) * smoothstep(70.0, 78.0, d);
    c += vec3f(1.0, 0.85, 0.6) * gstr * (0.05 * exp(-(d * d) / (2.0 * 70.0 * 70.0)) + 0.30 * ring);
  }

  // ── the wanderer — a small life, always faintly seen even in the dark ──
  {
    let d = length(wp - vec2f(mx, my));
    let breathe = 0.85 + 0.15 * sin(t * 4.0);
    c += vec3f(1.6, 0.7, 0.35) * alive * breathe * (6.0 / (d * d * 0.05 + 8.0));
    c += vec3f(2.2, 1.4, 0.8) * alive * smoothstep(5.0, 0.0, d);
  }

  // ── the far hearth (home) — brightens as the dark lifts ──
  {
    let hp = vec2f(goalX, gl_h(goalX) + 26.0);
    let d = length(wp - hp);
    c += vec3f(1.5, 0.9, 0.5) * (0.4 + 0.6 * dawn) * (55.0 / (d * d * 0.02 + 40.0));
  }

  // ── dawn lifts the dark when the wanderer comes home ──
  c += (vec3f(0.05, 0.07, 0.13) + vec3f(0.22, 0.14, 0.06)) * dawn * (1.0 - depth * 0.5);

  c *= intro;
  return vec4f(c, 1.0);                             // linear HDR — the engine grades it
}`

// ───────────────────────────────────────────────────────── the step hook ──
const HOOK = `
try {
  const wd = sim.worldData
  const HALF = 300, GRAV = 520, MOTE_R = 6, MOTE_SPEED = 52, DEATH_Y = -200, MAXA = 6
  const GAZE_GROUND = 82, ANCH_R = 34, ANCH_HOLD = 0.25, GOALX = 2600
  if (!wd.__gl || wd.__gl.v !== 1) wd.__gl = {
    v: 1, t: 0, mx: 0, my: 0, vx: 0, vy: 0, grounded: 0, alive: 1,
    gx: 0, gy: 0, gstr: 0, camX: 0, camY: 120, anchors: [],
    wasDown: false, wasSpace: false, dying: false, deadT: 0, respawn: 0,
    cp: { x: 0, y: 0 }, intro: 0, win: 0, dawn: 0, resetT: 0, sungWin: false, woke: false
  }
  const G = wd.__gl
  const step = Math.min(dt, 1 / 30)
  G.t += step
  G.intro = Math.min(1, G.intro + step * 0.9)

  // ── THE TERRAIN — mirror of gl_h / gl_chasm in WORLD. One truth. ──
  const mixN = (a, b, m) => a + (b - a) * m
  const gl_h = x => {
    let h = 74 + 30 * Math.sin(x * 0.0060 + 0.5) + 16 * Math.sin(x * 0.0130 + 2.1) + 8 * Math.sin(x * 0.0270 + 4.0)
    h = mixN(h, 96, Math.exp(-(x * x) / 40000))
    h = mixN(h, 88, 0.9 * Math.exp(-((x - 2600) * (x - 2600)) / 20000))
    return h
  }
  const inChasm = x => (x > 640 && x < 930) || (x > 1480 && x < 1760) || (x > 2120 && x < 2340)

  if (G.cp.x === 0 && G.cp.y === 0) { G.cp = { x: 0, y: gl_h(0) + MOTE_R }; G.mx = 0; G.my = gl_h(0) + MOTE_R }

  // ── the gaze: your pointer, into world space through the camera ──
  const hasMouse = (typeof wd.mouse_x === 'number' && typeof wd.mouse_y === 'number')
  if (hasMouse) {
    const sux = (wd.mouse_x - 256) / 256
    const suy = -(wd.mouse_y - 256) / 256
    G.gx = G.camX + sux * HALF
    G.gy = G.camY + suy * HALF
  }
  G.gstr = mixN(G.gstr, hasMouse ? 1 : 0, 1 - Math.exp(-6 * step))
  if (!G.woke && G.gstr > 0.3) G.woke = true   // it sleeps on the shore until first light finds it

  // ── tend a star: click (or SPACE), rising edge, with light present ──
  const down = !!wd.mouse_down, space = !!wd.key_space
  const plant = ((down && !G.wasDown) || (space && !G.wasSpace)) && G.gstr > 0.3 && !G.dying
  if (plant) {
    G.anchors.push({ x: G.gx, y: G.gy, life: 0.02, born: G.t, fading: false })
    wd.__play_sound = [
      { frequency: 660, duration: 0.18, volume: 0.16, type: 'sine' },
      { frequency: 990, duration: 0.22, volume: 0.10, type: 'sine' },
    ]
  }
  G.wasDown = down; G.wasSpace = space

  // ── stars grow in; the cap forces the oldest to fade (forgetting is built in) ──
  const live = G.anchors.filter(a => !a.fading)
  if (live.length > MAXA) { live.sort((a, b) => a.born - b.born); live[0].fading = true }
  for (const a of G.anchors) {
    if (a.fading) a.life -= step / 1.0
    else a.life = Math.min(1, a.life + step * 4)
  }
  G.anchors = G.anchors.filter(a => a.life > 0.001)

  // ── the wanderer: gravity, self-propel home on lit ground, fall in the dark ──
  if (!G.woke) {
    G.mx = 0; G.my = gl_h(0) + MOTE_R; G.vx = 0; G.vy = 0; G.grounded = 1   // resting on the shore
  } else if (!G.dying) {
    G.vy -= GRAV * step
    // highest support under the wanderer: lit terrain, or a tended star
    let Ysup = -1e9, onTerra = false
    if (!inChasm(G.mx) && G.gstr > 0.35 && Math.abs(G.mx - G.gx) < GAZE_GROUND) {
      const h = gl_h(G.mx); if (h > Ysup) { Ysup = h; onTerra = true }
    }
    for (const a of G.anchors) {
      if (a.life > ANCH_HOLD && Math.abs(G.mx - a.x) < ANCH_R) { if (a.y > Ysup) { Ysup = a.y; onTerra = false } }
    }
    const hasSup = Ysup > -1e8
    G.grounded = 0
    G.mx += G.vx * step
    G.my += G.vy * step
    if (hasSup && G.my - MOTE_R <= Ysup && G.vy <= 0 && G.my > Ysup - 30) {
      G.my = Ysup + MOTE_R; G.vy = 0; G.grounded = 1
      if (onTerra) G.cp = { x: G.mx, y: Ysup + MOTE_R }   // checkpoint: last lit earth
    }
    if (G.grounded) G.vx = mixN(G.vx, MOTE_SPEED, 1 - Math.exp(-3 * step))  // it wants to go home
    else G.vx *= 0.995
    if (G.mx < -60) { G.mx = -60; G.vx = Math.max(0, G.vx) }
    if (G.my < DEATH_Y) {
      G.dying = true; G.deadT = 0
      wd.__play_sound = [{ frequency: 70, duration: 0.5, volume: 0.18, type: 'sine' }]
    }
    if (G.mx >= GOALX) G.win = 1
  } else {
    G.deadT += step
    if (G.deadT > 0.6) { G.mx = G.cp.x; G.my = G.cp.y; G.vx = 0; G.vy = 0; G.dying = false; G.respawn = 1 }
  }
  G.alive = mixN(G.alive, G.dying ? 0 : 1, 1 - Math.exp(-8 * step))
  G.respawn = Math.max(0, G.respawn - step * 2)

  // ── dawn: a little with progress, full when it's home ──
  G.dawn = mixN(G.dawn, G.win ? 1 : Math.min(0.35, G.mx / GOALX * 0.35), 1 - Math.exp(-1.2 * step))
  if (G.win && !G.sungWin) {
    G.sungWin = true
    wd.__play_sound = [
      { frequency: 294, duration: 1.6, volume: 0.18, type: 'sine' },
      { frequency: 392, duration: 1.8, volume: 0.14, type: 'sine' },
      { frequency: 588, duration: 2.2, volume: 0.10, type: 'sine' },
    ]
  }

  // ── hold R: the dark returns ──
  G.resetT = wd.key_r ? G.resetT + step : 0
  if (G.resetT > 1.2) {
    G.anchors = []; G.mx = 0; G.my = gl_h(0) + MOTE_R; G.vx = 0; G.vy = 0
    G.win = 0; G.sungWin = false; G.dawn = 0; G.dying = false; G.woke = false
    G.cp = { x: 0, y: gl_h(0) + MOTE_R }; G.resetT = 0
    wd.__play_sound = [{ frequency: 110, duration: 0.5, volume: 0.14, type: 'sine' }]
  }

  // ── camera follows the wanderer ──
  const lookX = G.mx + G.vx * 0.25
  G.camX += (lookX - G.camX) * (1 - Math.exp(-3.2 * step))
  G.camY += ((G.my + HALF * 0.18) - G.camY) * (1 - Math.exp(-2.8 * step))

  // pin the fullscreen field
  for (const f of sim.fields.values()) {
    if ((f.name || '') === 'Gloam') { const T = f.transform; T.x = 256; T.y = 256; T.vx = 0; T.vy = 0 }
  }

  // ── publish the whiteboard ──
  const U = new Array(40).fill(0)
  U[0] = G.t; U[1] = G.mx; U[2] = G.my; U[3] = G.vx; U[4] = G.vy; U[5] = G.alive
  U[6] = G.gx; U[7] = G.gy; U[8] = G.gstr; U[9] = G.camX; U[10] = G.camY
  U[11] = G.dawn; U[12] = GOALX; U[13] = G.win; U[14] = G.anchors.length; U[15] = G.intro; U[16] = G.respawn
  const pub = G.anchors.slice().sort((a, b) => b.life - a.life).slice(0, 6)
  for (let i = 0; i < 6; i++) { const a = pub[i]; if (a) { U[20 + i * 3] = a.x; U[21 + i * 3] = a.y; U[22 + i * 3] = a.life } }
  wd.gpuUniforms = U
} catch (e) { /* the dark keeps its shape */ }
`

// ─────────────────────────────────────────────────────────────── build ──
const field = (id, name, color, x, y, shape, visualTypeName) => ({
  id, name, color,
  effects: [], memory: [], proximity: [], properties: {},
  transform: { x, y, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
  ...shape,
  visualTypeName,
})

const INSTRUCTIONS = [
  'GLOAM — attention is the only light.',
  '',
  'Move your pointer: a coin of light travels with your gaze. The ground —',
  'and the small wandering life — exist ONLY where the light falls. Left',
  'unlit, the world is void, and the wanderer falls through it.',
  '',
  'CLICK to tend a star where you look: a self-lit stepping-stone across the',
  'dark. But the sky holds only six — tend a seventh and the oldest fades.',
  'Forgetting is built in.',
  '',
  'Light the path east. Bridge the three chasms with stars.',
  'Carry it home to the far warmth.   (hold R — the dark returns)',
].join('\\n')

const scene = {
  name: 'GLOAM',
  fields: [
    field('gl_f', 'Gloam', [0.01, 0.013, 0.024, 1], 256, 256, { shapeType: 'rect', w: 512, h: 512 }, 'gloam'),
  ],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: {
    noPixelSampling: true,
    singlePlayer: true,
    instructions: INSTRUCTIONS,
    blurb: 'A world you can only see a coin of at a time. Tend stars, carry a small life home through the dark.',
    postProcess: { bloomIntensity: 0.55, bloomThreshold: 0.55, exposure: 1.02, vignetteStrength: 0.42, vignetteRadius: 0.78 },
  },
  stepHooks: [{ id: 'gloam_core', author: 'Claude Fable 5', description: 'GLOAM: the wanderer collides lit terrain + tended stars; gaze reveals; forgetting cap.', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [
    { name: 'gloam', wgsl: WORLD },
  ],
  modules: [],
  timestamp: Date.now(),
}

// bake into the repo shelf AND save into the live store (like FLUID)
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
writeFileSync(join(here, '../../../../public/cartridges/GLOAM.json'), JSON.stringify(scene, null, 1))

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'GLOAM', scene, overwrite: true }),
})
console.log('GLOAM saved:', res.status, (await res.text()).slice(0, 200))
