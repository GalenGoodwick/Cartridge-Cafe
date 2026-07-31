#!/usr/bin/env node
// wgsl-check — validate a world's WGSL LOCALLY with naga (the real validator the
// browser's WebGPU stack uses), before any deploy. Reassembles the world's whole
// uber-shader — every module + visual, with optional local edits overlaid — on
// the engine's real helper library, and runs naga. Catches the entire compile
// class (reserved words, undefined fns, cross-module gaps, type/brace faults)
// offline in ~1s, instead of only at render_probe time.
//
//   node scripts/wgsl-check.mjs --slug tideglass
//   node scripts/wgsl-check.mjs --snapshot ./snap.json --override ./my-modules
//   node scripts/wgsl-check.mjs --module ./out-tg_kiln.wgsl --slug tideglass
//
// --slug     fetch the live snapshot from cartridge.cafe
// --snapshot read a snapshot JSON from disk instead
// --override a dir of <moduleName>.wgsl files that replace snapshot modules
// --module   one extra/override module file (name taken from its define target)
// Requires naga:  cargo install naga-cli   (binary at ~/.cargo/bin/naga)
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join, basename } from 'path'
import { tmpdir } from 'os'

const HERE = dirname(fileURLToPath(import.meta.url))
const SHADERS_TS = join(HERE, '..', 'src', 'app', 'engine', 'shaders.ts')
const ORIGIN = process.env.CAFE_ORIGIN || 'https://cartridge.cafe'
const NAGA = existsSync(join(process.env.HOME || '', '.cargo/bin/naga')) ? join(process.env.HOME, '.cargo/bin/naga') : 'naga'

function arg(name) { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : null }

function fail(msg) { console.error('\x1b[31m' + msg + '\x1b[0m'); process.exit(2) }
try { execFileSync(NAGA, ['--version'], { stdio: 'pipe' }) } catch { fail('naga not found — install it:  cargo install naga-cli') }

// ── the engine's real WGSL helper library (sdBox/sdStar/fbm/rot2/…) ──
const shSrc = readFileSync(SHADERS_TS, 'utf8')
const uStart = shSrc.indexOf('const SHADER_UTILITIES')
const uB1 = shSrc.indexOf('`', uStart)
const UTILS = uStart >= 0 ? shSrc.slice(uB1 + 1, shSrc.indexOf('`', uB1 + 1)) : ''
// engine-provided fns the modules call (stubbed — only signatures matter here)
const PRELUDE = UTILS + `
fn uni(i: i32) -> f32 { return 0.0; }
fn uni4(i: i32) -> vec4f { return vec4f(0.0); }
fn pop(i: i32) -> vec4f { return vec4f(0.0); }
fn popCount() -> i32 { return 0; }
fn pix() -> vec2f { return vec2f(0.0); }
fn prevHere() -> vec4f { return vec4f(0.0); }
fn prevAt(o: vec2f) -> vec4f { return vec4f(0.0); }
fn feedback(c: vec2f) -> vec4f { return vec4f(0.0); }
fn feedbackUV(c: vec2f) -> vec2f { return vec2f(0.0); }
fn sampleTarget(id: u32, p: vec2f) -> vec4f { return vec4f(0.0); }
fn sampleTargetUV(id: u32, uv: vec2f) -> vec4f { return vec4f(0.0); }
`

// ── load the snapshot (by slug or from disk) ──
const snap = await (async () => {
  const sp = arg('snapshot')
  if (sp) return JSON.parse(readFileSync(sp, 'utf8')).snapshot ?? JSON.parse(readFileSync(sp, 'utf8'))
  const slug = arg('slug')
  if (!slug) fail('need --slug <slug> or --snapshot <file>')
  const r = await fetch(`${ORIGIN}/api/spaces/${encodeURIComponent(slug)}/snapshot`)
  if (!r.ok) fail(`could not fetch snapshot for "${slug}" (${r.status})`)
  return (await r.json()).snapshot
})()

// ── overlay local overrides ──
const overrides = new Map()
const odir = arg('override')
if (odir) for (const f of readdirSync(odir).filter(f => f.endsWith('.wgsl'))) overrides.set(basename(f, '.wgsl'), readFileSync(join(odir, f), 'utf8'))
const mfile = arg('module')
let extraModule = null
if (mfile) { extraModule = { name: basename(mfile, '.wgsl'), wgsl: readFileSync(mfile, 'utf8') } }

// ── assemble: prelude + every module (overridden) + every visual + an entry ──
const pieces = [{ name: 'prelude', src: PRELUDE }]
const modNames = new Set()
for (const m of snap.modules || []) {
  modNames.add(m.name)
  const local = overrides.get(m.name)
  pieces.push({ name: local ? m.name + ' (LOCAL)' : m.name, src: local ?? m.wgsl })
}
// overrides / extra module not present in the snapshot
for (const [name, src] of overrides) if (!modNames.has(name)) pieces.push({ name: name + ' (LOCAL)', src })
if (extraModule && !modNames.has(extraModule.name) && !overrides.has(extraModule.name)) pieces.push({ name: extraModule.name + ' (LOCAL)', src: extraModule.wgsl })

const visuals = (snap.visualTypes || []).filter(v => /fn\s+visual_\w+\s*\(/.test(v.wgsl || ''))
for (const v of visuals) pieces.push({ name: 'visual:' + v.name, src: v.wgsl })
// one entry per visual so every visual + its module deps must resolve
const calls = visuals.map(v => `acc = acc + visual_${v.name}(vec2f(0.0), 0.0, vec4f(0.0), 0.0, vec4f(0.0), vec4f(0.0));`).join('\n  ')
pieces.push({ name: 'entry', src: `@fragment fn fs_check(@builtin(position) fc: vec4f) -> @location(0) vec4f {\n  var acc = vec4f(0.0);\n  ${calls}\n  return acc;\n}` })

let full = ''; const lineMap = []
for (const pc of pieces) { const ls = pc.src.split('\n'); for (const l of ls) { full += l + '\n'; lineMap.push({ name: pc.name, line: lineMap.filter(x => x.name === pc.name).length + 1 }) } }
const tmp = join(tmpdir(), 'wgsl-check-' + process.pid + '.wgsl')
writeFileSync(tmp, full)

console.log(`assembled ${(snap.modules || []).length} modules + ${visuals.length} visual(s)` + (overrides.size ? ` · ${overrides.size} local override(s): ${[...overrides.keys()].join(', ')}` : '') + ` → ${full.split('\n').length} lines`)
try {
  execFileSync(NAGA, [tmp], { stdio: 'pipe' })
  console.log('\x1b[32m✓ WGSL VALID — the uber-shader compiles (naga clean)\x1b[0m')
  process.exit(0)
} catch (e) {
  const out = (e.stderr?.toString() || '') + (e.stdout?.toString() || '')
  console.log('\x1b[31m✗ WGSL ERROR:\x1b[0m')
  console.log(out.replace(/(?:wgsl|\S*\.wgsl):(\d+):(\d+)/g, (m, ln) => { const e2 = lineMap[parseInt(ln) - 1]; return e2 ? `${e2.name}:${e2.line}` : m }).trim().split('\n').slice(0, 40).join('\n'))
  process.exit(1)
}
