// Give HELIOS a smooth ambient score per chapter — swapped when the chapter
// changes. Slow, warm, natural: long-attack pads, deep bass, sparse sparkles,
// no drums. Composed as data via the score framework (nothing hosted).
//   node helios-music.mjs
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const path = join(here, '../../../../public/cartridges/HELIOS.json')
const scene = JSON.parse(readFileSync(path, 'utf8'))
let code = scene.stepHooks[0].code

// per-chapter ambient scores (16-step loops, slow bpm, long washes)
const SCORES = {
  // I — THE VALLEY: warm, pastoral, C major → F. hopeful.
  1: { bpm: 62, loop: true, gain: 0.4, swing: 0.04, tracks: [
    { inst: 'triangle', gain: 0.42, cutoff: 520, a: 0.03, d: 2.4, notes: 'C2 . . . . . . . F2 . . . . . . .' },
    { inst: 'sawtooth', gain: 0.12, cutoff: 620, a: 1.0, d: 3.0, notes: 'C4+E4+G4 . . . . . . . F4+A4+C5 . . . . . . .' },
    { inst: 'sine', gain: 0.11, cutoff: 2000, a: 0.06, d: 1.6, notes: '. . . . G4 . . . . . C5 . . . A4 .' },
  ] },
  // II — THE DROWNED MOON: deep, submerged, D minor, muffled.
  2: { bpm: 54, loop: true, gain: 0.42, swing: 0, tracks: [
    { inst: 'sine', gain: 0.5, cutoff: 300, a: 0.06, d: 2.8, notes: 'D2 . . . . . . . A1 . . . . . . .' },
    { inst: 'sawtooth', gain: 0.11, cutoff: 400, a: 1.3, d: 3.4, notes: 'D3+F3+A3 . . . . . . . Bb2+D3+F3 . . . . . . .' },
    { inst: 'triangle', gain: 0.08, cutoff: 850, a: 0.5, d: 2.2, notes: '. . . . . . A4 . . . . . F4 . . .' },
  ] },
  // III — THE BEARER: bright, high, ethereal, A major. wonder, sky.
  3: { bpm: 60, loop: true, gain: 0.38, swing: 0.05, tracks: [
    { inst: 'triangle', gain: 0.3, cutoff: 760, a: 0.5, d: 2.6, notes: 'A2 . . . . . . . E3 . . . . . . .' },
    { inst: 'sawtooth', gain: 0.1, cutoff: 1050, a: 1.1, d: 3.0, notes: 'A3+C#4+E4 . . . . . . . E3+G#3+B3 . . . . . . .' },
    { inst: 'sine', gain: 0.14, cutoff: 3200, a: 0.02, d: 1.2, notes: 'A5 . E5 . . C#5 . . B5 . . . E5 . . .' },
  ] },
  // IV — THE FIRST LIGHT: tender, sparse → warm, F → resolves. creation.
  4: { bpm: 58, loop: true, gain: 0.4, swing: 0, tracks: [
    { inst: 'sine', gain: 0.4, cutoff: 380, a: 0.12, d: 3.2, notes: 'F2 . . . . . . . . . . . . . . .' },
    { inst: 'sawtooth', gain: 0.1, cutoff: 560, a: 1.5, d: 3.6, notes: 'F3+A3+C4 . . . . . . . . . . . . . .' },
    { inst: 'sine', gain: 0.13, cutoff: 2200, a: 0.08, d: 1.9, notes: '. . . . . . . . C5 . . . F5 . A5 .' },
  ] },
}

// inject: emit the chapter's score when the chapter changes (guarded so it fires
// once per entry). Placed right after defineChapters so it runs every frame.
const MUS = `\n  if (wd0.__mact !== sim.act) { wd0.__mact = sim.act; const HLM = ${JSON.stringify(SCORES)}; if (HLM[sim.act]) wd0.__play_music = { score: HLM[sim.act] } }`
const anchor = "'CHAPTER IV — THE FIRST LIGHT'])"
if (!code.includes(anchor)) throw new Error('defineChapters anchor not found')
if (code.includes('wd0.__mact')) throw new Error('music already injected')
code = code.replace(anchor, anchor + MUS)

scene.stepHooks[0].code = code
scene.timestamp = Date.now()
writeFileSync(path, JSON.stringify(scene, null, 1))
console.log('HELIOS: per-chapter ambient scores wired')
const res = await fetch('http://localhost:3000/api/engine/scene', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
  body: JSON.stringify({ action: 'save', name: 'HELIOS', scene }),
}).catch(() => null)
if (res) console.log('saved:', res.status)
