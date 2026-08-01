// build a probe state that renders proto/entities3d.wgsl with a POPULATION of
// entities (geometry entirely from data), then call the offline deno render.
// usage: node proto/render.mjs [selectedId] [outfile]
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const wgsl = readFileSync(join(HERE, 'entities3d.wgsl'), 'utf8')
const selectedId = process.argv[2] != null ? Number(process.argv[2]) : -1
const out = process.argv[3] || '/tmp/proto-entities3d.png'
const angle = process.argv[4] != null ? Number(process.argv[4]) : 0.35

// THE SCENE, as pure data — 2 rows per entity: (px,py,pz,kind),(yaw,scale,id,_)
const entities = [
  { pos: [-2.2, 0, 0.3], kind: 0, yaw: 0, scale: 1.0, id: 0 },   // sphere
  { pos: [0.0, 0, 1.6], kind: 1, yaw: 0.6, scale: 0.95, id: 1 }, // box
  { pos: [2.2, 0, 0.2], kind: 2, yaw: 0, scale: 1.1, id: 2 },    // tree
  { pos: [-0.9, 0, -1.3], kind: 1, yaw: 2.1, scale: 0.6, id: 3 },// small box, behind
  { pos: [1.1, 0, -1.1], kind: 0, yaw: 0, scale: 0.7, id: 4 },   // small sphere, behind
]
const pop = []
for (const e of entities) { pop.push(e.pos[0], e.pos[1], e.pos[2], e.kind, e.yaw, e.scale, e.id, 0) }
const uni = new Array(64).fill(0)
uni[0] = angle        // uni(0) = camera orbit angle
uni[1] = selectedId   // uni(1) = the selected/inspected entity id

const state = {
  visualTypes: [{ name: 'e3', wgsl }],
  fields: [],
  stepHooks: [],
  worldData: { gpuPopulation: pop, gpuUniforms: uni },
}
const stateFile = join(HERE, '.state.json')
writeFileSync(stateFile, JSON.stringify(state))

const DENO = process.env.DENO_BIN || '/opt/homebrew/bin/deno'
const res = execFileSync(DENO, [
  'run', '-A', '--unstable-webgpu', join(REPO, 'tools/render-probe.mjs'),
  '--state', stateFile, '--name', 'e3', '--out', out, '--ticks', '1',
], { encoding: 'utf8' })
const line = res.trim().split('\n').filter(Boolean).pop()
const j = JSON.parse(line)
console.log('entities (from data):', entities.length, '· selected id:', selectedId)
console.log('render:', 'ok=' + j.ok, 'errors=' + JSON.stringify(j.errors || []), 'coverage=' + j.coveragePct, '→', out)
