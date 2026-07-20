// make-hub — pour any list of worlds into a cafe-style hub (a "sub-main").
//
//   node make-hub.mjs ARCADE TV ESPER "NOCTURNE DISTRICT" SIGNAL
//
// Reuses the live CAFE as the template: same starfield room, same hover/launch
// hook, same portal-position publishing (so the shell's name labels and live
// head-count chips work automatically), but with its own world list laid out
// on a golden-angle spiral. The result is a scene like any other — play it at
// /hub/<NAME>, portal in from anywhere, ESC/◂ climbs back out.
// Hubs publish portals, which also tells the engine to hide branch chrome.
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const [name, ...worlds] = process.argv.slice(2)
if (!name || worlds.length === 0) {
  console.error('usage: node make-hub.mjs HUBNAME world1 world2 ...')
  process.exit(1)
}

const here = dirname(fileURLToPath(import.meta.url))
const base = JSON.parse(readFileSync(join(here, 'hub-template.json'), 'utf8'))

const N = worlds.length
const hash = (str) => {
  let h = 2166136261
  for (const c of str) { h ^= c.charCodeAt(0); h = (h * 16777619) >>> 0 }
  return h
}

// golden-angle spiral: dense center, expands to fit any count
const POSA = []
for (let i = 0; i < N; i++) {
  const r = 0.155 * Math.sqrt(i + 0.6)
  const a = i * 2.399963
  POSA.push([+(r * Math.cos(a)).toFixed(3), +(r * Math.sin(a) * 0.82).toFixed(3)])
}

// per-world miniature style + hue from the existing style set (0..8);
// worlds will bring their own icons (worldData.icon) in the next stage
const style = (w) => hash(name + w) % 9
const hue = (w) => +(((hash(w) % 997) / 997)).toFixed(3)

// ── WGSL: regenerate the three lookup tables + loop counts ──
let w = base.visualTypes[0].wgsl
const table = (fname, ret, vals, fallback) => {
  let out = `fn ${fname}(i: i32) -> ${ret} {\n`
  vals.forEach((v, i) => { out += `  if (i == ${i}) { return ${v}; }\n` })
  out += `  return ${fallback};\n}`
  return out
}
const swap = (src, fname, ret, vals, fallback) => {
  const re = new RegExp(`fn ${fname}\\(i: i32\\) -> ${ret} \\{[\\s\\S]*?\\n\\}`)
  if (!re.test(src)) throw new Error(fname + ' not found in template')
  return src.replace(re, table(fname, ret, vals, fallback))
}
w = swap(w, 'cf_portal_pos', 'vec2f', POSA.map(p => `vec2f(${p[0]}, ${p[1]})`), 'vec2f(0.0, 0.0)')
w = swap(w, 'cf_style', 'i32', worlds.map(g => String(style(g))), '8')
w = swap(w, 'cf_hue', 'f32', worlds.map(g => hue(g).toFixed(3)), '0.5')
w = w.replace(/for \(var i = 0; i < \d+; i\+\+\) \{/g, (m) => m.replace(/\d+/, String(N)))
base.visualTypes[0].wgsl = w

// ── hook: same behavior, new roster ──
let h = base.stepHooks[0].code
h = h.replace(/const GAMES = \[[^\]]*\]/, 'const GAMES = ' + JSON.stringify(worlds))
h = h.replace(/const POSA = \[[\s\S]*?\]\]/, 'const POSA = ' + JSON.stringify(POSA))
h = h.replace(/hov\.length !== \d+/, 'hov.length !== ' + N)
h = h.replace(/Array\(\d+\)\.fill\(0\)/, `Array(${N}).fill(0)`)
h = h.replace(/for \(let i = 0; i < \d+; i\+\+\)/g, `for (let i = 0; i < ${N}; i++)`)
// hubs announce their doors on a timer — a once-flag would be restored by the
// save-stash and never fire again (triggers are state, not events)
h = h.replace('const down = !!wd.mouse_down', `C.portalT = (C.portalT || 0) - dt2
  if (C.portalT <= 0 && typeof window !== 'undefined') {
    C.portalT = 2
    window.dispatchEvent(new CustomEvent('cafe:portals', {
      detail: GAMES.map((g, i) => ({ name: g, x: POSA[i][0], y: POSA[i][1], r: 0.10 })),
    }))
  }
  const down = !!wd.mouse_down`)
base.stepHooks[0].code = h
base.stepHooks[0].id = 'hub_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_')
base.stepHooks[0].description = name + ': a sub-main hub — hover blooms, click enters, portals published to the shell'

base.name = name
base.fields[0].id = 'hub_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_f'
base.fields[0].name = name
if (base.worldData) {
  base.worldData.instructions = name + ' — a sub-main: its own shelf of worlds.\nHOVER a window to see its name · CLICK to enter · ◂ or ESC climbs back out.\nHead-count chips show who is inside each world right now.'
}
base.timestamp = Date.now()

writeFileSync(join(here, `../../../../public/cartridges/${name}.json`), JSON.stringify(base, null, 1))
console.log(`${name} bundled (${N} worlds)`)

const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name, scene: base }),
}).catch(() => null)
if (res) console.log('saved to store:', res.status)
