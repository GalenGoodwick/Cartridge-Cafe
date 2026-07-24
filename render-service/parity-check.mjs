#!/usr/bin/env node
// parity-check.mjs — asserts the headless eyes still match the browser engine.
// The prelude is a hand-maintained copy of shaders.ts SHADER_UTILITIES; until
// now the only thing keeping them equal was a comment. This makes drift LOUD:
//
//   node render-service/parity-check.mjs      (exit 1 on any divergence)
//
// Checks:
//  1. Function SET equality: PRELUDE defines exactly the fns SHADER_UTILITIES does.
//  2. Dedup behavior: the mod-dedupe.mjs port strips duplicates the way the
//     browser does (prelude collision, cross-mod collision, comment-masking).
//  3. Every HEADLESS_STUBS fn is a known binding-dependent builtin — a stub
//     that shadows a REAL prelude fn would silently neuter it.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PRELUDE, HEADLESS_STUBS } from './prelude.mjs'
import { deduplicateModCode, funcNamesOf } from './mod-dedupe.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const shadersPath = join(here, '..', 'web', 'src', 'app', 'engine', 'shaders.ts')
const shadersTs = readFileSync(shadersPath, 'utf8')

let failures = 0
const fail = (msg) => { failures++; console.error('✗ ' + msg) }
const ok = (msg) => console.log('✓ ' + msg)

// ── 1. function-set equality ─────────────────────────────────────────────────
const utilDecl = shadersTs.match(/const SHADER_UTILITIES = (?:\/\* wgsl \*\/)?`/)
const utilStart = utilDecl ? shadersTs.indexOf(utilDecl[0]) : -1
const utilEnd = shadersTs.indexOf('\n`', utilStart)
if (utilStart < 0 || utilEnd < 0) {
  fail('could not locate SHADER_UTILITIES template literal in shaders.ts')
} else {
  const utilities = shadersTs.slice(utilStart + utilDecl[0].length, utilEnd)
  const browserFns = funcNamesOf(utilities)
  const preludeFns = funcNamesOf(PRELUDE)
  const missing = [...browserFns].filter(f => !preludeFns.has(f))
  const extra = [...preludeFns].filter(f => !browserFns.has(f))
  if (missing.length) fail(`prelude MISSING browser utilities (probes will throw 'no def'): ${missing.join(', ')}`)
  if (extra.length) fail(`prelude has fns the browser lacks (worlds pass probe, fail live): ${extra.join(', ')}`)
  if (!missing.length && !extra.length) ok(`prelude ↔ SHADER_UTILITIES: ${browserFns.size} functions, sets identical`)
}

// ── 2. dedup behavioral fixtures ────────────────────────────────────────────
{
  // prelude collision: a module redeclaring fbm must be stripped
  const seen = funcNamesOf(PRELUDE + HEADLESS_STUBS)
  const stripped = deduplicateModCode('fn fbm(p: vec2f, o: i32) -> f32 { return 0.0; }\nfn my_own(p: f32) -> f32 { return p; }', seen)
  if (stripped.includes('fn fbm(')) fail('dedup: prelude-colliding fn NOT stripped')
  else if (!stripped.includes('fn my_own(')) fail('dedup: innocent fn wrongly stripped')
  else ok('dedup: prelude collision stripped, innocent fn kept')

  // cross-mod collision: second definition of the same fn is stripped
  const seen2 = new Set()
  const a = deduplicateModCode('fn mod_helper(x: f32) -> f32 { return x; }', seen2)
  const b = deduplicateModCode('fn mod_helper(x: f32) -> f32 { return x * 2.0; }\nfn mod_other() -> f32 { return 1.0; }', seen2)
  if (!a.includes('mod_helper')) fail('dedup: first definition wrongly stripped')
  else if (b.includes('fn mod_helper(')) fail('dedup: cross-mod duplicate NOT stripped')
  else if (!b.includes('mod_other')) fail('dedup: survivor after duplicate wrongly stripped')
  else ok('dedup: cross-mod duplicate stripped')

  // comment masking: a fn name in a doc comment must not claim the name
  // (the WORLD3 bug — a header documenting `fn w3_map` killed the real definition)
  const seen3 = new Set()
  const c = deduplicateModCode('// contract: fn real_fn(p: vec3f) -> f32 is provided below\nfn real_fn(p: vec3f) -> f32 { return 0.0; }', seen3)
  if (!c.includes('fn real_fn(p: vec3f) -> f32 {')) fail('dedup: doc-comment mention claimed the name (WORLD3 bug regressed)')
  else ok('dedup: comment-masked scan — doc mentions do not claim names')
}

// ── 3. stubs only cover binding-dependent builtins ──────────────────────────
{
  const ALLOWED_STUBS = new Set(['prevHere', 'prevAt', 'pix', 'sampleTarget', 'sampleTargetUV', 'cafeIcon'])
  const stubFns = funcNamesOf(HEADLESS_STUBS)
  const preludeFns = funcNamesOf(PRELUDE)
  const rogue = [...stubFns].filter(f => !ALLOWED_STUBS.has(f))
  const shadowing = [...stubFns].filter(f => preludeFns.has(f))
  if (rogue.length) fail(`HEADLESS_STUBS has unexpected stubs (pop/popCount are REAL now — a new stub needs review): ${rogue.join(', ')}`)
  else ok(`stubs cover exactly the binding-dependent builtins: ${[...stubFns].join(', ')}`)
  if (shadowing.length) fail(`stub SHADOWS a real prelude fn: ${shadowing.join(', ')}`)
}

console.log(failures ? `\n${failures} parity failure(s)` : '\nheadless eyes match the browser engine')
process.exit(failures ? 1 : 0)
