// AURORA — CHAPTER III of the light-bearer story. After the sun (HELIOS) and
// the drowned moon (SELENE), the polar night: here the light you carry has no
// body at all — a ribbon of sky-light that follows your cursor.
//
// CLICK & HOLD turns the ribbon's COLOR around the wheel (the way SELENE's
// moon aged its phase). Six ice-lanterns ring the night, each frozen around
// one hue. Bring the ribbon to a lantern while the colors MATCH — its rim
// wakes when you're close — and the lantern drinks the light. Light all six
// and the CORONA blooms: the whole sky becomes the crown you carried.
//
// Progress persists (the night remembers). Whiteboard:
//   uni0 mx · uni1 my (cursor, field uv) · uni2 hue · uni3 hold
//   uni4..9 lantern lit fractions · uni10 win · uni11 win bloom
//
// Save+load: node aurora-cartridge.mjs
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const WORLD = /* wgsl */`
fn au_pal(h: f32) -> vec3f {
  // the aurora's wheel: teal → green → violet → rose, never muddy
  return 0.5 + 0.5 * cos(6.2831853 * (h + vec3f(0.0, 0.33, 0.67)));
}

fn visual_aurora(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let t = time;
  let mc = vec2f(uni(0), uni(1));
  let hue = uni(2);
  let win = uni(10);
  let bloom = clamp(uni(11), 0.0, 1.0);

  // ── the polar night ──
  var col = mix(vec3f(0.004, 0.008, 0.020), vec3f(0.012, 0.020, 0.045), 0.5 - 0.5 * uv.y);
  // hard winter stars
  let sp = uv * 17.0;
  let sh = hash21(floor(sp));
  if (sh > 0.975) {
    col += vec3f(0.7, 0.75, 0.9) * smoothstep(0.18, 0.02, length(fract(sp) - 0.5)) * (0.35 + 0.45 * sin(t * 1.2 + sh * 50.0));
  }
  // the ice field below — a pale breathing band
  let ice = smoothstep(0.55, 0.75, uv.y);
  col = mix(col, vec3f(0.10, 0.13, 0.19) + vec3f(0.02) * sin(uv.x * 8.0 + t * 0.2), ice * 0.9);
  col += vec3f(0.05, 0.07, 0.10) * smoothstep(0.545, 0.56, uv.y) * smoothstep(0.60, 0.56, uv.y);

  // ── the ribbon you carry: a curtain of sky-light hanging from your cursor ──
  let rib = au_pal(hue);
  {
    // a wavy spine through the cursor; light falls upward from it
    let wave = sin(uv.x * 5.0 + t * 0.9) * 0.05 + sin(uv.x * 11.0 - t * 1.3) * 0.025;
    let spine = mc.y + (uv.x - mc.x) * 0.18 + wave;
    let d = uv.y - spine;
    let across = exp(-abs(uv.x - mc.x) * 2.6);
    // curtain: brightest at the spine, streaking upward
    let curtain = exp(-max(d, 0.0) * 9.0) * exp(-max(-d, 0.0) * 2.2);
    let streak = 0.55 + 0.45 * vnoise(vec2f(uv.x * 22.0, uv.y * 3.0 - t * 0.6));
    col += rib * curtain * across * streak * (0.55 + 0.25 * sin(t * 2.0));
    // the held knot at the cursor itself
    col += rib * exp(-dot(uv - mc, uv - mc) * 120.0) * (0.5 + 0.4 * uni(3));
  }

  // ── six ice-lanterns ringing the night ──
  let R = 0.68;
  for (var i = 0; i < 6; i++) {
    let fi = f32(i);
    let a = 6.2831853 * fi / 6.0 - 1.5707963;
    let c = vec2f(cos(a), sin(a)) * R;
    let rel = uv - c;
    if (abs(rel.x) < 0.22 && abs(rel.y) < 0.22) {
      let lit = clamp(uni(4 + i), 0.0, 1.0);
      let lc = au_pal(fi / 6.0);
      // the crystal: a rotated diamond of ice
      let q = rotate(rel, 0.7853982);
      let cd = abs(q.x) + abs(q.y);
      let body = smoothstep(0.075, 0.062, cd);
      col = mix(col, mix(vec3f(0.10, 0.13, 0.18), lc * 1.3, lit), body * (0.5 + 0.5 * lit));
      // frozen hue, faint at the heart until it drinks
      col += lc * exp(-dot(rel, rel) * 240.0) * (0.25 + lit * 1.1);
      // when your ribbon's color nears this lantern's, the rim wakes
      let dh = abs(fract(hue - fi / 6.0 + 0.5) - 0.5);
      let match = smoothstep(0.085, 0.03, dh) * (1.0 - lit);
      col += lc * exp(-pow((cd - 0.075) * 30.0, 2.0)) * match * (0.7 + 0.3 * sin(t * 5.0));
      // lit lanterns hold their color steady
      col += lc * exp(-dot(rel, rel) * 90.0) * lit * 0.35;
    }
  }

  // ── the corona: all six lit, the sky itself becomes the crown ──
  if (bloom > 0.003) {
    for (var k = 0; k < 3; k++) {
      let fk = f32(k);
      let arcY = -0.55 + fk * 0.14 + sin(uv.x * 3.0 + t * (0.5 + fk * 0.2) + fk * 2.0) * 0.06;
      let ad = abs(uv.y - arcY);
      let ac = au_pal(fract(uv.x * 0.35 + fk * 0.28 + t * 0.03));
      col += ac * exp(-ad * 26.0) * bloom * (0.30 - fk * 0.07) * (0.7 + 0.3 * vnoise(vec2f(uv.x * 14.0 + fk * 9.0, t * 0.5)));
    }
    // the door home stands in the ice, made of the same light
    let dp = uv - vec2f(0.0, 0.30);
    let door = smoothstep(0.16, 0.13, abs(dp.x)) * smoothstep(0.24, 0.21, abs(dp.y + 0.06));
    col += au_pal(fract(t * 0.05)) * door * bloom * 0.5;
    col += vec3f(0.9, 0.95, 1.0) * exp(-dot(dp, dp) * 30.0) * bloom * 0.25;
  }

  col *= 1.0 - 0.4 * pow(length(uv) * 0.72, 3.0);
  if (col.x != col.x || col.y != col.y || col.z != col.z) { col = vec3f(0.01); }
  return vec4f(clamp(col, vec3f(0.0), vec3f(30.0)), 1.0);
}`

const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__au) wd.__au = { hue: 0, lit: [0, 0, 0, 0, 0, 0], pmd: false, capd: '', won: 0 }
  const S = wd.__au
  const pdt = Math.min(dt, 0.05)

  const md = wd.mouse_down
  const mx = ((wd.mouse_x ?? 256) - 256) / 256
  const my = ((wd.mouse_y ?? 256) - 256) / 256

  // the ribbon turns its color only while HELD — release freezes the hue
  // (a slow drift keeps the sky alive: full wheel ~90s, held ~9s)
  S.hue = (S.hue + pdt / (md ? 9 : 90)) % 1

  const R = 0.68
  const cap = (text, kind) => { if (typeof window !== 'undefined' && S.capd !== text) { S.capd = text; window.dispatchEvent(new CustomEvent('cafe:caption', { detail: { text, kind } })) } }

  let all = true
  for (let i = 0; i < 6; i++) {
    // latch: a lantern past 85% is lit — no invisible purgatory
    if (S.lit[i] >= 0.85 && S.lit[i] < 1) { S.lit[i] = 1; cap('the lantern drinks the light', 'tuned') }
    const a = Math.PI * 2 * i / 6 - Math.PI / 2
    const dx = mx - Math.cos(a) * R
    const dy = my - Math.sin(a) * R
    const hover = dx * dx + dy * dy < 0.011
    const dh = Math.abs(((S.hue - i / 6 + 0.5) % 1 + 1) % 1 - 0.5)
    if (hover && S.lit[i] < 1) {
      if (dh < 0.06) {
        S.lit[i] = Math.min(1, S.lit[i] + pdt / 0.9)
      } else {
        cap('the colors must match \\u00b7 hold to turn the ribbon', 'hint')
      }
    }
    if (S.lit[i] < 1) all = false
  }

  if (all && !S.won) { S.won = 1; cap('the corona blooms \\u00b7 the whole sky is your crown', 'tuned') }
  S.wonT = S.won ? Math.min(1, (S.wonT || 0) + pdt / 3.0) : 0

  // the door in the ice: CHAPTER IV is not yet written — this one leads home
  if (S.won && typeof window !== 'undefined') {
    const nearDoor = (Math.abs(mx) < 0.16 && my > 0.06 && my < 0.54)
    if (nearDoor) cap('CHAPTER IV \\u2014 not yet written \\u00b7 step through to carry the light home', 'hint')
    if (nearDoor && md && !S.pmd) window.dispatchEvent(new CustomEvent('cafe:launch', { detail: 'HELIOS' }))
  }
  S.pmd = md

  wd.gpuUniforms = [mx, my, S.hue, md ? 1 : 0, ...S.lit, S.won, S.wonT || 0]
} catch (e) { /* the night keeps its patience */ }
`

const scene = {
  name: 'AURORA',
  fields: [{
    id: 'au_f', name: 'The Polar Night', color: [0.01, 0.015, 0.04, 1],
    effects: [], memory: [], proximity: [], properties: {},
    transform: { x: 256, y: 256, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
    shapeType: 'rect', w: 512, h: 512, visualTypeName: 'aurora', noHit: true, noCollide: true,
  }],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: {
    noPixelSampling: true,
    instructions: 'AURORA — CHAPTER III. The light you carry has no body at all.\n\nMOVE — the ribbon of sky-light follows you.\nCLICK & HOLD — turn its color around the wheel.\n\nSix ice-lanterns ring the polar night, each frozen around one hue. Bring the ribbon to a lantern while the COLORS MATCH — its rim wakes when you are close — and the lantern drinks the light. Light all six and the CORONA blooms.\n\nThe night remembers: lit lanterns stay lit.',
    postProcess: { bloomIntensity: 0.65, bloomThreshold: 0.5, exposure: 1.0, vignetteStrength: 0.35, vignetteRadius: 0.85 },
  },
  stepHooks: [{ id: 'au_night', author: 'fable', description: 'AURORA: hue-matching puzzle — carry the ribbon, match colors, light the ring, bloom the corona', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [{ name: 'aurora', wgsl: WORLD }],
  modules: [],
  timestamp: Date.now(),
}

const here = dirname(fileURLToPath(import.meta.url))
writeFileSync(join(here, '../../../../public/cartridges/AURORA.json'), JSON.stringify(scene, null, 1))
console.log('AURORA bundled')

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'AURORA', scene }),
}).catch(() => null)
if (res) console.log('AURORA saved:', res.status)
