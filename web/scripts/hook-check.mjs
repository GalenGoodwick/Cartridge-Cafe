#!/usr/bin/env node
// hook-check — run a world's game-logic tests locally. Fetches the world's live
// step hook (or reads a snapshot), loads a per-world SPEC of assertions, and
// runs them against the mock-sim harness — catching rule bugs (a broken gate, a
// dupe) before a playtest. The harness is generic; the spec is per-world.
//
//   node scripts/hook-check.mjs --slug tideglass --spec scripts/specs/tideglass.hook.mjs
//   node scripts/hook-check.mjs --snapshot ./snap.json --hookId tideglass_core --spec ./my.hook.mjs
//
// A spec is an ES module with a default export: (harness) => void, where harness
// = { runWorld, makeAsserter, hookCode }. It should print its own pass/fail and
// call process.exit via the asserter result (this runner exits on the total).
import { readFileSync } from 'fs'
import { pathToFileURL } from 'url'
import { resolve } from 'path'
import * as harness from './lib/hook-harness.mjs'

const ORIGIN = process.env.CAFE_ORIGIN || 'https://cartridge.cafe'
const arg = n => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : null }
const fail = m => { console.error('\x1b[31m' + m + '\x1b[0m'); process.exit(2) }

const specPath = arg('spec'); if (!specPath) fail('need --spec <file>')

const snap = await (async () => {
  const sp = arg('snapshot')
  if (sp) { const j = JSON.parse(readFileSync(sp, 'utf8')); return j.snapshot ?? j }
  const slug = arg('slug'); if (!slug) fail('need --slug or --snapshot')
  const r = await fetch(`${ORIGIN}/api/spaces/${encodeURIComponent(slug)}/snapshot`)
  if (!r.ok) fail(`could not fetch "${slug}" (${r.status})`)
  return (await r.json()).snapshot
})()

const hookId = arg('hookId')
const hooks = snap.stepHooks || []
const hook = hookId ? hooks.find(h => h.id === hookId) : hooks[0]
if (!hook?.code) fail(hookId ? `no hook "${hookId}" in the snapshot` : 'no step hook in the snapshot')

const spec = (await import(pathToFileURL(resolve(specPath)).href)).default
if (typeof spec !== 'function') fail('spec must default-export a function (harness) => void')

console.log(`running ${specPath} against ${hook.id} (${hook.code.length} chars)`)
const asserter = harness.makeAsserter()
spec({ ...harness, hookCode: hook.code, asserter })
console.log(`\n${asserter.result.pass} passed, ${asserter.result.fail} failed`)
process.exit(asserter.result.fail ? 1 : 0)
