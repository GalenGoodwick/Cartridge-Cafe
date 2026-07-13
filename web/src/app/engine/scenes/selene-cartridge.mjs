// SELENE — through the moon's reflection. The world under HELIOS's lake.
//
// You carry the DROWNED MOON (it follows your cursor). Holding click ages its
// phase — the crescent bite swings around the disc like a clock hand. Six
// phase-stones ring the deep, each carved with one fixed phase. Bring the moon
// to a stone while their crescents MATCH and the stone drinks the light.
// Light all six and the ring opens — a golden way home, back through the moon.
//
// Progress persists (the deep remembers). Whiteboard:
//   uni0 mx · uni1 my (cursor, field uv) · uni2 phase · uni3 hold
//   uni4..9 stone lit fractions · uni10 win · uni11 matched-stone hint
//
// Save+load: node selene-cartridge.mjs
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const WORLD = /* wgsl */`
// a moon whose bite orbits with phase — six unique crescents, one per stone
fn se_moon(rel: vec2f, r: f32, ph: f32) -> f32 {
  let d = length(rel);
  let disc = smoothstep(r, r * 0.9, d);
  let bc = vec2f(cos(6.2831853 * ph), sin(6.2831853 * ph)) * r * 0.72;
  let bite = smoothstep(r * 0.98, r * 0.84, length(rel - bc));
  return disc * (1.0 - bite * 0.93);
}

fn visual_selene(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let asp = max(frame.resolution.x / max(frame.resolution.y, 1.0), 1.0);
  let t = time;
  let mc = vec2f(uni(0), uni(1));
  let ph = uni(2);
  let win = uni(10);
  let nvy = clamp(uv.y * asp, -1.3, 1.3);

  // ── the drowned sky ──
  var col = mix(vec3f(0.010, 0.018, 0.038), vec3f(0.030, 0.055, 0.095), 0.5 - 0.5 * nvy);
  // caustic light from the lake's surface far above
  let ca = sin(uv.x * 9.0 + sin(nvy * 5.0 + t * 0.4) * 1.5 + t * 0.5);
  col += vec3f(0.028, 0.05, 0.07) * (0.5 + 0.5 * ca) * 0.5;
  // drowned stars, dim and wavering
  let sp = uv * 14.0 + vec2f(sin(t * 0.2 + nvy * 2.0) * 0.05, 0.0);
  let sh = hash21(floor(sp));
  if (sh > 0.972) {
    col += vec3f(0.35, 0.45, 0.65) * smoothstep(0.2, 0.03, length(fract(sp) - 0.5)) * (0.4 + 0.4 * sin(t * 1.5 + sh * 40.0));
  }
  // motes rising toward the surface
  let bp = vec2f(uv.x * 10.0, nvy * 6.0 - t * 0.35);
  let bh = hash21(floor(bp));
  if (bh > 0.955) {
    col += vec3f(0.08, 0.13, 0.17) * smoothstep(0.16, 0.02, length(fract(bp) - 0.5));
  }

  // ── six phase-stones ringing the deep ──
  let R = 0.68 / asp;
  for (var i = 0; i < 6; i++) {
    let fi = f32(i);
    let a = 6.2831853 * fi / 6.0 - 1.5707963;
    let c = vec2f(cos(a), sin(a)) * R;
    let rel = uv - c;
    if (abs(rel.x) < 0.22 && abs(rel.y) < 0.22) {
      let lit = clamp(uni(4 + i), 0.0, 1.0);
      let stone = se_moon(rel, 0.075, fi / 6.0);
      let scol = mix(vec3f(0.15, 0.17, 0.23), vec3f(1.35, 1.30, 1.05), lit);
      col = mix(col, scol, stone * (0.4 + 0.6 * lit));
      // faint carved seat under each stone
      col += vec3f(0.05, 0.06, 0.09) * exp(-dot(rel, rel) * 90.0) * (1.0 - lit);
      // when your moon's phase matches this stone, its rim wakes amber
      let dp = abs(fract(ph - fi / 6.0 + 0.5) - 0.5);
      let phMatch = smoothstep(0.085, 0.03, dp) * (1.0 - lit);
      col += vec3f(1.0, 0.72, 0.28) * exp(-pow((length(rel) - 0.085) * 26.0, 2.0)) * phMatch * (0.6 + 0.4 * sin(t * 5.0));
      // lit stones hold a silver halo
      col += vec3f(0.85, 0.85, 0.6) * exp(-dot(rel, rel) * 150.0) * lit * 0.9;
    }
  }

  // ── the way home: a golden door where the ring closes ──
  if (win > 0.01) {
    let pd = length(uv);
    let swirl = 0.5 + 0.5 * sin(atan2(uv.y, uv.x) * 3.0 + t * 1.2 - pd * 14.0);
    col += vec3f(1.25, 0.85, 0.30) * exp(-pd * pd * 42.0) * win * (0.8 + 0.6 * swirl);
    col += vec3f(1.0, 0.75, 0.30) * win * (0.055 + 0.05 * sin(t * 2.1));
  }

  // ── the drowned moon you carry ──
  let mr = uv - mc;
  let held = se_moon(mr, 0.055, ph);
  col = mix(col, vec3f(1.55, 1.55, 1.35), held);
  col += vec3f(0.45, 0.5, 0.68) * exp(-dot(mr, mr) * 55.0) * (0.45 + 0.4 * uni(3));

  col *= 1.0 - 0.4 * pow(length(vec2f(uv.x, nvy)) * 0.72, 3.0);
  if (col.x != col.x || col.y != col.y || col.z != col.z) { col = vec3f(0.01); }
  return vec4f(clamp(col, vec3f(0.0), vec3f(30.0)), 1.0);
}`

const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__se) wd.__se = { ph: 0, lit: [0, 0, 0, 0, 0, 0], pmd: false, capd: '', won: 0 }
  const S = wd.__se
  const pdt = Math.min(dt, 0.05)

  const md = wd.mouse_down
  const mx = ((wd.mouse_x ?? 256) - 256) / 256
  const my = ((wd.mouse_y ?? 256) - 256) / 256

  // the drowned moon ages only while HELD — release freezes its phase
  // (a slow ambient drift keeps it alive: full loop ~90s, held ~9s)
  S.ph = (S.ph + pdt / (md ? 9 : 90)) % 1

  const aspw = (typeof window !== 'undefined') ? Math.max(window.innerWidth / Math.max(window.innerHeight, 1), 1) : 1
  const R = 0.68 / aspw
  const cap = (text, kind) => { if (typeof window !== 'undefined' && S.capd !== text) { S.capd = text; window.dispatchEvent(new CustomEvent('cafe:caption', { detail: { text, kind } })) } }

  let all = true
  for (let i = 0; i < 6; i++) {
    const a = Math.PI * 2 * i / 6 - Math.PI / 2
    const dx = mx - Math.cos(a) * R
    const dy = my - Math.sin(a) * R
    const hover = dx * dx + dy * dy < 0.011
    let circ = Math.abs(((S.ph - i / 6 + 0.5) % 1 + 1) % 1 - 0.5)
    if (hover && S.lit[i] < 1) {
      if (circ < 0.06) {
        S.lit[i] = Math.min(1, S.lit[i] + pdt / 0.9)
        if (S.lit[i] >= 1) cap('the stone drinks the light', 'tuned')
      } else {
        cap('the crescents must match \\u00b7 hold to turn the moon', 'hint')
      }
    }
    if (S.lit[i] < 1) all = false
  }

  if (all && !S.won) { S.won = 1; cap('the ring is open \\u00b7 step through', 'tuned') }

  // the golden door home
  if (S.won && typeof window !== 'undefined') {
    const nearDoor = mx * mx + my * my < 0.03
    if (nearDoor) cap('back through the moon', 'hint')
    if (nearDoor && md && !S.pmd) window.dispatchEvent(new CustomEvent('cafe:launch', { detail: 'HELIOS' }))
  }
  S.pmd = md

  wd.gpuUniforms = [mx, my, S.ph, md ? 1 : 0, ...S.lit, S.won]
} catch (e) { /* the deep keeps its patience */ }
`

const scene = {
  name: 'SELENE',
  fields: [{
    id: 'se_f', name: 'Selene Deep', color: [0.02, 0.03, 0.06, 1],
    effects: [], memory: [], proximity: [], properties: {},
    transform: { x: 256, y: 256, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
    shapeType: 'rect', w: 512, h: 512, visualTypeName: 'selene', noHit: true, noCollide: true,
  }],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: {
    noPixelSampling: true,
    instructions: 'SELENE — the world under the lake, reached through the moon’s reflection.\\n\\nMOVE — carry the drowned moon.\\nCLICK & HOLD — age its phase: watch the bite swing around the disc.\\n\\nSix phase-stones ring the deep, each carved with one crescent. Bring your moon to a stone while the crescents MATCH — an amber rim means the phase is right — and the stone drinks the light. Light all six to open the golden way home.\\n\\nThe deep remembers: lit stones stay lit.',
    postProcess: { bloomIntensity: 0.6, bloomThreshold: 0.55, exposure: 1.0, vignetteStrength: 0.35, vignetteRadius: 0.85 },
  },
  stepHooks: [{ id: 'se_tide', author: 'fable', description: 'SELENE: phase-matching puzzle — carry the drowned moon, match crescents, light the ring', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [{ name: 'selene', wgsl: WORLD }],
  modules: [],
  timestamp: Date.now(),
}

const here = dirname(fileURLToPath(import.meta.url))
writeFileSync(join(here, '../../../../public/cartridges/SELENE.json'), JSON.stringify(scene, null, 1))
console.log('SELENE bundled')

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'SELENE', scene }),
}).catch(() => null)
if (res) console.log('SELENE saved:', res.status)
