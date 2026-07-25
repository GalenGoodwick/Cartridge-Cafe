#!/usr/bin/env node
// trace.mjs — check each node's TRACE (its intended integrations) against the
// map. A trace is declared when a node is made, so the seam is visible before it
// drifts. Two things get flagged:
//   • DANGLING   — an integration declared to a node the map has no edge to.
//   • CONVENTION — an agreement no import can prove (e.g. a numeric uniform
//                  layout shared JS↔WGSL). These need an AI to DEBATE/verify;
//                  the checker cannot.
//
//   node swarm/trace.mjs [mapPath]

import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { findNode, parentMap, ancestors } from './tree.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const map = JSON.parse(readFileSync(process.argv[2] || join(here, 'MAP.json'), 'utf8'))
const traces = JSON.parse(readFileSync(join(here, 'TRACES.json'), 'utf8'))
const pm = parentMap(map)

// tree-aware: an edge exists if any ancestor of src and any ancestor of dst are
// joined by a dependsOn (either direction) — a child inherits its parent's edges.
const edged = (s, d) => {
  for (const a of ancestors(map, s)) for (const b of ancestors(map, d)) {
    const A = findNode(map, a), B = findNode(map, b)
    if ((B?.dependsOn || []).includes(a) || (A?.dependsOn || []).includes(b)) return true
  }
  return false
}
const siblings = (s, d) => pm[s] && pm[s] === pm[d]

let dangling = 0, convention = 0, ok = 0
console.log('\nTRACES — intended integrations vs. the map')
for (const [srcId, list] of Object.entries(traces)) {
  if (srcId.startsWith('_')) continue
  const src = findNode(map, srcId)
  if (!src) { console.log(`  ✗ ${srcId}: source node not in map`); continue }
  for (const t of list) {
    const dst = findNode(map, t.to)
    const anchored = (src.exports || []).includes(String(t.via).replace(/\[.*$/, ''))
    let mark, note
    if (!dst) { mark = '✗ DANGLING'; note = `no node "${t.to}"`; dangling++ }
    else if (edged(srcId, t.to)) {
      if (anchored) { mark = '✓ CONTRACT'; note = 'anchored to an export (statically checkable)'; ok++ }
      else { mark = '🗣 CONVENTION'; note = 'edged but no export anchors it — needs AI debate/verify'; convention++ }
    }
    else if (siblings(srcId, t.to)) { mark = '🗣 CONVENTION'; note = `sibling seam under "${pm[srcId]}" — no import proves it; needs debate/pixel`; convention++ }
    else { mark = '⚠ DANGLING'; note = `no edge and not siblings — ${srcId} and ${t.to} are not integrated in the map`; dangling++ }
    console.log(`  ${mark}  ${srcId} → ${t.to}  via ${t.via}`)
    console.log(`     ${note}  ·  ${t.expect}`)
  }
}
console.log(`\n  ${ok} contract · ${convention} convention(need debate) · ${dangling} dangling`)
