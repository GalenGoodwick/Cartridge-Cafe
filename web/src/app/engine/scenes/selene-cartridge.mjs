// SELENE — through the moon's reflection. The world under HELIOS's lake.
// TWO ACTS, one world:
//
//   ACT I — THE DROWNED MOON. It follows your cursor; holding click ages its
//   phase. Six phase-stones ring the deep — bring the moon to a stone while
//   the crescents MATCH and the stone drinks the light. All six: the
//   MOON-TREE grows. Stepping through it does not leave the world —
//   it descends into
//
//   ACT II — AURORA (CHAPTER III). The night under the lake. The light you
//   carry has no body at all: a ribbon of sky-light. Holding click turns its
//   COLOR around the wheel. Six ice-lanterns, each frozen around one hue —
//   match the ribbon's color and the lantern drinks. All six: the CORONA
//   blooms, and the door home stands in the ice (CHAPTER IV — unwritten).
//
// Progress persists per act (the deep remembers). Whiteboard:
//   uni0 mx · uni1 my · uni2 phase-or-hue · uni3 hold
//   uni4..9 lit fractions · uni10 win · uni11 win bloom · uni12 act (0|1)
//
// Save+load: node selene-cartridge.mjs
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const WORLD = /* wgsl */`
// a moon whose bite orbits with phase — six unique crescents, one per stone
fn se_seg(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

fn se_moon(rel: vec2f, r: f32, ph: f32) -> f32 {
  let d = length(rel);
  let disc = smoothstep(r, r * 0.9, d);
  let bc = vec2f(cos(6.2831853 * ph), sin(6.2831853 * ph)) * r * 0.72;
  let bite = smoothstep(r * 0.98, r * 0.84, length(rel - bc));
  return disc * (1.0 - bite * 0.93);
}

// the aurora's wheel: teal → green → violet → rose, never muddy
fn se_pal(h: f32) -> vec3f {
  return 0.5 + 0.5 * cos(6.2831853 * (h + vec3f(0.0, 0.33, 0.67)));
}

fn visual_selene(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let t = time;
  let mc = vec2f(uni(0), uni(1));
  let ph = uni(2);
  let win = uni(10);
  let act2 = uni(12) > 0.5;

  // ════ ACT II — AURORA: the night under the lake ════
  if (act2) {
    let bloom = clamp(uni(11), 0.0, 1.0);

    // the polar night, deeper than the deep
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

    // the ribbon you carry: a curtain of sky-light hanging from your cursor
    let rib = se_pal(ph);
    {
      let wave = sin(uv.x * 5.0 + t * 0.9) * 0.05 + sin(uv.x * 11.0 - t * 1.3) * 0.025;
      let spine = mc.y + (uv.x - mc.x) * 0.18 + wave;
      let d = uv.y - spine;
      let across = exp(-abs(uv.x - mc.x) * 2.6);
      let curtain = exp(-max(d, 0.0) * 9.0) * exp(-max(-d, 0.0) * 2.2);
      let streak = 0.55 + 0.45 * vnoise(vec2f(uv.x * 22.0, uv.y * 3.0 - t * 0.6));
      col += rib * curtain * across * streak * (0.55 + 0.25 * sin(t * 2.0));
      col += rib * exp(-dot(uv - mc, uv - mc) * 120.0) * (0.5 + 0.4 * uni(3));
    }

    // six ice-lanterns ringing the night
    let R = 0.68;
    for (var i = 0; i < 6; i++) {
      let fi = f32(i);
      let a = 6.2831853 * fi / 6.0 - 1.5707963;
      let c = vec2f(cos(a), sin(a)) * R;
      let rel = uv - c;
      if (abs(rel.x) < 0.22 && abs(rel.y) < 0.22) {
        let lit = clamp(uni(4 + i), 0.0, 1.0);
        let lc = se_pal(fi / 6.0);
        // the crystal: a rotated diamond of ice
        let q = rotate(rel, 0.7853982);
        let cd = abs(q.x) + abs(q.y);
        let body = smoothstep(0.075, 0.062, cd);
        col = mix(col, mix(vec3f(0.10, 0.13, 0.18), lc * 1.3, lit), body * (0.5 + 0.5 * lit));
        col += lc * exp(-dot(rel, rel) * 240.0) * (0.25 + lit * 1.1);
        // when your ribbon's color nears this lantern's, the rim wakes
        let dh = abs(fract(ph - fi / 6.0 + 0.5) - 0.5);
        let hueWake = smoothstep(0.085, 0.03, dh) * (1.0 - lit);
        col += lc * exp(-pow((cd - 0.075) * 30.0, 2.0)) * hueWake * (0.7 + 0.3 * sin(t * 5.0));
        col += lc * exp(-dot(rel, rel) * 90.0) * lit * 0.35;
      }
    }

    // the corona: all six lit, the sky itself becomes the crown
    if (bloom > 0.003) {
      for (var k = 0; k < 3; k++) {
        let fk = f32(k);
        let arcY = -0.55 + fk * 0.14 + sin(uv.x * 3.0 + t * (0.5 + fk * 0.2) + fk * 2.0) * 0.06;
        let ad = abs(uv.y - arcY);
        let ac = se_pal(fract(uv.x * 0.35 + fk * 0.28 + t * 0.03));
        col += ac * exp(-ad * 26.0) * bloom * (0.30 - fk * 0.07) * (0.7 + 0.3 * vnoise(vec2f(uv.x * 14.0 + fk * 9.0, t * 0.5)));
      }
      // the door home stands in the ice, made of the same light
      let dp = uv - vec2f(0.0, 0.30);
      let door = smoothstep(0.16, 0.13, abs(dp.x)) * smoothstep(0.24, 0.21, abs(dp.y + 0.06));
      col += se_pal(fract(t * 0.05)) * door * bloom * 0.5;
      col += vec3f(0.9, 0.95, 1.0) * exp(-dot(dp, dp) * 30.0) * bloom * 0.25;
    }

    col *= 1.0 - 0.4 * pow(length(uv) * 0.72, 3.0);
    if (col.x != col.x || col.y != col.y || col.z != col.z) { col = vec3f(0.01); }
    return vec4f(clamp(col, vec3f(0.0), vec3f(30.0)), 1.0);
  }

  // ════ ACT I — THE DROWNED MOON ════
  let nvy = clamp(uv.y, -1.3, 1.3);

  // the drowned sky
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

  // six phase-stones ringing the deep
  let R = 0.68;
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

  // the chapter door: when the ring is lit, the MOON-TREE grows
  let wt = clamp(uni(11), 0.0, 1.0);
  if (wt > 0.005) {
    let g1 = clamp(wt * 3.0, 0.0, 1.0);
    let g2 = clamp(wt * 3.0 - 1.0, 0.0, 1.0);
    let g3 = clamp(wt * 3.0 - 2.0, 0.0, 1.0);
    let p0 = vec2f(0.0, 0.42);
    let p1 = p0 + vec2f(-0.03, -0.20) * g1;
    let p2 = p1 + vec2f(0.05, -0.19) * g2;
    let p3 = p2 + vec2f(-0.02, -0.16) * g3;
    var td = se_seg(uv, p0, p1) - 0.022 * (0.6 + 0.4 * g1);
    td = min(td, se_seg(uv, p1, p2) - 0.016);
    td = min(td, se_seg(uv, p2, p3) - 0.011);
    for (var bi = 0; bi < 5; bi++) {
      let fb = f32(bi);
      let gb = clamp(wt * 4.0 - 2.2 - fb * 0.25, 0.0, 1.0);
      if (gb > 0.01) {
        let root = mix(p2, p3, 0.2 + fb * 0.2);
        let ang = -1.5707963 + (fb - 2.0) * 0.55 + sin(t * 0.4 + fb) * 0.04;
        let tip = root + vec2f(cos(ang), sin(ang)) * (0.14 + fb * 0.014) * gb;
        td = min(td, se_seg(uv, root, tip) - 0.006);
        col += vec3f(1.15, 1.10, 0.75) * exp(-dot(uv - tip, uv - tip) * 900.0) * gb * (0.8 + 0.3 * sin(t * 2.0 + fb * 2.1));
        col += vec3f(0.55, 0.60, 0.45) * exp(-dot(uv - tip, uv - tip) * 120.0) * gb * 0.35;
      }
    }
    if (td < 0.0) { col = mix(vec3f(0.72, 0.68, 0.58), vec3f(0.35, 0.30, 0.24), clamp((uv.y - p2.y) * 2.0, 0.0, 1.0)); }
    col += vec3f(1.0, 0.85, 0.45) * exp(-dot(uv - p3, uv - p3) * 9.0) * wt * 0.30;
    col += vec3f(0.9, 0.75, 0.35) * wt * (0.035 + 0.03 * sin(t * 2.1));
  }

  // the drowned moon you carry
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
  if (!wd.__se) wd.__se = { v: 2, act: 1, unlocked: 1, ph: 0, hue: 0,
    a1: { lit: [0, 0, 0, 0, 0, 0], won: 0, wonT: 0 },
    a2: { lit: [0, 0, 0, 0, 0, 0], won: 0, wonT: 0 },
    pmd: false, capd: '' }
  const S = wd.__se
  // older saves kept one shared progress — split it into per-act stores
  if (!S.v) {
    const lit = S.lit || [0, 0, 0, 0, 0, 0]
    if (S.act === 2) {
      S.a1 = { lit: [1, 1, 1, 1, 1, 1], won: 1, wonT: 1 }
      S.a2 = { lit, won: S.won ? 1 : 0, wonT: S.wonT || 0 }
      S.unlocked = 2
    } else {
      S.act = 1
      S.a1 = { lit, won: S.won ? 1 : 0, wonT: S.wonT || 0 }
      S.a2 = { lit: [0, 0, 0, 0, 0, 0], won: 0, wonT: 0 }
      S.unlocked = 1
    }
    S.v = 2; S.hue = S.hue || 0
    delete S.lit; delete S.won; delete S.wonT
  }
  const pdt = Math.min(dt, 0.05)

  const md = wd.mouse_down
  const mx = ((wd.mouse_x ?? 256) - 256) / 256
  const my = ((wd.mouse_y ?? 256) - 256) / 256
  const click = md && !S.pmd

  const R = 0.68
  const cap = (text, kind) => { if (typeof window !== 'undefined' && S.capd !== text) { S.capd = text; window.dispatchEvent(new CustomEvent('cafe:caption', { detail: { text, kind } })) } }

  // ── act navigation: bottom corners, unlocked acts only ──
  let navved = false
  if (S.unlocked >= 2 && click && my > 0.65) {
    if (S.act === 2 && mx < -0.45) {
      S.act = 1; S.capd = ''; navved = true
      cap('ACT I \u2014 the drowned moon', 'hint')
    } else if (S.act === 1 && mx > 0.45) {
      S.act = 2; S.capd = ''; navved = true
      cap('ACT II \u2014 AURORA \u00b7 the night under the lake', 'hint')
    }
  }

  const A = S.act === 1 ? S.a1 : S.a2

  if (!navved && S.act === 1) {
    // ── ACT I: the drowned moon — phase matching ──
    S.ph = (S.ph + pdt / (md ? 9 : 90)) % 1

    let all = true
    for (let i = 0; i < 6; i++) {
      if (A.lit[i] >= 0.85 && A.lit[i] < 1) { A.lit[i] = 1; cap('the stone drinks the light', 'tuned') }
      const a = Math.PI * 2 * i / 6 - Math.PI / 2
      const dx = mx - Math.cos(a) * R
      const dy = my - Math.sin(a) * R
      const hover = dx * dx + dy * dy < 0.011
      const circ = Math.abs(((S.ph - i / 6 + 0.5) % 1 + 1) % 1 - 0.5)
      if (hover && A.lit[i] < 1) {
        if (circ < 0.06) A.lit[i] = Math.min(1, A.lit[i] + pdt / 0.9)
        else cap('the crescents must match \u00b7 hold to turn the moon', 'hint')
      }
      if (A.lit[i] < 1) all = false
    }

    if (all && !A.won) { A.won = 1; cap('the moon-tree grows \u00b7 step through it', 'tuned') }
    A.wonT = A.won ? Math.min(1, (A.wonT || 0) + pdt / 3.0) : 0

    // the moon-tree does not leave the world — it descends into CHAPTER III
    if (A.won && typeof window !== 'undefined') {
      const nearDoor = (mx * mx + my * my < 0.03) || (Math.abs(mx) < 0.12 && my > -0.15 && my < 0.45)
      if (nearDoor) cap('step through the moon-tree \u00b7 CHAPTER III \u2014 AURORA, the night under the lake', 'hint')
      if (nearDoor && click) {
        S.act = 2
        S.unlocked = 2
        S.capd = ''
        wd.__play_sound = [
          { frequency: 220, duration: 0.5, volume: 0.3, type: 'sine' },
          { frequency: 330, duration: 0.7, volume: 0.25, type: 'sine' },
        ]
        cap('CHAPTER III \u2014 AURORA \u00b7 the light you carry has no body at all', 'tuned')
      }
    }
  } else if (!navved) {
    // ── ACT II: AURORA — hue matching in the night under the lake ──
    S.hue = (S.hue + pdt / (md ? 9 : 90)) % 1

    let all = true
    for (let i = 0; i < 6; i++) {
      if (A.lit[i] >= 0.85 && A.lit[i] < 1) { A.lit[i] = 1; cap('the lantern drinks the light', 'tuned') }
      const a = Math.PI * 2 * i / 6 - Math.PI / 2
      const dx = mx - Math.cos(a) * R
      const dy = my - Math.sin(a) * R
      const hover = dx * dx + dy * dy < 0.011
      const dh = Math.abs(((S.hue - i / 6 + 0.5) % 1 + 1) % 1 - 0.5)
      if (hover && A.lit[i] < 1) {
        if (dh < 0.06) A.lit[i] = Math.min(1, A.lit[i] + pdt / 0.9)
        else cap('the colors must match \u00b7 hold to turn the ribbon', 'hint')
      }
      if (A.lit[i] < 1) all = false
    }

    if (all && !A.won) { A.won = 1; cap('the corona blooms \u00b7 the whole sky is your crown', 'tuned') }
    A.wonT = A.won ? Math.min(1, (A.wonT || 0) + pdt / 3.0) : 0

    // the door in the ice: CHAPTER IV is not yet written — this one leads home
    if (A.won && typeof window !== 'undefined') {
      const nearDoor = (Math.abs(mx) < 0.16 && my > 0.06 && my < 0.54)
      if (nearDoor) cap('CHAPTER IV \u2014 not yet written \u00b7 step through to carry the light home', 'hint')
      if (nearDoor && click) window.dispatchEvent(new CustomEvent('cafe:launch', { detail: 'HELIOS' }))
    }
  }
  S.pmd = md

  // ── the act doors on the glass: only unlocked levels are offered ──
  const hud = []
  if (S.unlocked >= 2) {
    if (S.act === 2) hud.push({ id: 'se_nav_b', type: 'text', x: '14px', bottom: '14px', text: '\u25c2 ACT I \u2014 the drowned moon', color: '#c9b370', fontSize: '12px' })
    else hud.push({ id: 'se_nav_f', type: 'text', right: '14px', bottom: '14px', text: 'ACT II \u2014 aurora \u25b8', color: '#c9b370', fontSize: '12px' })
  }
  wd.hud = hud

  const cur = S.act === 1 ? S.a1 : S.a2
  wd.gpuUniforms = [mx, my, S.act === 1 ? S.ph : S.hue, md ? 1 : 0, ...cur.lit, cur.won, cur.wonT || 0, S.act === 2 ? 1 : 0]
} catch (e) { /* the deep keeps its patience */ }
`

const scene = {
  name: 'SELENE',
  fields: [{
    id: 'se_f', name: 'The Deep', color: [0.01, 0.02, 0.05, 1],
    effects: [], memory: [], proximity: [], properties: {},
    transform: { x: 256, y: 256, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
    shapeType: 'rect', w: 512, h: 512, visualTypeName: 'selene', noHit: true, noCollide: true,
  }],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: {
    noPixelSampling: true,
    instructions: 'SELENE — the world under the lake, reached through the moon’s reflection. Two acts, one world.\n\nMOVE — carry the light.\nCLICK & HOLD — turn it (the moon’s phase in Act I; the ribbon’s color in Act II).\n\nACT I — THE DROWNED MOON: six phase-stones ring the deep. Bring your moon to a stone while the crescents MATCH — an amber rim means the phase is right — and the stone drinks the light. Light all six and the MOON-TREE grows: step through it into\n\nACT II — AURORA (CHAPTER III): the night under the lake. Six ice-lanterns, each frozen around one hue. Match the ribbon’s COLOR at each lantern. Light all six and the CORONA blooms — the door home stands in the ice. CHAPTER IV is not yet written.\n\nThe deep remembers: each act keeps its own progress. Once Act II is unlocked, the bottom corners of the glass move between acts — only unlocked acts are offered. ESC climbs back the way you came.',
    postProcess: { bloomIntensity: 0.6, bloomThreshold: 0.55, exposure: 1.0, vignetteStrength: 0.35, vignetteRadius: 0.85 },
  },
  stepHooks: [{ id: 'se_tide', author: 'fable', description: 'SELENE: two acts — phase-matching under the lake, then hue-matching in the night below it (CHAPTER III: AURORA)', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [{ name: 'selene', wgsl: WORLD }],
  modules: [],
  timestamp: Date.now(),
}

const here = dirname(fileURLToPath(import.meta.url))
writeFileSync(join(here, '../../../../public/cartridges/SELENE.json'), JSON.stringify(scene, null, 1))
console.log('SELENE bundled (two acts)')

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'SELENE', scene }),
}).catch(() => null)
if (res) console.log('SELENE saved:', res.status)
