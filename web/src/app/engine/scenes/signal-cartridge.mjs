// SIGNAL — a television tuned by language.
//
// Three layers, all alive at once:
//   1. SUBSTRATE — every screen pixel runs Gray-Scott reaction-diffusion on the
//      previous frame (prevAt). The picture is not drawn; it GROWS. Coral,
//      mitosis, worms, waves — real regimes of a real chemical computer.
//   2. CONTROLLERS — a sparse lattice of thermostat pixels (one per 64px cell)
//      that measure their territory's activity and write a feed-rate bias back
//      into the frame. Substrate pixels read their controller and obey.
//      Shaders controlling shaders, through the shared past. No CPU in the loop.
//   3. LANGUAGE — type a word, press enter. Words map to coordinates in the
//      reaction's parameter space and to a palette. "coral" grows coral.
//      "storm" boils. "death" kills — and the thermostats hunt forever, amber.
//
// The bottom bezel is a row of LEDs, one per controller column: amber while
// hunting, green when its patch of reality holds steady. Co-calibration is
// the win condition, and you can watch it happen.
//
// Save+load: node signal-cartridge.mjs
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const WORLD = /* wgsl */`
// state encoding: r = (1-u)*A*0.35, g = v*B, b = art (display only, never decoded)
// A,B are palette amplitudes (>= 0.35 so state stays decodable)
fn sg_dec(c: vec4f, A: f32, B: f32) -> vec2f {
  return vec2f(clamp(c.x, 0.0, 1.0) / (0.35 * max(A, 0.35)), clamp(c.y, 0.0, 1.0) / max(B, 0.35));
}
// one thermostat's published feed bias, read from the frame
fn sg_bias(n: vec2f, p: vec2f) -> f32 {
  let c = prevAt(n * 64.0 + vec2f(32.0, 32.0) - p);
  return (clamp(c.y, 0.0, 1.0) / 0.12 - 0.5) / 20.0;
}
fn sg_isCtrl(p: vec2i) -> bool {
  let m = p % vec2i(64, 64);
  return m.x == 32 && m.y == 32;
}
// neighbor state; controller pixels are not chemistry — substitute self
fn sg_nb(o: vec2f, cSelf: vec2f, A: f32, B: f32) -> vec2f {
  let np = vec2i(pix() + o);
  if (sg_isCtrl(np)) { return cSelf; }
  return sg_dec(prevAt(o), A, B);
}

fn visual_sg_world(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let A = clamp(uni(5), 0.35, 1.0);
  let B = clamp(uni(6), 0.35, 1.0);
  let Cc = clamp(uni(7), 0.0, 1.2);
  let booted = uni(9) > 0.5;
  let p = pix();

  // ── CONTROLLER pixels: measure, integrate, publish. 1px each, one per 64px cell ──
  if (sg_isCtrl(vec2i(p))) {
    if (!booted) { return vec4f(0.10 * 0.25, 0.5 * 0.12, 0.0, 1.0); }
    var OFS = array<vec2f, 8>(
      vec2f(0.0, 16.0), vec2f(0.0, -16.0), vec2f(16.0, 0.0), vec2f(-16.0, 0.0),
      vec2f(20.0, 20.0), vec2f(-20.0, 20.0), vec2f(20.0, -20.0), vec2f(-20.0, -20.0));
    var act = 0.0;
    for (var j = 0; j < 8; j++) { act += sg_dec(prevAt(OFS[j]), A, B).y; }
    act /= 8.0;
    let s = prevHere();
    let prevAct = clamp(s.x, 0.0, 1.0) / 0.25;
    let prevBias = (clamp(s.y, 0.0, 1.0) / 0.12 - 0.5) / 20.0;
    let prevLock = clamp(s.z, 0.0, 1.0) / 0.2;
    let sm = mix(prevAct, act, 0.04);
    let TARGET = 0.10;
    let bias = clamp(prevBias + (TARGET - sm) * 0.00045, -0.024, 0.024);
    let err = abs(TARGET - sm) / TARGET;
    let lock = mix(prevLock, clamp(1.0 - err, 0.0, 1.0), 0.006);
    return vec4f(sm * 0.25, (0.5 + bias * 20.0) * 0.12, lock * 0.2, 1.0);
  }

  let ax = max(abs(uv.x), abs(uv.y));

  // ── BEZEL: the set itself. Inner dead frame is the reaction's boundary ──
  if (ax > 0.94) {
    if (ax < 0.955) { return vec4f(0.0, 0.0, 0.0, 1.0); }
    var c = vec3f(0.055, 0.038, 0.028) * (0.85 + 0.3 * hash21(floor(p / 3.0)));
    // LED rail: one thermostat's verdict per column — amber hunts, green holds
    if (uv.y < -0.955) {
      let cl = floor((p - vec2f(0.0, 130.0)) / 64.0) * 64.0 + vec2f(32.0, 32.0);
      let cc = prevAt(cl - p);
      let lock = clamp(cc.z, 0.0, 1.0) / 0.2;
      let act = clamp(cc.x, 0.0, 1.0) / 0.25;
      let lx = p.x - cl.x;
      let led = exp(-lx * lx / 40.0);
      let hunting = 0.6 + 0.4 * sin(time * 6.0 + cl.x * 0.13);
      let lcol = mix(vec3f(1.0, 0.55, 0.15) * hunting, vec3f(0.25, 1.0, 0.4), clamp(lock * 1.15, 0.0, 1.0));
      c += lcol * led * (0.5 + 0.5 * clamp(act * 3.0, 0.0, 1.0)) * 2.2;
    }
    c += vec3f(0.4, 0.9, 0.5) * uni(8) * 0.12;   // retune flash
    if (c.x != c.x || c.y != c.y || c.z != c.z) { c = vec3f(0.02); }
    return vec4f(clamp(c, vec3f(0.0), vec3f(8.0)), 1.0);
  }

  // ── SUBSTRATE: Gray-Scott on the previous frame ──
  if (!booted) {
    // first light: sparse seeds in an empty universe
    let h = hash21(floor(p / 9.0));
    let v0 = select(0.0, 0.85, h > 0.978);
    return vec4f(0.0, v0 * B, 0.0, 1.0);
  }
  let cs = sg_dec(prevHere(), A, B);
  var la = 0.0;
  var lv = 0.0;
  var NO = array<vec2f, 4>(vec2f(2.0, 0.0), vec2f(-2.0, 0.0), vec2f(0.0, 2.0), vec2f(0.0, -2.0));
  var ND = array<vec2f, 4>(vec2f(2.0, 2.0), vec2f(2.0, -2.0), vec2f(-2.0, 2.0), vec2f(-2.0, -2.0));
  for (var j = 0; j < 4; j++) {
    let n1 = sg_nb(NO[j], cs, A, B);
    la += 0.2 * (n1.x - cs.x); lv += 0.2 * (n1.y - cs.y);
    let n2 = sg_nb(ND[j], cs, A, B);
    la += 0.05 * (n2.x - cs.x); lv += 0.05 * (n2.y - cs.y);
  }
  // the control layer, read through the frame — blended between the four
  // nearest thermostats so control varies smoothly across the picture
  let pc = (p - vec2f(32.0, 32.0)) / 64.0;
  let b0 = floor(pc);
  let bf = pc - b0;
  let bias = mix(
    mix(sg_bias(b0, p), sg_bias(b0 + vec2f(1.0, 0.0), p), bf.x),
    mix(sg_bias(b0 + vec2f(0.0, 1.0), p), sg_bias(b0 + vec2f(1.0, 1.0), p), bf.x), bf.y);

  let F = clamp(uni(3) + bias, 0.004, 0.095);
  let k = clamp(uni(4), 0.03, 0.08);
  let u = 1.0 - cs.x;
  let v = cs.y;
  let uvv = u * v * v;
  var un = clamp(u + (1.0 * (-la) - uvv + F * (1.0 - u)), 0.0, 1.0);
  var vn = clamp(v + (0.5 * lv + uvv - (F + k) * v), 0.0, 1.0);

  // touch pours reagent — you can seed reality by hand
  if (uni(2) > 0.5) {
    let dm = uv - vec2f(uni(0), uni(1));
    vn = max(vn, 0.9 * exp(-dot(dm, dm) * 2200.0));
  }

  // art channel: glow from concentration + the retune ripple
  let pl = uni(8);
  var art = pow(vn, 1.5) * 3.0 * Cc;
  if (pl > 0.001) {
    let dc = abs(length(uv) - (1.0 - pl) * 1.6);
    art += pl * 1.2 * exp(-dc * dc * 160.0);
  }
  var outc = vec3f((1.0 - un) * A * 0.35, vn * B, art);
  if (outc.x != outc.x || outc.y != outc.y || outc.z != outc.z) { outc = vec3f(0.0); }
  return vec4f(clamp(outc, vec3f(0.0), vec3f(4.0)), 1.0);
}`

const HOOK = `
try {
  const wd = sim.worldData
  if (!wd.__sg || !wd.__sg.keys) {
    wd.__sg = { age: 0, word: '', committed: '', hinted: false, pulse: 0, keys: {},
      F: .0545, k: .062, A: 1, B: .62, C: .55,
      tF: .0545, tk: .062, tA: 1, tB: .62, tC: .55 }
  }
  const G = wd.__sg
  if (wd.__fresh) {
    // new session: reseed the tube, keep the saved tuning (F/k/palette survive)
    delete wd.__fresh
    G.age = 0; G.word = ''; G.pulse = 0; G.keys = {}; G.hinted = false
  }
  const dt2 = Math.min(dt, 0.05)
  G.age += dt2

  // words → coordinates in the reaction's parameter space + a palette.
  // Regimes are real Gray-Scott territories: these words GROW what they name.
  const REG = { mit: [.0367, .0649], coral: [.0545, .062], worms: [.046, .063],
    maze: [.029, .057], soli: [.03, .062], holes: [.039, .058],
    chaos: [.026, .051], waves: [.014, .045], dead: [.005, .075] }
  const PAL = { cyan: [.35, 1, 1.1], coral: [1, .5, .55], amber: [1, .62, .2],
    blue: [.35, .5, 1.2], red: [1, .35, .1], violet: [.8, .38, 1.15],
    green: [.35, 1, .3], gold: [1, .8, .25], ice: [.6, .85, 1.15],
    indigo: [.5, .38, 1.2], grey: [.5, .5, .55], rose: [1, .45, .8], white: [.9, .95, .95] }
  const LEX = {
    life: 'mit/green', cells: 'mit/cyan', cell: 'mit/cyan', mitosis: 'mit/cyan',
    divide: 'mit/cyan', birth: 'mit/rose', seed: 'mit/green', cradle: 'mit/cyan',
    love: 'mit/rose', blood: 'mit/red', heart: 'mit/rose', pulse: 'mit/red',
    coral: 'coral/coral', reef: 'coral/coral', garden: 'coral/green', moss: 'coral/green',
    grow: 'coral/green', bloom: 'coral/rose', flower: 'coral/rose', forest: 'coral/green',
    tree: 'coral/green', home: 'coral/amber', reality: 'coral/white',
    light: 'coral/gold', dawn: 'coral/gold', sun: 'coral/gold', gold: 'coral/gold',
    worm: 'worms/amber', worms: 'worms/amber', snake: 'worms/amber', roots: 'worms/amber',
    veins: 'worms/red', ember: 'worms/red', river: 'worms/blue',
    maze: 'maze/violet', labyrinth: 'maze/violet', mind: 'maze/violet', brain: 'maze/violet',
    thought: 'maze/violet', dream: 'maze/violet', ghost: 'maze/ice', spirit: 'maze/ice',
    memory: 'maze/indigo', signal: 'maze/green',
    star: 'soli/ice', stars: 'soli/ice', dust: 'soli/ice', rain: 'soli/blue',
    snow: 'soli/white', night: 'soli/indigo', moon: 'soli/ice', dark: 'soli/indigo',
    storm: 'chaos/red', chaos: 'chaos/red', fire: 'chaos/red', burn: 'chaos/amber',
    war: 'chaos/red', anger: 'chaos/red', lightning: 'chaos/ice',
    ocean: 'waves/blue', sea: 'waves/blue', wave: 'waves/blue', waves: 'waves/blue',
    tide: 'waves/blue', water: 'waves/blue', wind: 'waves/ice',
    calm: 'holes/indigo', still: 'holes/indigo', peace: 'holes/ice', sleep: 'holes/indigo',
    quiet: 'holes/grey', shelter: 'holes/amber',
    death: 'dead/grey', void: 'dead/grey', end: 'dead/grey', silence: 'dead/grey', nothing: 'dead/grey',
  }
  const caption = (text, kind) => {
    if (typeof window !== 'undefined')
      window.dispatchEvent(new CustomEvent('cafe:caption', { detail: { text, kind } }))
  }
  const tune = (word) => {
    let reg, pal
    const hit = LEX[word]
    if (hit) {
      const [r, c] = hit.split('/'); reg = REG[r]; pal = PAL[c]
    } else {
      // unheard words still land somewhere in parameter space, deterministically
      let h = 2166136261
      for (const ch of word) { h ^= ch.charCodeAt(0); h = (h * 16777619) >>> 0 }
      reg = [.014 + (h % 1000) / 1000 * .046, .045 + ((h >>> 10) % 1000) / 1000 * .021]
      const keys = Object.keys(PAL); pal = PAL[keys[(h >>> 20) % keys.length]]
    }
    G.tF = reg[0]; G.tk = reg[1]; G.tA = pal[0]; G.tB = pal[1]; G.tC = pal[2]
  }

  // typing — every letter is an input to the world
  // pulse counters from the engine — a tap between sim frames still lands
  const edge = (k) => {
    const n = wd['key_' + k + '_n'] || 0
    const was = G.keys[k] || 0
    G.keys[k] = n
    return n > was
  }
  for (let i = 0; i < 26; i++) {
    const ch = String.fromCharCode(97 + i)
    if (edge(ch) && G.word.length < 14) { G.word += ch; caption(G.word, 'typing') }
  }
  if (edge('backspace')) { G.word = G.word.slice(0, -1); caption(G.word, 'typing') }
  if (edge('space')) { G.word = ''; caption('', 'typing') }
  if (edge('enter') && G.word) {
    tune(G.word); G.committed = G.word; G.pulse = 1
    caption(G.word, 'tuned'); G.word = ''
  }
  if (!G.hinted && G.age > 1.6) { G.hinted = true; if (!G.word && !G.committed) caption('type a word · enter tunes reality', 'hint') }

  G.pulse = Math.max(0, G.pulse - dt2 * 0.8)
  const gl = (c, t, r) => c + (t - c) * Math.min(1, dt2 * r)
  G.F = gl(G.F, G.tF, 1.2); G.k = gl(G.k, G.tk, 1.2)
  G.A = gl(G.A, G.tA, 2); G.B = gl(G.B, G.tB, 2); G.C = gl(G.C, G.tC, 2)

  const mx = ((wd.mouse_x ?? 256) - 256) / 256
  const my = ((wd.mouse_y ?? 256) - 256) / 256
  wd.gpuUniforms = [mx, my, wd.mouse_down ? 1 : 0, G.F, G.k, G.A, G.B, G.C, G.pulse, G.age > 0.4 ? 1 : 0]
} catch (e) { /* the set stays on */ }
`

const scene = {
  name: 'SIGNAL',
  fields: [
    {
      id: 'sg_world_f', name: 'SIGNAL',
      color: [0.0, 0.0, 0.0, 1],
      effects: [], memory: [], proximity: [], properties: {},
      transform: { x: 256, y: 256, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 },
      shapeType: 'rect', w: 512, h: 512,
      visualTypeName: 'sg_world',
    },
  ],
  worldParams: { gravity: 0, friction: 1.0, collisionForce: 0, boundaryMode: 'open', bounciness: 0, gravitationalConstant: 0 },
  worldData: { noPixelSampling: true, instructions:
    'SIGNAL — a television tuned by language.\n\nThe picture is a living chemical reaction, not a recording. TYPE ANY WORD and press ENTER: the word becomes physics. Try coral, storm, cells, ocean, maze, stars, death.\n\nDrag the mouse to pour reagent into the tube.\n\nThe LEDs along the bottom bezel are thermostat shaders, each holding its patch of reality steady: amber = hunting, green = locked. Words the thermostats cannot survive exist.' },
  stepHooks: [{ id: 'signal_tuner', author: 'fable', description: 'SIGNAL: words tune a living reaction; thermostat shaders co-calibrate it', code: HOOK }],
  interactionRules: [],
  interactionEffects: [],
  visualTypes: [{ name: 'sg_world', wgsl: WORLD }],
  modules: [],
  timestamp: Date.now(),
}

const here = dirname(fileURLToPath(import.meta.url))
writeFileSync(join(here, '../../../../public/cartridges/SIGNAL.json'), JSON.stringify(scene, null, 1))
console.log('SIGNAL bundled to public/cartridges/SIGNAL.json')

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'SIGNAL', scene }),
}).catch(() => null)
if (res) console.log('SIGNAL saved to engine store:', res.status)
