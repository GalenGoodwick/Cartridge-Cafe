#!/usr/bin/env node
// loop.mjs — the agent loop. What an AI runs when it finishes a node:
//
//   FIND-OPEN  → an open node whose foundations are green? dock into it. Jump.
//   else VISION → scan for gaps (unverified surface, missing deps, referenced-
//                 but-absent areas). Each gap AUTO-DEPLOYS as a new open node in
//                 the map — the bug files itself into the work-graph.
//   EXPAND     → tree grew? report it; the next agent finds the new node.
//   FINISH     → nothing open, no gaps, all green or gated? the map is done.
//
// "Done" is never self-declared — a node is done only when status.mjs derives it
// green from tests. This loop just decides WHERE to go next, from the map's truth.
//
//   node swarm/loop.mjs [mapPath]

import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const mapPath = process.argv[2] || join(here, 'MAP.json')
const map = JSON.parse(readFileSync(mapPath, 'utf8'))
const byId = (id) => map.nodes.find((n) => n.id === id)
const depsGreen = (n) => (n.dependsOn || []).every((d) => byId(d)?.status === 'green')

// ── FIND-OPEN: a ready node to jump into ──
const open = map.nodes.filter((n) => ['open', 'red', 'unknown'].includes(n.status) && !n.claim && depsGreen(n))
if (open.length) {
  const t = open[0]
  console.log(`IDEATE → before you jump, decide: does a NEW node need to exist first?`)
  console.log(`  a missing seam · a finer sub-node · a contract that should split.`)
  console.log(`  if yes → add it to the MAP and re-run. if no → jump:`)
  console.log(`JUMP → dock into "${t.id}"  (${t.status}, foundations green)`)
  console.log(`  node swarm/dock.mjs ${t.id}`)
  process.exit(0)
}

// ── VISION: detect gaps, auto-deploy each as an open node ──
const gaps = []
const exists = (id) => !!byId(id)

// (a) referenced-but-absent: a dependency id with no node
for (const n of map.nodes)
  for (const d of n.dependsOn || [])
    if (!exists(d) && !gaps.find((g) => g.id === d))
      gaps.push({ id: d, area: `MISSING dependency referenced by ${n.id}`, files: [], exports: [], dependsOn: [], tests: [], status: 'open', claim: null, bornFrom: 'vision:missing-dep' })

// (b) unverified runtime surface: a node ships a WGSL visual but nothing drives
//     it on a real GPU. Unit tests can't reach pixels — that surface is unproven.
const shipsShader = map.nodes.find((n) => (n.exports || []).includes('VISUAL'))
const hasPixelVerify = map.nodes.some((n) => /pixel|render-verify|gpu/i.test(n.id))
if (shipsShader && !hasPixelVerify)
  gaps.push({
    id: 'pixel-verify',
    area: `drive ${shipsShader.id}'s WGSL on a real GPU (oracle.mjs) and confirm it renders — the one surface unit tests cannot reach`,
    files: [], exports: [], dependsOn: [shipsShader.id], tests: [],
    status: 'gated', gate: 'gpu-or-deploy', claim: null, bornFrom: 'vision:unverified-surface',
  })

if (gaps.length) {
  map.nodes.push(...gaps)
  writeFileSync(mapPath, JSON.stringify(map, null, 2) + '\n')
  console.log(`EXPAND → tree grew by ${gaps.length}: ${gaps.map((g) => g.id).join(', ')}`)
  for (const g of gaps) console.log(`  + ${g.id}  [${g.status}${g.gate ? ':' + g.gate : ''}]  ${g.area}`)
  const jumpable = gaps.filter((g) => g.status === 'open' && depsGreen(g))
  console.log(jumpable.length
    ? `NEXT → jump into "${jumpable[0].id}"`
    : `NEXT → new nodes are gated (${gaps.map((g) => g.gate).filter(Boolean).join(', ')}) — nothing to build without the gate lifting`)
  process.exit(0)
}

// ── FINISH ──
const g = map.nodes.filter((n) => n.status === 'green').length
const gated = map.nodes.filter((n) => n.status === 'gated').length
console.log(`FINISH → map complete. ${g} green, ${gated} gated, 0 open. Nothing to do without a gate lifting.`)
