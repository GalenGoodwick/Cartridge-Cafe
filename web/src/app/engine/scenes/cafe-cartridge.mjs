// CAFE — the front door is a world. Seven cartridges float in the dark, each a
// living miniature of its game. Your cursor is a lens; hover blooms a portal;
// click steps through it. No webpage. Save+load: node cafe-cartridge.mjs

// ── the shelf ranks itself: most recently updated worlds sit closest to center ──
const _list = await fetch('http://localhost:3000/api/engine/scene?action=list').then(r => r.json())
const _stamped = []
for (const n of _list.scenes.filter(n => n !== 'CAFE' && !n.includes('⑂'))) {
  const { scene } = await fetch('http://localhost:3000/api/engine/scene?name=' + encodeURIComponent(n)).then(r => r.json())
  _stamped.push({ n, ts: (scene && scene.timestamp) || 0 })
}
_stamped.sort((a, b) => b.ts - a.ts)
const NAMES = _stamped.map(x => x.n)
const N = NAMES.length
const STYLE_OF = { 'FABRIC': 0, 'ORRERY': 1, 'GARNET': 2, 'ONE DAY': 3, 'SAIL': 4, 'SOLSTICE': 5, 'TIDERUNNER': 6, 'SIGNAL': 7 }
const _hue = n => { let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) % 997; return (h % 100) / 100 }
const POS = NAMES.map((n, i) => {
  const r = 0.155 * Math.sqrt(i + 0.35)
  const a = i * 2.39996 + 0.65
  return [+(r * Math.cos(a)).toFixed(3), +(r * Math.sin(a) * 0.74 - 0.02).toFixed(3)]
})
const POS_WGSL = POS.map(([x, y], i) => `  if (i == ${i}) { return vec2f(${x}, ${y}); }`).join('\n')
const STYLE_WGSL = NAMES.map((n, i) => `  if (i == ${i}) { return ${STYLE_OF[n] ?? 8}; }`).join('\n')
const HUE_WGSL = NAMES.map((n, i) => `  if (i == ${i}) { return ${_hue(n).toFixed(3)}; }`).join('\n')

const WORLD = /* wgsl */`
fn cf_portal_pos(i: i32) -> vec2f {
${POS_WGSL}
  return vec2f(0.0, 0.0);
}
fn cf_style(i: i32) -> i32 {
${STYLE_WGSL}
  return 8;
}
fn cf_hue(i: i32) -> f32 {
${HUE_WGSL}
  return 0.5;
}

fn cf_stars(p: vec2f, t: f32) -> vec3f {
  var c = vec3f(0.008, 0.007, 0.016);
  c += vec3f(0.05, 0.025, 0.09) * smoothstep(0.4, 0.9, fbm(p * 1.5 + vec2f(t * 0.004, 0.0), 4));
  for (var l = 0; l < 2; l++) {
    let fl = f32(l);
    let sp = p * (16.0 + fl * 26.0) + fl * 31.0;
    let cell = floor(sp);
    let h = hash21(cell);
    let fp = fract(sp) - 0.5;
    let tw = 0.5 + 0.5 * sin(t * (0.5 + h * 1.4) + h * 40.0);
    c += vec3f(0.8, 0.75, 0.95) * step(0.985, h) * smoothstep(0.24, 0.03, length(fp)) * tw * (1.1 - fl * 0.4);
  }
  return c;
}

fn visual_cf_world(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let t = time;
  let mp = vec2f(uni(0), uni(1));     // cursor in field coords

  // ── the room: stars seen through curved space (your cursor is a lens) ──
  var p = uv;
  let md = uv - mp;
  let mr2 = max(dot(md, md), 0.002);
  p -= md * (0.010 / mr2) * smoothstep(0.9, 0.2, length(md));
  var col = cf_stars(p, t);

  // warm hearth-light from below — this is a cafe, not a void
  col += vec3f(0.10, 0.055, 0.02) * pow(max(0.0, uv.y + 0.2), 2.0) * (0.8 + 0.2 * sin(t * 0.7));

  // ── every cartridge on the shelf, newest nearest the center ──
  for (var i = 0; i < ${N}; i++) {
    let ctr = cf_portal_pos(i);
    let d = length(uv - ctr);
    let R = 0.088;
    let hov = uni(2 + i);                          // 0..1 hover bloom from the hook
    let rr = R * (1.0 + hov * 0.12);
    if (d < rr) {
      let q = (uv - ctr) / rr;                     // -1..1 inside the disc
      var g = vec3f(0.0);
      let st = cf_style(i);
      if (st == 0) {
        // FABRIC — a lens wandering through stars
        var pp = q * 2.0;
        let lc = vec2f(sin(t * 0.6) * 0.5, cos(t * 0.47) * 0.4);
        let ld = pp - lc;
        pp -= ld * (0.16 / max(dot(ld, ld), 0.02));
        g = cf_stars(pp * 1.6, t) * 2.2;
        g += vec3f(0.5, 0.9, 1.1) * exp(-dot(ld, ld) * 14.0) * 0.4;
      } else if (st == 1) {
        // ORRERY — three worlds around a coal
        g = vec3f(0.02, 0.015, 0.03);
        g += vec3f(3.0, 1.7, 0.5) * exp(-dot(q, q) * 30.0);
        for (var k = 1; k <= 3; k++) {
          let fk = f32(k);
          let a = t * (0.9 - fk * 0.18) + fk * 2.1;
          let pp = q - vec2f(cos(a), sin(a)) * (0.22 + fk * 0.17);
          var pc = vec3f(0.45, 0.5, 0.65);
          if (k == 2) { pc = vec3f(0.2, 0.45, 0.8); }
          if (k == 3) { pc = vec3f(0.8, 0.5, 0.25); }
          g += pc * exp(-dot(pp, pp) * 260.0) * 1.6;
        }
      } else if (st == 2) {
        // GARNET — the crystal
        let qa = rotate(q, t * 0.4);
        let cd = abs(qa.x) * 0.866 + abs(qa.y) * 0.5;
        let inside = smoothstep(0.62, 0.58, max(cd, abs(qa.y)));
        let facet = 0.6 + 0.4 * sin(qa.x * 9.0 + qa.y * 7.0 + t * 0.8);
        g = mix(vec3f(0.02, 0.01, 0.02), vec3f(0.75, 0.18, 0.25) * facet, inside);
        g += vec3f(1.6, 0.9, 0.7) * pow(max(0.0, facet - 0.75) * 4.0, 2.0) * inside;
      } else if (st == 3) {
        // ONE DAY — a sky that keeps its whole day
        let ph = fract(t * 0.05);
        let el = sin(ph * 6.28318) * 0.8;
        let day = smoothstep(-0.2, 0.4, el);
        g = mix(vec3f(0.02, 0.02, 0.06), vec3f(0.25, 0.5, 0.8), day * (0.5 - q.y * 0.5));
        g = mix(g, vec3f(0.9, 0.4, 0.15), smoothstep(0.3, 0.0, abs(el)) * max(0.0, -q.y + 0.2) * 0.9);
        let sun = vec2f(cos(ph * 6.28318 - 1.57) * 0.6, -el * 0.55 + 0.1);
        g += vec3f(3.0, 2.0, 0.9) * exp(-dot(q - sun, q - sun) * 60.0) * max(day, 0.15);
        if (q.y > 0.25) { g = mix(g, g * vec3f(0.5, 0.6, 0.8), 0.6); }   // the sea below
      } else if (st == 4) {
        // SAIL — one boat, one sea
        g = mix(vec3f(0.35, 0.5, 0.65), vec3f(0.05, 0.14, 0.2), smoothstep(-0.1, 0.5, q.y));
        let w = sin(q.x * 9.0 + t * 1.4) * 0.05;
        g = mix(g, vec3f(0.03, 0.10, 0.14), smoothstep(w + 0.02, w - 0.02, -q.y + 0.1) * 0.0 + smoothstep(w - 0.02, w + 0.06, q.y - 0.05));
        let sail = max(max(-(q.x + 0.05) * 3.0, q.y + 0.15), (q.x * 0.9 + q.y * 0.8) - 0.28);
        g = mix(g, vec3f(1.0, 0.96, 0.88), smoothstep(0.02, -0.02, sail));
      } else if (st == 5) {
        // SOLSTICE — a sun you carry over a valley
        g = vec3f(0.03, 0.04, 0.09);
        let sp = vec2f(sin(t * 0.5) * 0.45, -0.3 + cos(t * 0.5) * 0.12);
        g += vec3f(3.2, 2.2, 0.9) * exp(-dot(q - sp, q - sp) * 40.0);
        let hill = q.y - (0.25 + 0.15 * sin(q.x * 3.0 + 1.0));
        let lit = max(0.0, 1.0 - length(q - sp) * 1.4);
        g = mix(g, mix(vec3f(0.03, 0.05, 0.02), vec3f(0.15, 0.3, 0.08), lit), smoothstep(-0.02, 0.02, hill));
      } else if (st == 6) {
        // TIDERUNNER — wind over water
        let band = sin(q.y * 14.0 - t * 1.1 + sin(q.x * 4.0) * 0.7);
        g = mix(vec3f(0.05, 0.13, 0.17), vec3f(0.12, 0.25, 0.3), 0.5 + 0.5 * band);
        g += vec3f(0.8, 0.85, 0.85) * pow(max(0.0, band - 0.8) * 5.0, 2.0) * 0.4;
        let bt = q - vec2f(sin(t * 0.4) * 0.4, 0.0);
        g += vec3f(0.9, 0.85, 0.75) * exp(-dot(bt, bt) * 300.0) * 1.2;
      } else if (st == 7) {
        // SIGNAL — a television waiting for a word
        let sn = hash21(floor(q * 24.0) + floor(t * 9.0));
        g = vec3f(sn * 0.5);
        g += vec3f(0.3, 1.0, 0.45) * exp(-dot(q, q) * 8.0) * (0.28 + 0.14 * sin(t * 2.0));
        g *= 0.82 + 0.18 * sin(q.y * 60.0 - t * 8.0);
      } else {
        // a young world — a banded seed-planet in its own hue
        let hue = cf_hue(i);
        let cA = 0.5 + 0.5 * cos(6.2831 * (hue + vec3f(0.0, 0.33, 0.67)));
        g = cA * (0.22 + 0.5 * fbm3(q * 3.0 + vec2f(t * 0.08, f32(i) * 3.7)));
        g += cA * 0.4 * smoothstep(0.6, 1.0, 1.0 - abs(q.y * 2.2 + 0.3 * sin(q.x * 3.0 + t * 0.4)));
        let mn = q - vec2f(cos(t * 0.5 + f32(i) * 1.9), sin(t * 0.5 + f32(i) * 1.9) * 0.6) * 0.78;
        g += vec3f(0.85) * exp(-dot(mn, mn) * 260.0);
        g *= 0.85 + 0.3 * (1.0 - length(q));
      }
      // glass edge + hover bloom
      let edge = smoothstep(1.0, 0.86, length(q));
      col = mix(col, g, edge);
      col += vec3f(1.2, 0.85, 0.4) * exp(-pow((length(q) - 0.97) * 9.0, 2.0)) * (0.25 + hov * 1.3);
    } else {
      // halo when hovered
      col += vec3f(1.0, 0.7, 0.3) * exp(-pow((d - rr) * 22.0, 2.0)) * hov * 0.8;
    }
  }

  // the cursor itself — a soft ember
  col += vec3f(1.4, 0.9, 0.4) * exp(-dot(uv - mp, uv - mp) * 900.0) * 0.8;

  if (col.x != col.x || col.y != col.y || col.z != col.z) { col = vec3f(0.01); }
  return vec4f(clamp(col, vec3f(0.0), vec3f(60.0)), 1.0);
}`

const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__cf || !wd.__cf.hov || wd.__cf.hov.length !== ${N}) wd.__cf = { hov: Array(${N}).fill(0), prevDown: false, mx: 0, my: 0 }
  const C = wd.__cf
  const dt2 = Math.min(dt, 0.05)

  const hasMouse = wd.mouse_x !== undefined
  const tx = ((wd.mouse_x ?? 256) - 256) / 256
  const ty = ((wd.mouse_y ?? 256) - 256) / 256
  C.mx += (tx - C.mx) * Math.min(1, dt2 * 12)
  C.my += (ty - C.my) * Math.min(1, dt2 * 12)

  const GAMES = ${JSON.stringify(NAMES)}
  const POSA = ${JSON.stringify(POS)}
  const pos = i => POSA[i]

  let hovered = -1
  for (let i = 0; i < ${N}; i++) {
    const [px, py] = pos(i)
    const d = Math.hypot(tx - px, ty - py)
    const want = hasMouse && d < 0.10 ? 1 : 0
    if (want) hovered = i
    C.hov[i] += (want - C.hov[i]) * Math.min(1, dt2 * 8)
  }

  if (hovered !== (C.lastHover ?? -1) && typeof window !== 'undefined') {
    C.lastHover = hovered
    window.dispatchEvent(new CustomEvent('cafe:hover', { detail: hovered >= 0 ? GAMES[hovered] : null }))
  }

  const down = !!wd.mouse_down
  if (down && !C.prevDown && hovered >= 0 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cafe:launch', { detail: GAMES[hovered] }))
  }
  C.prevDown = down

  wd.gpuUniforms = [C.mx, C.my, ...C.hov]
} catch (e) { /* keep the door open */ }
`

const scene = {
  name: 'CAFE',
  fields: [
    {
      id: 'cf_world_f', name: 'CAFE',
      color: [0.01, 0.01, 0.03, 1],
      effects: [], memory: [], proximity: [], properties: {},
      transform: { x: 256, y: 256, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
      shapeType: 'rect', w: 512, h: 512,
      visualTypeName: 'cf_world',
    },
  ],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: { noPixelSampling: true },
  stepHooks: [{ id: 'cafe_door', author: 'fable', description: 'CAFE: hover-bloom portals, click to step through', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [{ name: 'cf_world', wgsl: WORLD }],
  modules: [],
  timestamp: Date.now(),
}

import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const here = dirname(fileURLToPath(import.meta.url))
writeFileSync(join(here, '../../../../public/cartridges/CAFE.json'), JSON.stringify(scene, null, 1))
console.log('CAFE bundled to public/cartridges/CAFE.json')

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'CAFE', scene }),
})
console.log('CAFE saved:', res.status, await res.text())
