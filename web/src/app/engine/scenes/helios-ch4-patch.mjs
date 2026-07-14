// Patch HELIOS.json to add CHAPTER IV — THE FIRST LIGHT.
// Kindle a spark in the void; HOLD to feed it, keep still or the dark eats it;
// when whole it ignites into the first sun. Wires the ch3 door → ch4.
//   node helios-ch4-patch.mjs
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const path = join(here, '../../../../public/cartridges/HELIOS.json')
const scene = JSON.parse(readFileSync(path, 'utf8'))

const must = (s, anchor, next, label) => {
  if (!s.includes(anchor)) throw new Error('anchor NOT FOUND: ' + label)
  return s.split(anchor).join(next)
}

// ── hook: CHNAMES, bind ch3, wire door → ch4, add ch4 branch ──
let code = scene.stepHooks[0].code

code = must(code, "THE BEARER']", "THE BEARER', 'CHAPTER IV — THE FIRST LIGHT']", 'CHNAMES')
code = must(code, '} else if (!navX) {', '} else if (!navX && HX.act === 3) {', 'ch3-open')
code = must(code,
  "capX('CHAPTER IV \\u2014 not yet written \\u00b7 step through to the valley', 'hint')",
  "capX('CHAPTER IV — THE FIRST LIGHT · a spark waits in the dark before the sun', 'hint')",
  'ch3-door-hint')
code = must(code,
  "HX.act = 1; HX.capd = ''; capX('CHAPTER I \\u2014 THE VALLEY \\u00b7 home, with the light', 'tuned')",
  "HX.act = 4; HX.unlocked = Math.max(HX.unlocked, 4); HX.capd = ''; wd0.__play_sound = [{ frequency: 140, duration: 0.7, volume: 0.3, type: 'sine' }]; capX('CHAPTER IV — THE FIRST LIGHT · kindle it', 'tuned')",
  'ch3-door-enter')

const CH4_HOOK = `
    // ── CHAPTER IV — THE FIRST LIGHT ──
    if (!wd0.__hx4) wd0.__hx4 = { life: 0.14, ignite: 0, igniteT: 0, hinted: 0, near: 0, dead: 0, lx: mxX, ly: myX, ix: 0, iy: 0 }
    const F = wd0.__hx4
    const spd4 = Math.hypot(mxX - F.lx, myX - F.ly); F.lx = mxX; F.ly = myX
    if (!F.hinted) { F.hinted = 1; capX('a spark in the dark · hold to feed it · keep still', 'hint') }
    if (!F.ignite) {
      if (mdX) {
        const feed = Math.max(0.12, 1 - spd4 * 6)
        F.life = Math.min(1, F.life + pdtX * feed / 5)
      } else {
        F.life = Math.max(0, F.life - pdtX / 12)
      }
      if (F.life <= 0.02 && !F.dead) { F.dead = 1; capX('the dark closes in · hold it, keep still', 'hint') }
      if (F.life > 0.12) F.dead = 0
      if (F.life >= 1) {
        F.ignite = 1; F.ix = mxX; F.iy = myX
        wd0.__play_sound = [{ frequency: 180, duration: 0.8, volume: 0.32, type: 'sine' }, { frequency: 360, duration: 1.0, volume: 0.24, type: 'sine' }, { frequency: 540, duration: 1.3, volume: 0.18, type: 'triangle' }]
        capX('it catches · the first light', 'tuned')
      } else if (F.life > 0.85 && !F.near) { F.near = 1; capX('almost · hold it steady', 'hint') } else if (F.life < 0.7) F.near = 0
    } else {
      F.igniteT = Math.min(1, (F.igniteT || 0) + pdtX / 3.2)
      if (F.igniteT >= 0.999) {
        const nearDoor = myX > 0.5 && Math.abs(mxX) < 0.2
        if (nearDoor) capX('carry it home · CHAPTER I — THE VALLEY', 'hint')
        if (nearDoor && clickX) { HX.act = 1; HX.capd = ''; capX('CHAPTER I — THE VALLEY · the light you kindled hangs over it', 'tuned') }
      }
    }
    const cx4 = F.ignite ? F.ix : mxX, cy4 = F.ignite ? F.iy : myX
    const u4 = [cx4, cy4, F.life, mdX ? 1 : 0, F.ignite ? (F.igniteT || 0) : 0, spd4, 0, 0]
    u4[24] = 4
    wd0.gpuUniforms = u4
    wd0.hud = []
  `
code = must(code,
  "wd0.hud = []\n  }\n  if (navX) {",
  "wd0.hud = []\n  } else if (!navX && HX.act === 4) {" + CH4_HOOK + "}\n  if (navX) {",
  'ch4-branch')

scene.stepHooks[0].code = code

// ── shader: add the CHAPTER IV scene to visual_helios_chapters ──
const vt = scene.visualTypes.find(v => v.name === 'helios_chapters')
if (!vt) throw new Error('helios_chapters visual not found')
const CH4_WGSL = `  // ════ CHAPTER IV — THE FIRST LIGHT ════
  if (act > 3.5) {
    let life = clamp(uni(2), 0.0, 1.0);
    let held = uni(3);
    let ig = clamp(uni(4), 0.0, 1.0);
    let mm = uv - mc;
    let dd = length(mm);
    let ang = atan2(mm.y, mm.x);
    var col = vec3f(0.004, 0.006, 0.014);
    let dsp = uv * 12.0 + vec2f(0.0, t * 0.02);
    let dh = hash21(floor(dsp));
    if (dh > 0.984) { col += vec3f(0.12, 0.14, 0.22) * smoothstep(0.2, 0.03, length(fract(dsp) - 0.5)) * (0.3 + 0.3 * sin(t + dh * 40.0)); }
    let claw = fbm3(vec2f(ang * 2.2 + 4.0, t * 0.13));
    let bite = (1.0 - life) * (1.0 - ig) * smoothstep(0.3, 0.9, claw);
    let radius = (0.09 + 0.34 * life) * (1.0 - bite * 0.75);
    let warm = mix(vec3f(1.1, 0.72, 0.36), vec3f(1.5, 1.15, 0.7), life);
    let halo = smoothstep(radius, radius * 0.25, dd);
    col += warm * halo * (0.35 + 0.75 * life);
    col += vec3f(1.7, 1.35, 0.9) * exp(-dd * dd / (0.0004 + 0.006 * life)) * (0.7 + 0.6 * life);
    col -= vec3f(0.006, 0.006, 0.012) * smoothstep(radius * 1.6, radius, dd) * bite * 3.0;
    col = max(col, vec3f(0.001, 0.002, 0.006));
    if (life > 0.35) {
      for (var k = 0; k < 3; k = k + 1) {
        let ka = t * 0.6 + f32(k) * 2.094;
        let ep = mc + vec2f(cos(ka), sin(ka)) * radius * 0.7;
        col += vec3f(1.3, 0.9, 0.5) * exp(-dot(uv - ep, uv - ep) * 1400.0) * (life - 0.35) * 1.3;
      }
    }
    if (held > 0.5) {
      let ring = abs(dd - fract(t * 0.8) * radius * 1.4);
      col += warm * smoothstep(0.015, 0.0, ring) * 0.35 * (0.4 + life);
    }
    if (ig > 0.001) {
      let sr = 0.05 + 0.9 * ig * ig;
      col += vec3f(1.9, 1.5, 0.9) * exp(-dd * dd / (sr * sr)) * (0.6 + ig);
      col += vec3f(1.3, 0.95, 0.55) * ig * (0.12 + 0.08 * sin(t * 1.6));
      let rays = 0.5 + 0.5 * sin(ang * 9.0 + t * 0.4);
      col += warm * rays * smoothstep(0.7, 0.05, dd) * ig * 0.18;
      if (ig > 0.97) {
        let dp2 = uv - vec2f(0.0, 0.62);
        let door = smoothstep(0.16, 0.12, abs(dp2.x)) * smoothstep(0.12, 0.09, abs(dp2.y));
        col += vec3f(1.0, 0.9, 0.6) * door * (0.4 + 0.12 * sin(t * 2.0));
      }
    }
    col *= 1.0 - 0.42 * pow(length(uv) * 0.72, 3.0);
    if (col.x != col.x || col.y != col.y || col.z != col.z) { col = vec3f(0.01); }
    return vec4f(clamp(col, vec3f(0.0), vec3f(30.0)), 1.0);
  }

  `
vt.wgsl = must(vt.wgsl, '  let won = uni(10);', CH4_WGSL + 'let won = uni(10);', 'ch4-shader')

// ── instructions ──
scene.worldData.instructions =
  'HELIOS — a story in chapters. One world.\n\n' +
  'MOVE — the light follows your cursor · CLICK & HOLD — hurry time / turn the light\n' +
  'Bottom corners — move between UNLOCKED chapters.\n\n' +
  'CHAPTER I — THE VALLEY: carry the sun; hold for the moon. Light the six stones to wake the tree. When the moon is full, its reflection on the lake invites you down.\n' +
  'CHAPTER II — THE DROWNED MOON: six phase-stones ring the deep; match the crescents. The moon-tree descends further.\n' +
  'CHAPTER III — THE BEARER: seven stars wait. DRAG a thread of light from star to star — only the figure’s true lines take. Six threads write the light-carrier into the sky.\n' +
  'CHAPTER IV — THE FIRST LIGHT: the void before any sun. Cup the faint spark and HOLD to feed it; keep still, or the dark eats its edges. Kindle it whole and it ignites into the first light — the sun that will hang over the valley.\n\n' +
  'Progress persists per chapter.'

scene.timestamp = Date.now()
writeFileSync(path, JSON.stringify(scene, null, 1))
console.log('HELIOS patched — chapter IV added')
const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'HELIOS', scene }),
}).catch(() => null)
if (res) console.log('HELIOS saved:', res.status)
