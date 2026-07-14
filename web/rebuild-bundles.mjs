// rebuild-bundles — sync public/cartridges/*.json to the live world store.
//
// The /play/<name> route serves worlds from these static bundles (CDN-cached,
// serverless-proof), preferring them over the store API. After editing worlds
// locally, run this so every bundle matches the store — then a deploy is just
// `git push`. Also refreshes index.json (the door's shelf manifest).
//
//   node rebuild-bundles.mjs
//
// Reads .engine-store.json directly (no running server needed).

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'public', 'cartridges')
mkdirSync(OUT, { recursive: true })

const store = JSON.parse(readFileSync(join(here, '.engine-store.json'), 'utf-8'))
const sceneNames = Object.keys(store.scenes || {})
if (!sceneNames.length) { console.error('no scenes in .engine-store.json — nothing to bundle'); process.exit(1) }

// Rebuild every scene's bundle. A scene snapshot is exactly what the play route
// expects (fields, visualTypes, stepHooks, worldData, …) — the store already
// holds them in that shape.
let n = 0
for (const name of sceneNames) {
  const scene = store.scenes[name]
  if (!scene || !scene.fields) { console.log('  skip (empty):', name); continue }
  writeFileSync(join(OUT, name + '.json'), JSON.stringify(scene))
  n++
}

// index.json — the door's shelf: playable worlds, minus the hubs and branches
const shelf = sceneNames
  .filter(nm => nm !== 'CAFE' && nm !== 'SUB-MAIN' && !nm.includes(' ⑂ '))
  .sort()
writeFileSync(join(OUT, 'index.json'), JSON.stringify({ names: shelf }, null, 1))

console.log(`rebuilt ${n} bundles · shelf lists ${shelf.length} worlds`)
console.log('bundles are in sync with the store — a deploy is now `git push`')
