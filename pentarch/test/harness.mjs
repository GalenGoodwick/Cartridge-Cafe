// harness.mjs — the shared test driver every scene's *.test.mjs stands on.
// Ported from backlog/tests/yard-sim.mjs (Deno/-/tmp) to Node + the assembler:
// instead of reading a hook string off /tmp, we BUILD it via `assembleHook()` and
// wrap it exactly the way the engine does — `new Function('sim','dt', hook)`. A
// test scripts the same clicks the playtest made, ticks the frame, and watches the
// real worldData mutate. Green here is DERIVED from running the assembled hook, not
// declared. CONTRACT §7: no Deno, no /tmp.
//
// Exports (the frozen surface — change ⇒ swarm_heal):
//   uvpx(ux, uy)          → [px,py] : a uv point in the v9 512-square (px/256 - 1).
//   freshSim(seed?)       → { wd, sim, tick, run, hook, fn } : an ISOLATED world
//                           driven by its own bound copy of the assembled hook.
//   tick(mx, my, down)    → wd     : drive one frame of a DEFAULT shared world
//                           (the yard-sim.mjs module-level shape), setting the
//                           pointer then running the hook.
import { assembleHook } from '../build.mjs'

// Build the hook ONCE at import (assembleHook is async — dynamic scene imports —
// so this module uses top-level await). Every freshSim binds its own Function so
// worlds never share the closure's mutable engine state.
const hook = await assembleHook()

// pixel coords for a uv point on the v9 512-square canvas. Inverse of the frozen
// `px/256 - 1` mapping: uv 0 → 256 (centre), uv +1 → 512, uv -1 → 0. This is the
// coordinate space every yard-* script clicks in (see backlog/tests/yard-sim.mjs).
export function uvpx(ux, uy) {
  return [(ux + 1) * 256, (uy + 1) * 256]
}

// a fresh, ISOLATED fake sim: worldData + the four members a module may read
// (edge = rising-edge tracker; trigger/getFieldByName = engine stubs; rand). Each
// call gets its own hook Function so two worlds never interfere. `seed` pre-fills
// worldData (e.g. { __scene:'designer', __D:{…} }).
export function freshSim(seed = {}) {
  const wd = Object.assign({}, seed)
  const edges = {}
  const sim = {
    worldData: wd,
    // true only on the RISING edge of `c` for this id (a discrete tap fires once).
    edge(id, c) { const was = !!edges[id]; edges[id] = !!c; return !!c && !was },
    trigger() {},
    getFieldByName() { return null },
    rand: Math.random,
  }
  const fn = new Function('sim', 'dt', hook)   // throws if import/export leaked
  // run one frame. `run(dt)` advances without touching the pointer; `tick` sets
  // the pointer first (mouse_* AND input.pointer — the two channels PRELUDE reads).
  const run = (dt = 1 / 30) => { fn(sim, dt); return wd }
  const tick = (mx, my, down, dt = 1 / 30) => {
    if (mx !== undefined) {
      wd.mouse_x = mx; wd.mouse_y = my; wd.mouse_down = !!down
      wd.input = { pointer: { x: mx, y: my, down: !!down } }
    }
    return run(dt)
  }
  return { wd, sim, tick, run, hook, fn }
}

// A DEFAULT shared world, so `tick` matches yard-sim.mjs's module-level shape
// (`tick(...uvpx(x,y), down)`). Tests wanting isolation call freshSim() instead.
const _default = freshSim()
export const wd = _default.wd
export const sim = _default.sim
export const tick = _default.tick
export const run = _default.run
