#!/usr/bin/env node
// dock.mjs — an AI docks into a node and gets its SITUATION relative to the
// worktree: what it owns, its contract, whether its foundations are green, who
// leans on it, and which nodes it may jump to. This is the briefing you read
// the moment you arrive in a node, before you touch code.
//
//   node swarm/dock.mjs <nodeId>

import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const map = JSON.parse(readFileSync(join(here, 'MAP.json'), 'utf8'))
const id = process.argv[2]
const node = map.nodes.find((n) => n.id === id)
if (!node) {
  console.error(`no node "${id}". nodes: ${map.nodes.map((n) => n.id).join(', ')}`)
  process.exit(1)
}
const byId = (x) => map.nodes.find((n) => n.id === x)
const dot = { green: '🟢', red: '🔴', gated: '🟡', claimed: '🔵', open: '⚪', unknown: '⚫' }
const tag = (n) => `${dot[n.status] || '⚫'} ${n.status}`

const deps = (node.dependsOn || []).map(byId).filter(Boolean)
const dependents = map.nodes.filter((n) => (n.dependsOn || []).includes(id))
const depsGreen = deps.every((d) => d.status === 'green')
// nodes you may jump to: not this one, unclaimed, and all their deps are green
const jumpable = map.nodes.filter((n) =>
  n.id !== id && !n.claim && ['open', 'red', 'unknown'].includes(n.status) &&
  (n.dependsOn || []).map(byId).every((d) => d && d.status === 'green'))

const L = []
L.push(`\n╔═ DOCKED: ${node.id}  —  ${map.project} (trunk ${map.trunk})`)
L.push(`║ ${node.area}`)
L.push(`║ status: ${tag(node)}${node.statusNote ? '  (' + node.statusNote + ')' : ''}`)
L.push(`║ claim:  ${node.claim ? JSON.stringify(node.claim) : 'OPEN — set claim{by,at} before editing'}`)
L.push('║')
L.push('║ YOUR FILES (edit only these — clobber law):')
for (const f of (node.files.length ? node.files : ['(none — action node)']))
  L.push(`║   ${node.files.length && !existsSync(join(here, '..', f)) ? '✗ MISSING ' : '• '}${f}`)
L.push('║')
L.push(`║ YOUR CONTRACT (exports your dependents rely on):`)
L.push(`║   ${node.exports && node.exports.length ? node.exports.join(', ') : '(none)'}`)
L.push('║')
L.push('║ FOUNDATIONS (dependencies — build only on green):')
if (!deps.length) L.push('║   (none — you are a root node)')
for (const d of deps) L.push(`║   ${tag(d)}  ${d.id}  →  ${(d.exports || []).join(', ')}`)
if (deps.length && !depsGreen) L.push('║   ⚠ a foundation is not green — heal it or take another node')
L.push('║')
L.push('║ DEPENDENTS (change your exports → raise a heal-wave on these):')
if (!dependents.length) L.push('║   (none)')
for (const d of dependents) {
  const open = ['open', 'unknown'].includes(d.status) && !d.claim
  L.push(`║   ${tag(d)}  ${d.id}${open ? '   ← OPEN: you may build this side too (rule 5)' : ''}`)
}
L.push('║')
L.push('║ JUMP-TO (open nodes whose foundations are green):')
if (!jumpable.length) L.push('║   (none right now)')
for (const j of jumpable) L.push(`║   ⚪ ${j.id}  —  ${j.area}`)
L.push('║')
L.push('║ NEXT: read swarm/SWARM-GUIDE.md · verify with `node swarm/status.mjs ' + id + '`')
L.push('╚' + '═'.repeat(60))
console.log(L.join('\n'))
