// ASCENT — a one-thumb climb. A light rises up a narrow channel on its own;
// you DRAG left/right to weave it past drifting hazards. Your trail glows; the
// field reacts. Score is height. Touch-first and portrait by design — it reads
// only the pointer (mouse_x / mouse_down), never the keyboard, so it lives on
// the phone shelf. Bulletproof: the hook owns the sim, the shader only paints
// the uniforms it publishes. Build+register: node ascent-cartridge.mjs
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// ── uniform layout (48 floats), shared hook→shader ──
//  0 lx        light x (-CH..CH)        4 flash    death wash 0..1
//  1 LY        light screen y (fixed)   5 CH       channel half-width
//  2 alive     1 playing / 0 dead       6 started  0 before first tap
//  3 climb     total height climbed     7 speedN   speed 0..1 (colour heat)
//  8..15  trail x, 8 samples below the light (newest first)
//  16..39 hazards: 8 × (hx, screenY, r)   — r=0 means empty slot
//  40 time
const WORLD = /* wgsl */`
fn as_hue(h: f32) -> vec3f {
  return 0.5 + 0.5 * cos(6.2831853 * (h + vec3f(0.0, 0.33, 0.66)));
}

// the deep well the light climbs: a vertical gradient with a scrolling nebula
// and sparse stars, parallaxed by how far you've climbed
fn as_well(p: vec2f, climb: f32, t: f32) -> vec3f {
  let up = clamp(0.5 - p.y * 0.5, 0.0, 1.0);
  var c = mix(vec3f(0.020, 0.020, 0.055), vec3f(0.006, 0.010, 0.030), up);
  // nebula drifts down as you rise
  let q = vec2f(p.x * 0.9, p.y * 0.7 + climb * 0.5);
  c += vec3f(0.05, 0.06, 0.13) * fbm(q + vec2f(t * 0.02, 0.0), 4) * (0.5 + up);
  // stars, also scrolling with the climb
  let sp = vec2f(p.x * 7.0, p.y * 7.0 + climb * 3.0);
  let h = hash21(floor(sp));
  if (h > 0.972) {
    c += vec3f(0.7, 0.78, 0.95) * smoothstep(0.16, 0.0, length(fract(sp) - 0.5)) * (0.4 + 0.6 * sin(t * 2.0 + h * 50.0));
  }
  return c;
}

fn visual_ascent(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let t = time;
  let lx = uni(0);
  let LY = uni(1);
  let alive = uni(2);
  let climb = uni(3);
  let flash = uni(4);
  let CH = uni(5);
  let started = uni(6);
  let speedN = uni(7);

  // death shake: the whole field jitters as the light shatters
  var p = uv;
  p += flash * 0.018 * vec2f(sin(t * 83.0), cos(t * 71.0));

  var col = as_well(p, climb, t);

  // ── the channel walls: two glowing rails the light must stay between ──
  let wallX = CH + 0.14;
  let rail = smoothstep(0.06, 0.0, abs(abs(p.x) - wallX));
  col += vec3f(0.25, 0.5, 0.7) * rail * 0.6;
  // a soft haze past the rails so the playfield reads as a lit column
  col *= mix(1.0, 0.45, smoothstep(wallX, wallX + 0.35, abs(p.x)));

  // ── the trail: fading embers below the light where it has been ──
  for (var i = 0; i < 8; i++) {
    let tx = uni(8 + i);
    let ty = LY + f32(i + 1) * 0.055;
    let d = p - vec2f(tx, ty);
    let fall = 1.0 - f32(i) / 8.0;
    col += mix(vec3f(0.2, 0.7, 1.0), vec3f(0.9, 0.4, 1.0), speedN) * exp(-dot(d, d) * 900.0) * fall * 0.5;
  }

  // ── hazards: drifting rings of danger ──
  for (var i = 0; i < 8; i++) {
    let b = 16 + i * 3;
    let r = uni(b + 2);
    if (r > 0.001) {
      let hp = vec2f(uni(b), uni(b + 1));
      let d = length(p - hp);
      let pulse = 0.5 + 0.5 * sin(t * 5.0 + f32(i) * 1.7);
      // bright ring + warm core
      let ring = exp(-pow((d - r) / (0.02 + 0.02 * pulse), 2.0));
      let coreGlow = exp(-d * d * 26.0);
      let danger = mix(vec3f(1.0, 0.35, 0.18), vec3f(1.0, 0.7, 0.2), pulse);
      col += danger * ring * 1.4;
      col += vec3f(0.6, 0.12, 0.05) * coreGlow * 0.5;
    }
  }

  // ── the light: the player. A hot core with a soft halo ──
  if (started > 0.5) {
    let ld = p - vec2f(lx, LY);
    let dist = length(ld);
    let heat = mix(vec3f(0.5, 0.85, 1.0), vec3f(1.0, 0.55, 0.95), speedN);
    // when dead the core dims to an ember
    let vigor = mix(0.25, 1.0, alive);
    col += heat * exp(-dist * dist * 1500.0) * 2.6 * vigor;         // core
    col += heat * exp(-dist * dist * 120.0) * 0.7 * vigor;          // halo
    col += vec3f(1.0) * exp(-dist * dist * 5000.0) * vigor;         // white pip
  }

  // death wash
  col = mix(col, vec3f(0.9, 0.12, 0.08), flash * 0.5);

  col = col / (1.0 + col * 0.15);   // filmic-ish, lets the glows bloom
  if (col.x != col.x || col.y != col.y || col.z != col.z) { col = vec3f(0.02); }
  return vec4f(clamp(col, vec3f(0.0), vec3f(20.0)), 1.0);
}`

const HOOK = `
try {
  const wd = sim.worldData
  const CH = 0.60          // channel half-width the light travels within
  const LY = 0.42          // the light's fixed screen height (lower third)
  const AHEAD = 1.7        // how far above the light hazards are born
  const R_HAZ = 0.13       // hazard radius
  if (!wd.__as || wd.__fresh) {
    delete wd.__fresh
    wd.__as = { alive: 0, started: 0, climb: 0, lx: 0, speed: 0.55,
      haz: [], nextSpawn: 1.2, best: wd.__as ? wd.__as.best : 0,
      flash: 0, hist: [], mn: 0, milestone: 0, t: 0 }
  }
  const G = wd.__as
  const pdt = Math.min(dt, 0.05)
  G.t += pdt

  const mx = ((wd.mouse_x ?? 256) - 256) / 256
  const down = !!wd.mouse_down
  const mn = wd.mouse_down_n || 0
  const tapped = mn > G.mn
  if (tapped) G.mn = mn

  const reset = () => {
    G.alive = 1; G.started = 1; G.climb = 0; G.lx = 0; G.speed = 0.55
    G.haz = []; G.nextSpawn = 1.2; G.hist = []; G.milestone = 0
    wd.__play_sound = { frequency: 330, duration: 0.18, volume: 0.2, type: 'sine' }
  }

  // tap to begin, and tap to retry after a fall
  if (tapped && G.started < 0.5) reset()
  else if (tapped && G.alive < 0.5 && G.started > 0.5) reset()

  if (G.alive > 0.5) {
    // steer: the light eases toward the thumb's x while it's down
    if (down) {
      const target = Math.max(-CH, Math.min(CH, mx))
      G.lx += (target - G.lx) * Math.min(1, pdt * 13)
    }

    // climb: speed creeps up the higher you get
    G.speed = 0.55 + Math.min(0.9, G.climb * 0.012)
    G.climb += G.speed * pdt

    // record the trail (climb-keyed) so the tail shows the true path
    G.hist.push({ c: G.climb, x: G.lx })
    if (G.hist.length > 200) G.hist.shift()

    // spawn hazards ahead; density rises with height
    if (G.climb >= G.nextSpawn) {
      const pair = G.climb > 8 && Math.random() < 0.35
      const mk = () => {
        const x0 = (Math.random() * 2 - 1) * (CH - 0.05)
        G.haz.push({ y: G.climb + AHEAD, x0, amp: 0.1 + Math.random() * 0.28,
          ph: Math.random() * 6.28, sp: 0.6 + Math.random() * 1.1, r: R_HAZ })
      }
      mk(); if (pair) mk()
      G.nextSpawn = G.climb + Math.max(0.55, 0.95 - G.climb * 0.01)
    }

    // milestone chime every 100 "metres"
    const m = Math.floor(G.climb * 10)
    if (m >= G.milestone + 100) { G.milestone = Math.floor(m / 100) * 100
      wd.__play_sound = { frequency: 660, duration: 0.12, volume: 0.16, type: 'triangle' } }

    // move + test hazards
    for (let i = G.haz.length - 1; i >= 0; i--) {
      const hz = G.haz[i]
      const hx = Math.max(-CH, Math.min(CH, hz.x0 + hz.amp * Math.sin(G.t * hz.sp + hz.ph)))
      const screenY = LY - (hz.y - G.climb)
      hz._x = hx; hz._sy = screenY
      if (screenY > 1.35) { G.haz.splice(i, 1); continue }
      // collision with the light
      if (Math.abs(hx - G.lx) < 0.12 && Math.abs(screenY - LY) < 0.11) {
        G.alive = 0; G.flash = 1
        if (Math.floor(G.climb * 10) > G.best) G.best = Math.floor(G.climb * 10)
        wd.__play_sound = { frequency: 70, duration: 0.5, volume: 0.4, type: 'sine' }
      }
    }
  } else {
    // dead or waiting: hazards hold, flash decays
    for (const hz of G.haz) { hz._x = hz._x ?? hz.x0; hz._sy = hz._sy ?? -2 }
  }
  G.flash = Math.max(0, G.flash - pdt * 1.6)

  // ── HUD ── (the engine anchors text at its LEFT edge — no centering — so
  // everything is a deliberately left-aligned title card / score readout)
  const meters = Math.floor(G.climb * 10)
  if (G.started < 0.5) {
    wd.hud = [{ id: 'as_t', type: 'text', x: '8%', y: '36%', fontSize: '46px', color: '#dff6ff', text: 'ASCENT' },
              { id: 'as_h', type: 'text', x: '8%', y: '47%', fontSize: '15px', color: '#8fb6c9', text: 'drag to weave · tap to rise' }]
  } else if (G.alive < 0.5) {
    wd.hud = [{ id: 'as_s', type: 'text', x: '8%', y: '36%', fontSize: '42px', color: '#ffffff', text: meters + ' m' },
              { id: 'as_b', type: 'text', x: '8%', y: '46%', fontSize: '15px', color: '#8fb6c9', text: 'best ' + G.best + ' m' },
              { id: 'as_r', type: 'text', x: '8%', y: '53%', fontSize: '15px', color: '#ffcf8f', text: 'tap to retry' }]
  } else {
    wd.hud = [{ id: 'as_s', type: 'text', x: '6%', y: '5%', fontSize: '24px', color: '#dff6ff', text: '▲ ' + meters + ' m' }]
  }

  // ── uniforms ──
  const u = new Array(48).fill(0)
  u[0] = G.lx; u[1] = LY; u[2] = G.alive; u[3] = G.climb
  u[4] = G.flash; u[5] = CH; u[6] = G.started
  u[7] = Math.min(1, (G.speed - 0.55) / 0.9)
  // trail: 8 samples spaced 0.06 in screen-space below the light
  for (let i = 0; i < 8; i++) {
    const targetC = G.climb - (i + 1) * 0.06
    let bx = G.lx
    for (let k = G.hist.length - 1; k >= 0; k--) { if (G.hist[k].c <= targetC) { bx = G.hist[k].x; break } }
    u[8 + i] = bx
  }
  // hazards: nearest 8 to the light
  const vis = G.haz.filter(h => h._sy != null && h._sy > -1.6 && h._sy < 1.4)
    .sort((a, b) => Math.abs(a._sy - LY) - Math.abs(b._sy - LY)).slice(0, 8)
  for (let i = 0; i < vis.length; i++) {
    const o = 16 + i * 3
    u[o] = vis[i]._x; u[o + 1] = vis[i]._sy; u[o + 2] = vis[i].r
  }
  u[40] = G.t
  wd.gpuUniforms = u
} catch (e) { /* the climb forgives a stumble */ }
`

const scene = {
  name: 'ASCENT',
  fields: [{
    id: 'as_f', name: 'Ascent', color: [0.01, 0.01, 0.04, 1],
    effects: [], memory: [], proximity: [], properties: {},
    transform: { x: 256, y: 256, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
    shapeType: 'rect', w: 512, h: 512, visualTypeName: 'ascent', noHit: true, noCollide: true,
  }],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: {
    noPixelSampling: true,
    instructions: 'ASCENT — a one-thumb climb.\n\nA light rises on its own up a narrow channel. DRAG left and right to weave it past the drifting rings. Touch and hold to steer; let go and it holds its line.\n\nThe higher you climb the faster it goes. Your score is height. Tap to rise, tap to retry.',
    postProcess: { bloomIntensity: 0.8, bloomThreshold: 0.45, exposure: 1.05, vignetteStrength: 0.4, vignetteRadius: 0.8 },
  },
  stepHooks: [{ id: 'as_climb', author: 'fable', description: 'ASCENT: a rising light you drag past drifting hazards; height is score', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [{ name: 'ascent', wgsl: WORLD }],
  modules: [],
  timestamp: Date.now(),
}

const here = dirname(fileURLToPath(import.meta.url))
writeFileSync(join(here, '../../../../public/cartridges/ASCENT.json'), JSON.stringify(scene, null, 1))
console.log('ASCENT bundled')

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'ASCENT', scene }),
}).catch(() => null)
if (res) console.log('ASCENT saved:', res.status)
