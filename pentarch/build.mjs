// build — the PENTARCH ASSEMBLER. Composes the tested modules into ONE hook
// string the engine runs via `new Function('sim','dt', HOOK)`, and the ONE
// visual WGSL the engine defines. It owns no gameplay: every mechanic lives in a
// module (mod-*.mjs) or a foundation (penta-core/penta-holes/parts/chrome/shader);
// build just INLINES the foundations and WIRES the scene switch (CONTRACT §1/§2/§6).
//
//   assembleHook()   → string:  PRELUDE (inlined geometry + parts + chrome +
//                     the §2 runtime helpers) + DISPATCH (scene switch over each
//                     mod-*.mjs `SRC`) + POSTLUDE (flush POP → gpuPopulation +
//                     gpuUniforms). Missing modules contribute '' — a scene
//                     degrades, never throws.
//   assembleVisual() → string:  shader.mjs's visual_pentarch (which already pastes
//                     in CHROME_WGSL), the whole dist/visual.wgsl.
//   main()           → writes dist/, runs `node --test`, offline-compiles the
//                     shader; `--push` (never default, ONLY on Galen's word) POSTs
//                     define_visual + add_step_hook to the bridge.
//
// The clobber law: build owns ONLY this file. Foundations stay the single tested
// source of truth — build reads their TEXT (geometry/parts) or their exported
// STRING (chrome/shader) and pastes it in; it never re-implements them.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CHROME_PRELUDE } from './chrome.mjs'
import { visualSource } from './shader.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const DIST = join(HERE, 'dist')
const TESTDIR = join(HERE, 'test')

// The scenes, in DISPATCH order (CONTRACT §1). Each maps to its mod-*.mjs `SRC`.
// `menu` is the `else` fall-through. A module not yet built ⇒ '' (scene degrades).
const SCENES = ['designer', 'finder', 'lobby', 'battle', 'debrief', 'menu']
const MOD = {
  designer: './mod-designer.mjs',
  finder: './mod-finder.mjs',
  lobby: './mod-lobby.mjs',
  battle: './mod-battle.mjs',
  debrief: './mod-debrief.mjs',
  menu: './mod-menu.mjs',
}

// ── inline a foundation .mjs as PRELUDE-ready statements ─────────────────────
// Strip its `import …` lines (deps are inlined siblings, in scope by name) and its
// `export ` keywords (so `const`/`function` land as locals). CONTRACT §1: this is
// how penta-core/penta-holes/parts stay the single tested source of truth while
// living inside the generated hook.
function inlineModule(file) {
  const src = readFileSync(join(HERE, file), 'utf8')
  return src
    .replace(/^[ \t]*import\b.*$/gm, '')            // drop import lines
    .replace(/^([ \t]*)export\s+/gm, '$1')          // strip the export keyword
}

// ── read a scene module's SRC (the hook fragment) ────────────────────────────
// A module exports `export const SRC = …`. If it isn't built yet (or exports no
// SRC), the scene contributes nothing — the assembled hook still runs.
async function sceneSRC(name) {
  try {
    const mod = await import(new URL(MOD[name], import.meta.url).href)
    return typeof mod.SRC === 'string' ? mod.SRC : ''
  } catch {
    return ''
  }
}

// ── the §2 runtime PRELUDE (build.mjs owns this; modules just call it) ────────
// Declared AFTER the inlined foundations so chrome's helpers (which reference the
// hoisted `pushEnt`/`wd`) resolve at call time. Nothing here executes a reference
// to `wd` before it is bound, so there is no TDZ hazard.
const RUNTIME = String.raw`
// ── §2 runtime: the platform every module stands on ──
const wd = (sim && sim.worldData) || (sim.worldData = {});
const PW = wd.__pw;
const SC = PW ? PW.scene : (wd.__scene || 'menu');
const IN_ROOM = Array.isArray(wd.players);
const MY_SEAT = (Array.isArray(wd.gpuUniforms) ? (wd.gpuUniforms[15] | 0) : 0);
const POP = [];
const _BTN = {};
function pushEnt(x, y, a, code) {
  POP.push(+x || 0, +y || 0, +a || 0, +code || 0);
  const c = Math.floor(code);
  if (c >= 300 && c < 320) _BTN[c - 300] = { cx: +x || 0, cy: +y || 0, hw: (code - c) || 0.085 };
}
// pixel → uv in the LETTERBOX SQUARE (side = min(w,h)), +y up, centred; reduces to
// the v9 px/256-1 mapping on a 512-square canvas. Preserves the scale; the y-flip
// matches the chrome/shader convention (+y up), the frozen coordinate space.
function toUV(px, py) {
  const W = (wd.width || wd.canvas_w || wd.screen_w || 512);
  const H = (wd.height || wd.canvas_h || wd.screen_h || 512);
  const side = Math.min(W, H) || 512;
  return { x: (px - W / 2) / (side / 2), y: -(py - H / 2) / (side / 2) };
}
// rect hit-test (uv) against the last button of this id a module drew via pushEnt.
function hitButton(id, ux, uy) {
  const b = _BTN[id];
  if (!b) return false;
  const hh = b.hw * 0.5;
  return ux >= b.cx - b.hw && ux <= b.cx + b.hw && uy >= b.cy - hh && uy <= b.cy + hh;
}
// rising-edge wrapper over sim.edge — a discrete tap fires once.
function edgeTap(id, cond) {
  return (sim && typeof sim.edge === 'function') ? sim.edge('pt:' + id, !!cond) : false;
}
// delta of a monotonic input counter since last tick (spawn/fire/split fairness).
function latch(name) {
  const src = IN_ROOM ? (wd.players[MY_SEAT] || {}) : wd;
  const cur = +src[name] || 0;
  wd.__latch = wd.__latch || {};
  const prev = wd.__latch[name] || 0;
  wd.__latch[name] = cur;
  return Math.max(0, cur - prev);
}
// one-shot sfx (arena consumes wd.__play_sound after broadcast).
function sound(s) { wd.__play_sound = s; }
// a fresh designer state (CONTRACT §3, wd.__D shape).
function freshDesign() { return { tree: [{ parent: -1, edge: -1, part: 1 }], sel: 0, flash: 0, flashKind: 'diamond', slot: 0 }; }
const D = wd.__D || (wd.__D = freshDesign());
// pointer resolved into letterbox uv (modules may also read raw wd.mouse_*).
const _ptr = (wd.input && wd.input.pointer) || {};
const _rawX = (typeof _ptr.x === 'number') ? _ptr.x : wd.mouse_x;
const _rawY = (typeof _ptr.y === 'number') ? _ptr.y : wd.mouse_y;
let PX = null, PY = null;
if (typeof _rawX === 'number' && typeof _rawY === 'number') { const _p = toUV(_rawX, _rawY); PX = _p.x; PY = _p.y; }
const DOWN = (!!_ptr.down) || (wd.mouse_down === true);
`

// ── the POSTLUDE: flush the entity pool + publish uniforms (§2) ───────────────
const POSTLUDE = String.raw`
// ── flush: modules pushed into POP; publish to the engine ──
wd.gpuPopulation = POP;
const _dt = (typeof dt === 'number' && dt > 0) ? Math.min(dt, 1 / 30) : 1 / 30;
wd.__t = (wd.__t || 0) + _dt;
const _u = (Array.isArray(wd.gpuUniforms) && wd.gpuUniforms.length >= 16) ? wd.gpuUniforms.slice() : new Array(16).fill(0);
for (let _i = 0; _i < 16; _i++) if (typeof _u[_i] !== 'number') _u[_i] = 0;
_u[0] = wd.__t;                                              // time
_u[7] = (typeof wd.__S === 'number' && wd.__S > 0) ? wd.__S : 0.06;   // world/tile scale
_u[8] = (PX == null ? 0 : PX);                              // pointer x (uv)
_u[9] = (PY == null ? 0 : PY);                              // pointer y (uv)
_u[10] = DOWN ? 1 : 0;                                      // pointer down
if (D && D.flash > 0) {                                     // placement flash (chrome reads uni 11/12)
  _u[11] = D.flash;
  const _FK = { diamond: 1, bay: 1, moon: 2, star: 3 };
  _u[12] = _FK[D.flashKind] || 1;
  D.flash = Math.max(0, D.flash - _dt * 2);
} else {
  _u[11] = 0;
}
_u[15] = MY_SEAT;                                           // seat (arena)
wd.gpuUniforms = _u;
`

/** assembleHook() — the full hook body string:
 *  PRELUDE (foundations + runtime) + DISPATCH (scene switch) + POSTLUDE.
 *  Wrapped in one try/catch so a module fault records `wd.__hookError` instead of
 *  crashing the engine tick. Async because scene modules are dynamically imported
 *  (a not-yet-built module simply resolves to an empty fragment). */
export async function assembleHook() {
  const GEOMETRY = inlineModule('penta-core.mjs') + '\n' + inlineModule('penta-holes.mjs')
  const PARTS = inlineModule('parts.mjs')

  const frag = {}
  for (const s of SCENES) frag[s] = await sceneSRC(s)

  const DISPATCH =
    "if (SC === 'designer') {\n" + frag.designer + "\n}" +
    " else if (SC === 'finder') {\n" + frag.finder + "\n}" +
    " else if (SC === 'lobby') {\n" + frag.lobby + "\n}" +
    " else if (SC === 'battle') {\n" + frag.battle + "\n}" +
    " else if (SC === 'debrief') {\n" + frag.debrief + "\n}" +
    " else {\n" + frag.menu + "\n}"

  return [
    "'use strict';",
    'try {',
    '// ═══ PRELUDE: inlined geometry (single tested source of truth) ═══',
    GEOMETRY,
    '// ═══ PRELUDE: inlined parts table ═══',
    PARTS,
    '// ═══ PRELUDE: inlined chrome (Istrolid UI primitives) ═══',
    CHROME_PRELUDE,
    '// ═══ PRELUDE: §2 runtime helpers ═══',
    RUNTIME,
    '// ═══ DISPATCH: the ONE scene switch ═══',
    DISPATCH,
    '// ═══ POSTLUDE: flush + uniforms ═══',
    POSTLUDE,
    '} catch (e) {',
    '  if (sim && sim.worldData) sim.worldData.__hookError = String((e && e.stack) || e);',
    '}',
  ].join('\n')
}

/** assembleVisual() — the dist/visual.wgsl: visual_pentarch + the chrome WGSL it
 *  already pastes in (shader.mjs owns the single copy). */
export function assembleVisual() {
  return visualSource()
}

// ── main(): write dist, gate on tests + offline shader compile, then (only with
// --push, only on Galen's word) push to the bridge. Default NEVER pushes. ───────
const SCENE_KEY = process.env.PENTARCH_KEY   // scene token from env, never hardcode (public repo)
const BRIDGE = 'https://cartridge.cafe/api/engine/bridge'

async function main() {
  const push = process.argv.includes('--push')
  const hook = await assembleHook()
  const visual = assembleVisual()

  mkdirSync(DIST, { recursive: true })
  writeFileSync(join(DIST, 'hook.js'), hook)
  writeFileSync(join(DIST, 'visual.wgsl'), visual)
  console.log('assembled → dist/hook.js (' + hook.length + ' b), dist/visual.wgsl (' + visual.length + ' b)')

  // syntax gate: the hook must construct as a Function body (no import/export leaked).
  try {
    new Function('sim', 'dt', hook)
  } catch (e) {
    console.error('HOOK is not a valid Function body:', e.message)
    process.exit(1)
  }

  // unit gate: every module + this assembler green.
  try {
    execFileSync('node', ['--test', join(TESTDIR, '*.test.mjs')], { stdio: 'inherit', cwd: REPO })
  } catch {
    console.error('unit tests failed')
    process.exit(1)
  }

  // shader gate: visual_pentarch must compile on a real GPU (pop/popCount stubbed).
  try {
    const stubs = join(DIST, '_stubs.wgsl')
    writeFileSync(stubs, 'fn pop(i: i32) -> vec4f { return vec4f(0.0); }\nfn popCount() -> i32 { return 0; }\n')
    const out = execFileSync('deno', [
      'run', '--unstable-webgpu', '-A', join(REPO, 'tools/wgsl-render-check.mjs'),
      '--module', stubs, '--visual', join(DIST, 'visual.wgsl'),
      '--name', 'pentarch', '--out', join(DIST, '_shadercheck.png'),
    ], { cwd: REPO, encoding: 'utf8' })
    const j = JSON.parse(out.trim().split('\n').filter(Boolean).pop())
    if (!j.ok) { console.error('shader failed to compile:', JSON.stringify(j.errors || [])); process.exit(1) }
    console.log('shader compiles ok')
  } catch (e) {
    console.error('shader gate error (is deno installed?):', e.message)
    process.exit(1)
  }

  if (!push) {
    console.log('built (no push — pass --push, ONLY on Galen\'s word, to deploy)')
    return
  }

  // --push: define the visual + install the step hook on the stage world.
  async function send(commands, label) {
    const r = await fetch(BRIDGE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SCENE_KEY },
      body: JSON.stringify({ commands }),
    })
    console.log(label, r.status, JSON.stringify(await r.json()).slice(0, 120))
  }
  await send([{ type: 'define_visual', name: 'pentarch', wgsl: visual }], 'visual')
  await send([{ type: 'add_step_hook', hookId: 'pentarch', author: 'Claude (Fable · P)', description: 'PENTARCH — assembled hook (build.mjs)', code: hook }], 'hook')
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
