// HANABI (花火) — a fireworks night over a still bay. Click anywhere to send one
// up; it bursts where you aimed. The sky keeps launching on its own. Every
// shell reflects in the water below. No goal — just the summer festival.
// Bulletproof by design: the hook only publishes burst events, the shader
// paints them. Save+load: node hanabi-cartridge.mjs
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const WORLD = /* wgsl */`
const HB_HORIZON: f32 = 0.42;   // where the sky meets the bay

fn hb_hue(h: f32) -> vec3f {
  // warm festival palette that never turns muddy
  return 0.55 + 0.45 * cos(6.2831853 * (h + vec3f(0.0, 0.33, 0.66)));
}

// one burst: an expanding shell of radial streaks, gravity-drooped, fading.
fn hb_burst(p: vec2f, cx: f32, cy: f32, age: f32, hue: f32, typ: f32, t: f32) -> vec3f {
  if (age <= 0.0 || age > 2.6) { return vec3f(0.0); }
  let g = 0.11;
  // willow (typ~2) droops and lingers; peony (typ~1) is round and quick
  let willow = step(1.5, typ);
  let speed = mix(0.42, 0.30, willow);
  let life = mix(1.7, 2.6, willow);
  let fade = smoothstep(life, 0.0, age) * smoothstep(0.0, 0.06, age);
  let c = vec2f(cx, cy + 0.5 * g * age * age * (0.6 + willow));   // sparks fall
  let d = length(p - c);
  let r = age * speed;
  let thick = 0.02 + age * 0.05;
  let shell = exp(-pow((d - r) / thick, 2.0));
  // radial streaks — the shell is made of individual comets
  let ang = atan2(p.y - c.y, p.x - c.x);
  let nstreak = 34.0;
  var streak = 0.5 + 0.5 * sin(ang * nstreak + hue * 40.0);
  streak = pow(streak, mix(1.5, 4.0, willow));
  // crackle: a bright twinkle late in the life
  let crackle = (0.5 + 0.5 * sin(t * 40.0 + ang * 80.0 + hue * 20.0)) * smoothstep(0.5, 1.4, age);
  var col = hb_hue(hue) * shell * (0.55 + 0.6 * streak) * fade;
  col += vec3f(1.0, 0.95, 0.8) * shell * streak * crackle * fade * 0.5;
  // the flash + core at birth
  col += (hb_hue(hue) * 0.6 + vec3f(1.0)) * exp(-d * d * 240.0) * smoothstep(0.12, 0.0, age) * 3.0;
  return col;
}

fn hb_sky(p: vec2f, t: f32) -> vec3f {
  let up = clamp(-p.y * 0.7 + 0.5, 0.0, 1.0);
  var c = mix(vec3f(0.05, 0.04, 0.10), vec3f(0.010, 0.014, 0.045), up);
  // stars
  let sp = p * 26.0;
  let h = hash21(floor(sp));
  if (h > 0.982 && p.y < HB_HORIZON) {
    c += vec3f(0.8, 0.82, 0.95) * smoothstep(0.18, 0.02, length(fract(sp) - 0.5)) * (0.4 + 0.5 * sin(t * 1.5 + h * 40.0));
  }
  // a low soft moon
  let mp = vec2f(0.62, -0.42);
  c += vec3f(0.7, 0.72, 0.65) * exp(-dot(p - mp, p - mp) * 90.0);
  c += vec3f(0.25, 0.26, 0.30) * exp(-dot(p - mp, p - mp) * 8.0) * 0.4;
  // milky haze
  c += vec3f(0.05, 0.04, 0.08) * fbm(p * 2.0 + vec2f(t * 0.01, 0.0), 3) * up;
  return c;
}

fn hb_all_bursts(p: vec2f, t: f32) -> vec3f {
  var col = vec3f(0.0);
  for (var i = 0; i < 8; i++) {
    let b = 4 + i * 4;
    let age = uni(b + 2);
    if (age > 0.001) {
      col += hb_burst(p, uni(b), uni(b + 1), age, uni(b + 3), uni(b + 3) * 3.0 + 1.0, t);
    }
  }
  return col;
}

fn visual_hanabi(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let t = time;
  let p = uv;
  var col: vec3f;

  if (p.y < HB_HORIZON) {
    // ── the sky ──
    col = hb_sky(p, t);
    col += hb_all_bursts(p, t);
    // rockets: an ascending ember with a short trail
    for (var r = 0; r < 3; r++) {
      let rb = 36 + r * 3;
      if (uni(rb + 2) > 0.5) {
        let rp = vec2f(uni(rb), uni(rb + 1));
        col += vec3f(1.0, 0.7, 0.35) * exp(-dot(p - rp, p - rp) * 2600.0) * 1.6;
        // trail below
        let td = p - rp;
        if (td.y > 0.0 && abs(td.x) < 0.006) {
          col += vec3f(1.0, 0.6, 0.25) * exp(-td.y * td.y * 90.0) * 0.5;
        }
      }
    }
  } else {
    // ── the bay: the sky and its fireworks, upside down and rippling ──
    let ry = HB_HORIZON - (p.y - HB_HORIZON) * 1.4;
    let wob = (fbm(vec2f(p.x * 3.0, p.y * 8.0 - t * 0.6), 3) - 0.5) * 0.03;
    let rp = vec2f(p.x + wob, ry + wob * 0.5);
    col = hb_sky(rp, t) * vec3f(0.5, 0.55, 0.7);
    col += hb_all_bursts(rp, t) * 0.6;
    col += vec3f(0.02, 0.03, 0.05) * (0.5 + fbm(vec2f(p.x * 6.0, p.y * 20.0 - t), 2));
    // the shoreline glimmer
    col += vec3f(0.3, 0.32, 0.4) * exp(-pow((p.y - HB_HORIZON) * 30.0, 2.0)) * 0.4;
  }

  // ── the city on the far shore: a silhouette with warm windows ──
  let bx = p.x * 5.0 + 20.0;
  let cell = floor(bx);
  let bh = HB_HORIZON - (0.05 + hash21(vec2f(cell, 1.0)) * 0.12);
  if (p.y > bh && p.y < HB_HORIZON + 0.004) {
    col = vec3f(0.02, 0.02, 0.035);
    let win = step(0.6, hash21(floor(vec2f(bx * 3.0, p.y * 40.0))));
    col += vec3f(0.9, 0.7, 0.35) * win * 0.5;
  }

  col = col / (1.0 + col * 0.14);   // filmic-ish, lets the bursts bloom
  if (col.x != col.x || col.y != col.y || col.z != col.z) { col = vec3f(0.02); }
  return vec4f(clamp(col, vec3f(0.0), vec3f(20.0)), 1.0);
}`

const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__hb) wd.__hb = { rockets: [], bursts: [], launchT: 0.4, mn: 0 }
  const H = wd.__hb
  if (wd.__fresh) { delete wd.__fresh; H.rockets = []; H.bursts = []; H.launchT = 0.4 }
  const pdt = Math.min(dt, 0.05)

  const mx = ((wd.mouse_x ?? 256) - 256) / 256
  const my = ((wd.mouse_y ?? 256) - 256) / 256

  const launch = (tx, ty) => {
    if (H.rockets.length >= 3) return
    const apex = Math.max(-0.55, Math.min(0.30, ty))         // where it will burst
    H.rockets.push({ x: Math.max(-0.9, Math.min(0.9, tx)), y: 0.40, apex, hue: Math.random(), typ: Math.random() < 0.4 ? 2 : 1, sound: 1 })
    wd.__play_sound = { frequency: 220, duration: 0.5, volume: 0.18, type: 'sine' }
  }

  // it launches on its own — the festival never stops
  H.launchT -= pdt
  if (H.launchT <= 0) { H.launchT = 0.6 + Math.random() * 1.4; launch((Math.random() - 0.5) * 1.6, -0.2 - Math.random() * 0.35) }
  // and wherever you click
  const mn = wd.mouse_down_n || 0
  if (mn > H.mn) { H.mn = mn; launch(mx, my) }

  // rockets rise and slow; at the apex they bloom
  for (let i = H.rockets.length - 1; i >= 0; i--) {
    const r = H.rockets[i]
    r.y -= (r.y - r.apex) * Math.min(1, pdt * 2.4) + 0.02 * pdt
    if (r.y - r.apex < 0.03) {
      if (H.bursts.length < 8) H.bursts.push({ x: r.x, y: r.y, age: 0.0001, hue: r.hue, typ: r.typ })
      wd.__play_sound = { frequency: 60 + Math.random() * 30, duration: 0.4, volume: 0.35, type: 'sine' }
      H.rockets.splice(i, 1)
    }
  }
  // bursts age out
  for (let i = H.bursts.length - 1; i >= 0; i--) {
    H.bursts[i].age += pdt
    if (H.bursts[i].age > 2.6) H.bursts.splice(i, 1)
  }

  const u = new Array(48).fill(0)
  u[0] = mx; u[1] = my
  for (let i = 0; i < 8; i++) {
    const b = H.bursts[i]
    if (b) { const o = 4 + i * 4; u[o] = b.x; u[o + 1] = b.y; u[o + 2] = b.age; u[o + 3] = b.hue }
  }
  for (let i = 0; i < 3; i++) {
    const r = H.rockets[i]
    if (r) { const o = 36 + i * 3; u[o] = r.x; u[o + 1] = r.y; u[o + 2] = 1 }
  }
  wd.gpuUniforms = u
} catch (e) { /* the night sky forgives */ }
`

const scene = {
  name: 'HANABI',
  fields: [{
    id: 'hb_f', name: 'Hanabi', color: [0.02, 0.02, 0.06, 1],
    effects: [], memory: [], proximity: [], properties: {},
    transform: { x: 256, y: 256, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
    shapeType: 'rect', w: 512, h: 512, visualTypeName: 'hanabi', noHit: true, noCollide: true,
  }],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: {
    noPixelSampling: true,
    instructions: 'HANABI (花火) — a fireworks night over a still bay.\n\nCLICK anywhere — send a shell up; it bursts where you aimed. Aim high for a slow willow, low for a quick peony.\n\nThere is no goal. The sky keeps launching on its own; every burst reflects in the water. Just watch the festival.',
    postProcess: { bloomIntensity: 0.7, bloomThreshold: 0.5, exposure: 1.05, vignetteStrength: 0.35, vignetteRadius: 0.85 },
  },
  stepHooks: [{ id: 'hb_sky', author: 'fable', description: 'HANABI: launch fireworks on click + ambient; rockets rise and bloom', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [{ name: 'hanabi', wgsl: WORLD }],
  modules: [],
  timestamp: Date.now(),
}

const here = dirname(fileURLToPath(import.meta.url))
writeFileSync(join(here, '../../../../public/cartridges/HANABI.json'), JSON.stringify(scene, null, 1))
console.log('HANABI bundled')

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'HANABI', scene }),
}).catch(() => null)
if (res) console.log('HANABI saved:', res.status)
