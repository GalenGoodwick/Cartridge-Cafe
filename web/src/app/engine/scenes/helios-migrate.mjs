// Migrate HELIOS's chapter scaffolding onto the new sim primitives:
//   HX.act / HX.unlocked / hand-rolled flags  →  sim.act / completeChapter /
//   goChapter / chapterUnlocked, and the trees grow via sim.trigger (reliable).
// The per-chapter gameplay bodies are untouched — only the scaffolding changes.
//   node helios-migrate.mjs
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const path = join(here, '../../../../public/cartridges/HELIOS.json')
const scene = JSON.parse(readFileSync(path, 'utf8'))
let code = scene.stepHooks[0].code

const must = (anchor, next, label) => {
  if (!code.includes(anchor)) throw new Error('MISSING anchor: ' + label)
  code = code.split(anchor).join(next)
}

// 1 — init: chapter state moves to the sim; HX keeps only pmd/capd
must("wd0.__hx = { act: 1, unlocked: 1, pmd: false, capd: '' }",
     "wd0.__hx = { pmd: false, capd: '' }", 'init')
must("const HX = wd0.__hx",
     "const HX = wd0.__hx\n  sim.defineChapters(['CHAPTER I \\u2014 THE VALLEY', 'CHAPTER II \\u2014 THE DROWNED MOON', 'CHAPTER III \\u2014 THE BEARER'])", 'defineChapters')

// 2 — navigation writes → goChapter (reads become sim.act via the blanket below)
must("HX.act -= 1", "sim.goChapter(sim.act - 1)", 'nav-back')
must("HX.act += 1", "sim.goChapter(sim.act + 1)", 'nav-fwd')

// 3 — chapter transitions → completeChapter (unlock next + step in)
must("HX.act = 2; HX.unlocked = Math.max(HX.unlocked, 2);", "sim.completeChapter();", 'ch1→2')
must("HX.act = 3; HX.unlocked = Math.max(HX.unlocked, 3)", "sim.completeChapter()", 'ch2→3')
must("HX.act = 1; HX.capd = ''", "sim.goChapter(1); HX.capd = ''", 'ch3-door-home')

// 4 — "is the next chapter unlocked?" reads
must("HX.act < HX.unlocked", "sim.chapterUnlocked(sim.act + 1)", 'unlock-read')
must("HX.unlocked >= 2", "sim.chapterUnlocked(2)", 'hud-unlock')

// 5 — the trees now grow the MOMENT the six stones are lit — reliable, no hidden
//     click (ch1) — via a latched trigger instead of a hand-rolled flag+click
must("allLit && !G.started && click", "sim.trigger('ch1_tree', allLit)", 'ch1-tree')
must("if (all && !M.won) {", "if (sim.trigger('ch2_tree', all)) {", 'ch2-tree')

// 6 — every remaining HX.act is a READ → sim.act
code = code.split("HX.act").join("sim.act")

// guardrails: no chapter state should linger on HX
if (code.includes("HX.unlocked")) throw new Error('leftover HX.unlocked')
if (/HX\.act\s*[-+]?=[^=]/.test(code)) throw new Error('leftover HX.act assignment')

scene.stepHooks[0].code = code
scene.timestamp = Date.now()
writeFileSync(path, JSON.stringify(scene, null, 1))
console.log('HELIOS migrated onto sim chapter/trigger primitives')
const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'HELIOS', scene }),
}).catch(() => null)
if (res) console.log('saved:', res.status)
