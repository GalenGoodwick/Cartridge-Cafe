// HELIOS — the Held Sun, made real (reference world for the guide pattern).
// One orb owns every photon in the valley. DRAG carries it — and its light, rims,
// haze, reflections — across the sky. HOLD ages it: day → moonlight → day, looping.
// RELEASE freezes your sky. Stars and fireflies come with the moon.
//
//   Whiteboard: uni0 sunX · uni1 sunY · uni2 phase · uni3 holdGlow
//   moonness = 0.5 - 0.5·cos(2π·phase): 0 = day · 1 = full moon
//   Save+load: node helios-cartridge.mjs   (then reload /engine, pick HELIOS)

const HORIZON = 336

const WORLD = /* wgsl */`
const HL_HOR: f32 = ${HORIZON}.0;

fn hl_moonness(ph: f32) -> f32 { return 0.5 - 0.5 * cos(6.2831853 * ph); }

// sky + orb, callable so the lake can mirror it
fn hl_sky(p: vec2f, sun: vec2f, m: f32, t: f32, a: f32) -> vec3f {
  let up = clamp(1.0 - p.y / HL_HOR, 0.0, 1.0);
  // day palette → night palette
  let dayZen = vec3f(0.16, 0.34, 0.62);
  let dayHor = vec3f(0.95, 0.62, 0.32);
  let nightZen = vec3f(0.015, 0.020, 0.055);
  let nightHor = vec3f(0.05, 0.06, 0.13);
  var col = mix(mix(dayHor, dayZen, pow(up, 0.6)), mix(nightHor, nightZen, pow(up, 0.6)), m);

  // light breathes from wherever the orb is (screen-round despite the
  // vertical compression that fits the painting to wide viewports)
  let rel = vec2f(p.x - sun.x, (p.y - sun.y) / a);
  let d = length(rel);
  let warm = mix(vec3f(1.1, 0.7, 0.35), vec3f(0.55, 0.62, 0.80), m);
  col += warm * exp(-d * 0.012) * mix(0.5, 0.28, m);

  // the orb: gold sun ↔ silver moon with craters and a crescent bite
  let r = 26.0;
  if (d < r) {
    var oc = mix(vec3f(3.2, 2.4, 1.1), vec3f(1.6, 1.7, 1.9), m);
    // craters surface only as it becomes moon
    let cr = vnoise(rel * 0.22 + 7.0);
    oc *= 1.0 - m * 0.35 * smoothstep(0.45, 0.8, cr);
    // crescent: a dark disk slides across as moonness grows past half
    let bite = length(rel - vec2f(r * 0.85 * smoothstep(0.35, 1.0, m), -4.0));
    if (m > 0.35 && bite < r * 0.98) { oc *= 0.12; }
    col = oc;
  }
  col += warm * exp(-max(d - r, 0.0) * 0.05) * mix(0.9, 0.55, m);   // corona

  // stars belong to the moon
  if (m > 0.25) {
    let sp2 = p * 0.14;
    let cell = floor(sp2);
    let st = hash21(cell);
    if (st > 0.975 && p.y < HL_HOR - 10.0) {
      let d2 = length(fract(sp2) - 0.5);
      let tw = 0.5 + 0.5 * sin(t * 3.0 + st * 40.0);
      col += vec3f(0.9, 0.92, 1.0) * smoothstep(0.16, 0.02, d2) * tw * smoothstep(0.25, 0.6, m);
    }
  }
  return col;
}

fn hl_ridge(x: f32, seed: f32, amp: f32, base: f32) -> f32 {
  return base - amp * (fbm3(vec2f(x * 0.008 + seed, seed)) - 0.25);
}

fn visual_helios(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let asp = 1.0;   // contain-fit shows the whole painting
  let p = vec2f((uv.x + 1.0) * 256.0, (uv.y * asp + 1.0) * 256.0);
  let t = time;
  var sun = vec2f(uni(0), uni(1));
  if (sun.x < 1.0) { sun = vec2f(150.0, 120.0); }        // pre-hook default: morning
  let m = hl_moonness(uni(2));
  let gold = uni(4);

  var col: vec3f;
  let LAKE = 424.0;

  if (p.y < LAKE) {
    col = hl_sky(p, sun, m, t, asp);

    // three ridgelines, lit from wherever the orb hangs
    let warm = mix(vec3f(1.0, 0.75, 0.45), vec3f(0.5, 0.58, 0.75), m);
    let sunSide = clamp(1.0 - abs(p.x - sun.x) / 360.0, 0.0, 1.0);
    let r1 = hl_ridge(p.x, 3.0, 90.0, HL_HOR - 40.0);
    let r2 = hl_ridge(p.x, 11.0, 60.0, HL_HOR - 6.0);
    let r3 = hl_ridge(p.x, 27.0, 34.0, HL_HOR + 26.0);
    if (p.y > r3 && p.y < LAKE) {
      col = mix(vec3f(0.10, 0.16, 0.08), vec3f(0.012, 0.02, 0.03), m);
      col += warm * 0.35 * sunSide * smoothstep(r3 + 14.0, r3, p.y);  // lit brow
      col *= 0.9 + 0.2 * vnoise(p * 0.12);
    } else if (p.y > r2) {
      col = mix(vec3f(0.13, 0.20, 0.11), vec3f(0.02, 0.03, 0.05), m);
      col += warm * 0.30 * sunSide * smoothstep(r2 + 12.0, r2, p.y);
      col *= 0.9 + 0.2 * vnoise(p * 0.1 + 5.0);
    } else if (p.y > r1) {
      col = mix(vec3f(0.17, 0.25, 0.15), vec3f(0.03, 0.045, 0.07), m);
      col += warm * 0.28 * sunSide * smoothstep(r1 + 10.0, r1, p.y);
      col *= 0.9 + 0.2 * vnoise(p * 0.08 + 9.0);
    }

    // fireflies rise at night over the near meadow
    if (m > 0.5 && p.y > HL_HOR) {
      let fp2 = p * 0.06 + vec2f(0.0, t * 0.06);
      let fc = floor(fp2);
      let fh = hash21(fc + 31.0);
      if (fh > 0.955) {
        let fd = length(fract(fp2) - 0.5);
        let blink = pow(0.5 + 0.5 * sin(t * 2.5 + fh * 60.0), 3.0);
        col += vec3f(0.9, 1.4, 0.3) * smoothstep(0.10, 0.02, fd) * blink * (m - 0.5) * 2.4;
      }
    }
  } else {
    // the lake: the whole sky again, upside down and breathing
    let ry = LAKE - (p.y - LAKE) * 1.9;
    let wob = vnoise(vec2f(p.x * 0.05, p.y * 0.3 - t * 0.8)) - 0.5;
    var rp = vec2f(p.x + wob * 9.0, ry + wob * 5.0);
    col = hl_sky(rp, sun, m, t, asp) * mix(0.62, 0.5, m);
    col += vec3f(0.04, 0.05, 0.06) * (0.5 + wob);

    // moon-glitter: when the moon is out and its face lies on the lake,
    // the water sparkles along the reflection path
    let refY = LAKE + (LAKE - sun.y) / 1.9;
    let mglow = smoothstep(0.35, 0.75, m) * smoothstep(620.0, 500.0, refY);
    if (mglow > 0.01) {
      let depth = clamp((p.y - LAKE) / (512.0 - LAKE), 0.0, 1.0);
      let spread = 16.0 + 100.0 * depth;                 // the glade widens toward you
      let path = smoothstep(spread, spread * 0.2, abs(p.x - sun.x + wob * 14.0));
      // glint cells — little horizontal flecks, twinkling out of phase
      let gp = vec2f(p.x * 0.12, p.y * 0.3 - t * 0.55);
      let gh = hash21(floor(gp));
      let gd = length((fract(gp) - 0.5) * vec2f(0.9, 2.2));
      let flash = pow(0.5 + 0.5 * sin(t * (2.0 + gh * 6.0) + gh * 47.0), 6.0);
      let glint = smoothstep(0.45, 0.05, gd) * step(0.80, gh) * flash;
      col += vec3f(1.05, 1.12, 1.30) * glint * path * mglow * 2.8;   // the sparkle
      col += vec3f(0.35, 0.40, 0.55) * path * mglow * 0.20 * (0.6 + wob);  // silver sheen
      col += vec3f(1.30, 0.95, 0.40) * path * gold * 0.55 * (0.7 + wob);   // the invitation
    }
  }

  // hold feedback: a slow pulse ring while the orb is aging
  if (uni(3) > 0.01) {
    let ring = abs(length(vec2f(p.x - sun.x, (p.y - sun.y) / asp)) - (30.0 + fract(t * 0.8) * 26.0));
    col += vec3f(0.8, 0.8, 0.7) * uni(3) * smoothstep(3.0, 0.0, ring) * 0.5;
  }

  // the moon's reflection noticed you: the whole valley breathes gold
  if (gold > 0.01) {
    let breath = 0.5 + 0.5 * sin(t * 3.2);
    col += vec3f(1.05, 0.78, 0.28) * gold * (0.10 + 0.11 * breath) * (1.25 - 0.5 * length(uv));
  }

  col *= 1.0 - 0.35 * pow(length(uv), 3.0);
  return vec4f(col, 1.0);
}`

// ─────────────────────────────────────────────────────────────────────────────
const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__hel || wd.__hel.v !== 2) wd.__hel = { v: 2, sx: 150, sy: 120, phase: 0, lx: -1, ly: -1, glow: 0 }
  const S = wd.__hel
  const pdt = Math.min(dt, 0.05)
  const HORIZON = ${HORIZON}

  const md = wd.mouse_down, mx = wd.mouse_x, my = wd.mouse_y
  const aspw = 1
  // HOVER carries the sun — no press needed; the light lives at your cursor
  if (typeof mx === 'number' && (mx !== S.lx || my !== S.ly)) {
    S.lx = mx; S.ly = my
    S.sx = Math.max(20, Math.min(492, mx))
    S.sy = Math.max(28, Math.min(HORIZON - 24, (my - 256) * aspw + 256))
  }
  // aging is ambient (full cycle ~70s); CLICKING makes time race (~7s)
  S.phase = (S.phase + pdt / (md ? 7 : 70)) % 1
  S.glow = md ? 1 : Math.max(0, S.glow - 1.5 * pdt)

  const moonness = 0.5 - 0.5 * Math.cos(2 * Math.PI * S.phase)

  // the secret: hover the moon's actual reflection on the lake
  const pyRaw = (typeof my === 'number') ? (my - 256) * aspw + 256 : -999
  const refY = 424 + (424 - S.sy) / 1.9
  const hov = moonness > 0.5 && refY < 512 && pyRaw > refY - 22 && pyRaw < refY + 26 ? 1 : 0
  S.gold = (S.gold || 0) + (hov - (S.gold || 0)) * Math.min(1, pdt * 5)
  if (typeof window !== 'undefined') {
    if (hov && !S.capd) { S.capd = true; window.dispatchEvent(new CustomEvent('cafe:caption', { detail: { text: 'the moon invites you \u00b7 click', kind: 'hint' } })) }
    if (!hov) S.capd = false
    if (hov && md && !S.pmd) window.dispatchEvent(new CustomEvent('cafe:launch', { detail: 'SELENE' }))
  }
  S.pmd = md

  wd.gpuUniforms = [S.sx, S.sy, S.phase, S.glow, S.gold]
  wd.hud = [
    { id: 'hl_t', type: 'text', x: '14px', y: '12px', text: 'HELIOS \\u2014 ' + (moonness > 0.6 ? 'moonlight' : (moonness > 0.25 ? 'dusk' : 'daylight')), color: '#c9b370', fontSize: '13px' },
  ]

  const bg = sim.fields.get('hl_f')
  if (bg) { bg.transform.x = 256; bg.transform.y = 256; bg.transform.vx = 0; bg.transform.vy = 0 }
} catch (e) { /* keep the sim alive */ }
`

const scene = {
  name: 'HELIOS',
  fields: [{
    id: 'hl_f', name: 'Helios Valley', color: [0.1, 0.15, 0.2, 1],
    effects: [], memory: [], proximity: [], properties: { hx: 256, hy: 256 },
    transform: { x: 256, y: 256, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
    shapeType: 'rect', w: 512, h: 512, visualTypeName: 'helios', noHit: true, noCollide: true,
  }],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: {
    noPixelSampling: true,
    rResetKey: true,   // Galen: R must reset HELIOS (the stubborn-tree escape hatch)
    instructions: 'MOVE — the sun follows your cursor; all of its light comes with it.\nTime passes on its own — the sun slowly ages to moonlight and back.\nCLICK & HOLD — time races.\n\nThe point: there is no goal. The valley is yours to light — stars and fireflies come with the moon.',
    postProcess: { bloomIntensity: 0.5, bloomThreshold: 0.6, exposure: 1.0, vignetteStrength: 0.3, vignetteRadius: 0.8 },
  },
  stepHooks: [{ id: 'hl_sun', author: 'fable', description: 'HELIOS: the Held Sun — drag carries it, holding ages it day\\u2194moon, release freezes the sky.', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [{ name: 'helios', wgsl: WORLD }],
  modules: [],
  timestamp: Date.now(),
}

import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const here = dirname(fileURLToPath(import.meta.url))
writeFileSync(join(here, '../../../../public/cartridges/HELIOS.json'), JSON.stringify(scene, null, 1))
console.log('HELIOS bundled')

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'HELIOS', scene }),
})
console.log('HELIOS saved:', res.status, await res.text())
