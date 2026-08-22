#!/usr/bin/env node
// status.mjs — derive every node's status from REALITY, over the whole tree,
// gated on its KEYS. A node is green only when every key it owes is fulfilled:
// tests passing is just ONE key. A gameplay node also owes playthrough-confirmed;
// a render node owes visual-reference. Pending keys → 'partial' (started, unfinished)
// or 'open' (unstarted). A failed key or failed test → red. Never hand-set.
//
//   node swarm/status.mjs [mapPath]     (VIGIL_GPU=1 satisfies render-verified)

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { flatten } from './tree.mjs'
import { autoKeys, keyState } from './keys.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const mapPath = process.argv[2] || join(here, 'MAP.json')
const map = JSON.parse(readFileSync(mapPath, 'utf8'))
const GPU = process.env.VIGIL_GPU === '1'

// PORTABLE test runner. The tools live in <repo>/swarm/, so node `files` resolve
// repo-relative (here/..). The test command + cwd are configurable so any project
// works: env SWARM_TEST_CMD / SWARM_TEST_CWD, or a swarm.config.json beside the MAP,
// else `npx vitest run` in the repo root. (cartridge-cafe sets SWARM_TEST_CWD=web.)
const cfgPath = join(dirname(mapPath), 'swarm.config.json')
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {}
const testCwd = process.env.SWARM_TEST_CWD || cfg.testCwd || join(here, '..')
const testCmd = process.env.SWARM_TEST_CMD || cfg.testCmd || 'npx vitest run'
const runTests = (tests) => {
  try { execSync(`${testCmd} ${tests.join(' ')}`, { cwd: testCwd, stdio: 'pipe' }); return true }
  catch { return false }
}
const keyNote = (ks) => Object.entries(ks).map(([k, v]) => `${v === 'pass' ? '✓' : v === 'fail' ? '✗' : '·'}${k}`).join('  ')

function evalNode(n) {
  const missing = (n.files || []).filter((f) => !existsSync(join(here, '..', f)))
  if (missing.length) { n.status = 'red'; n.statusNote = 'missing: ' + missing.join(', '); return }

  const testPass = n.tests && n.tests.length ? runTests(n.tests) : null
  if (testPass === false) { n.status = 'red'; n.statusNote = 'tests failed'; return }
  const renderVerified = (n.evidence && n.evidence['render-verified'] != null) || GPU

  const keys = autoKeys(n)
  const ks = {}
  for (const k of keys) ks[k] = keyState(k, n, { testPass, renderVerified })
  n.keyState = ks
  const vals = Object.values(ks)
  const started = (n.files && n.files.length) || n.evidence || vals.includes('pass')

  if (n.children && n.children.length) {
    n.children.forEach(evalNode)
    const kids = n.children
    if (vals.includes('fail') || kids.some((k) => k.status === 'red')) n.status = 'red'
    else if (vals.includes('pending') || kids.some((k) => ['partial', 'open'].includes(k.status))) n.status = 'partial'
    else n.status = 'green'
    n.statusNote = (keys.length ? keyNote(ks) + '  |  ' : '') + kids.map((k) => k.id + '·' + k.status).join(' ')
    return
  }

  if (!keys.length) { n.status = n.claim ? 'claimed' : 'open'; n.statusNote = 'no keys — scope it'; return }
  if (vals.includes('fail')) n.status = 'red'
  else if (vals.every((v) => v === 'pending') && !started) n.status = 'open'
  else if (vals.includes('pending')) n.status = 'partial'
  else n.status = 'green'
  n.statusNote = keyNote(ks) + (n.playtestNote ? '  — ' + n.playtestNote : '')
}

map.nodes.forEach(evalNode)
writeFileSync(mapPath, JSON.stringify(map, null, 2) + '\n')

const dot = { green: '🟢', red: '🔴', partial: '🟠', gated: '🟡', claimed: '🔵', open: '⚪', unknown: '⚫' }
const done = flatten(map.nodes).filter((x) => x.node.status === 'green').length
const tot = flatten(map.nodes).length
console.log(`\nMAP: ${map.project} — ${done}/${tot} nodes done (every key fulfilled)`)
for (const { node: n, depth } of flatten(map.nodes)) {
  const pad = '  ' + '  '.repeat(depth)
  console.log(`${pad}${dot[n.status] || '⚫'} ${n.id.padEnd(18 - depth * 2)} ${(n.status || '').padEnd(8)} ${n.statusNote || n.area}`)
}
