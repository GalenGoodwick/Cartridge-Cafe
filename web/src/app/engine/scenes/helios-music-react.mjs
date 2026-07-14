// Make HELIOS's music a second rendering of its own state — the score's
// brightness follows each chapter's mechanic. Chapter I: the sound darkens as
// the sun sets to moon and opens as it rises. Chapter IV: it brightens as the
// spark is fed and blazes at ignition. II/III get a fitting static tone.
//   node helios-music-react.mjs
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const path = join(here, '../../../../public/cartridges/HELIOS.json')
const scene = JSON.parse(readFileSync(path, 'utf8'))
let code = scene.stepHooks[0].code
const must = (a, n, label) => { if (!code.includes(a)) throw new Error('MISSING ' + label); code = code.split(a).join(n) }
if (code.includes('music_mod')) throw new Error('reactive music already wired')

// 1 — on chapter change, set an initial brightness per chapter (II deep, III airy)
must(
  'if (HLM[sim.act]) wd0.__play_music = { score: HLM[sim.act] } }',
  "if (HLM[sim.act]) wd0.__play_music = { score: HLM[sim.act] }; wd0.music_mod = { brightness: ({ 1: 0.9, 2: 0.4, 3: 0.72, 4: 0.28 })[sim.act] || 0.7 } }",
  'emit-default')

// 2 — CHAPTER I: brightness tracks the sun/moon phase (the headline binding)
must(
  'const moonness = 0.5 - 0.5 * Math.cos(2 * Math.PI * S.phase)',
  'const moonness = 0.5 - 0.5 * Math.cos(2 * Math.PI * S.phase)\n      wd0.music_mod = { brightness: 1 - moonness * 0.72 }',
  'ch1-sun')

// 3 — CHAPTER IV: brightness grows as the spark is fed, blazes at ignition
must(
  'const cx4 = F.ignite ? F.ix : mxX',
  'wd0.music_mod = { brightness: Math.min(1, 0.22 + 0.6 * F.life + 0.45 * (F.ignite ? (F.igniteT || 0) : 0)) }\n    const cx4 = F.ignite ? F.ix : mxX',
  'ch4-spark')

scene.stepHooks[0].code = code
scene.timestamp = Date.now()
writeFileSync(path, JSON.stringify(scene, null, 1))
console.log('HELIOS: music now breathes with world state (ch1 sun, ch4 spark, ii/iii tuned)')
const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'HELIOS', scene }),
}).catch(() => null)
if (res) console.log('saved:', res.status)
