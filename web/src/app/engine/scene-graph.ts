// scene-graph — `sim.defineScenes`, a first-class intra-world scene graph.
//
// A *scene* is a view/room/chapter INSIDE one running world (tideglass's shore,
// gate, record room) — NOT a cartridge. This owns the view integer, the
// crossfade, click→nav, and gated exits, so a world declares "where you can go
// and when" as DATA and the engine derives clicks + drawn chevrons + validation
// from that one declaration. See web/docs/scene-graph-primitive-spec.md.
//
// TWO EXECUTION HOMES, ONE SOURCE: hooks run either on the host (trusted worlds,
// FieldSimulation) or in the sealed Worker (world-sandbox.ts, a template STRING).
// `sceneDefine` is FULLY SELF-CONTAINED (no imports, all helpers nested) so its
// .toString() can be injected verbatim into the worker while the host imports it
// directly — the chapters/trigger mirror-drift trap, closed by construction.
// Progress (view/prev/fade/state) persists in the latch root (per-player on
// persist worlds); the graph itself (with `when` functions) is re-supplied every
// tick from the hook literal and never serialized.

export type SceneDir = 'right' | 'left' | 'up' | 'down'
export interface SceneExit {
  to: string
  zone: { x: number; y: number; r: number }
  when?: string | ((state: Record<string, number | boolean>) => boolean)
  chevron?: { dir: SceneDir }
  transition?: 'fade' | 'cut'
}
export interface SceneDef {
  exits?: SceneExit[]
  terminal?: boolean
  onEnter?: (state: Record<string, number | boolean>) => void
  onExit?: (state: Record<string, number | boolean>) => void
}
export interface SceneConfig {
  start: string
  fadeSeconds?: number
  transition?: 'fade' | 'cut'
  transitionSound?: { frequency: number; duration: number; volume: number; type?: string }
  state?: Record<string, number | boolean>
  scenes: Record<string, SceneDef>
}
export interface SceneRow { to: string; x: number; y: number; r: number; dir: number; enabled: boolean }
export interface SceneHandle {
  view: string
  viewIndex: number
  prev: string
  prevIndex: number
  fade: number
  state: Record<string, number | boolean>
  navClicked: boolean
  warnings: string[]
  go: (id: string, transition?: 'fade' | 'cut') => boolean
  in: (id: string) => boolean
  exits: () => SceneRow[]
}
export interface SceneSim {
  worldData: Record<string, unknown>
}

const DIR: Record<string, number> = { right: 0, left: 1, up: 2, down: 3 }

/** THE shared runtime. Self-contained by law (see file header) — do not
 *  reference any module-scope binding except the plain constant inlined below. */
export function sceneDefine(
  sim: SceneSim,
  getRoot: () => Record<string, unknown>,
  config: SceneConfig,
  dt: number,
): SceneHandle {
  const DIRMAP: Record<string, number> = { right: 0, left: 1, up: 2, down: 3 }
  const wd = sim.worldData
  const scenes = config.scenes || {}
  const keys = Object.keys(scenes)
  const start = config.start && scenes[config.start] ? config.start : keys[0]
  const fadeSeconds = typeof config.fadeSeconds === 'number' && config.fadeSeconds > 0 ? config.fadeSeconds : 0.5

  const root = getRoot()
  let S = root.__scenes as {
    view: string; prev: string; fade: number; state: Record<string, number | boolean>
    _down: boolean; _warned?: boolean; _warn?: string[]
  } | undefined
  if (!S || typeof S.view !== 'string' || !scenes[S.view]) {
    S = { view: start, prev: start, fade: 0, state: {}, _down: false }
    root.__scenes = S
  }
  // seed declared state defaults (idempotent — never clobbers live progress)
  const defaults = config.state || {}
  for (const k in defaults) if (!(k in S.state)) S.state[k] = defaults[k]

  // cheap one-time structural validation (undefined targets, off-canvas, dead
  // ends). Reachability/overlap live in validateSceneGraph (bake-time). Warnings
  // surface via the handle + wd.__sceneWarnings for INSPECT — never throw.
  if (!S._warned) {
    S._warned = true
    const w: string[] = []
    for (const id of keys) {
      const def = scenes[id] || {}
      const exits = def.exits || []
      for (const ex of exits) {
        if (!ex || typeof ex.to !== 'string' || !scenes[ex.to]) { w.push(`scene "${id}": exit → unknown scene "${ex && ex.to}"`); continue }
        const z = ex.zone
        if (!z || typeof z.x !== 'number' || typeof z.y !== 'number' || typeof z.r !== 'number') { w.push(`scene "${id}": exit → "${ex.to}" has no valid zone`); continue }
        if (z.x < 0 || z.x > 512 || z.y < 0 || z.y > 512) w.push(`scene "${id}": exit → "${ex.to}" zone center off-canvas (${z.x},${z.y})`)
      }
      if (exits.length === 0 && !def.terminal) w.push(`scene "${id}": no exits and not terminal — a dead end`)
    }
    S._warn = w
    if (w.length) wd.__sceneWarnings = w
  }

  const whenOk = (ex: SceneExit): boolean => {
    const w = ex.when
    if (w == null) return true
    if (typeof w === 'string') return !!S!.state[w]
    try { return !!w(S!.state) } catch { return false }
  }

  const fireEnterExit = (fromId: string, toId: string) => {
    try { scenes[fromId]?.onExit?.(S!.state) } catch { /* author code */ }
    try { scenes[toId]?.onEnter?.(S!.state) } catch { /* author code */ }
  }

  const go = (id: string, transition?: 'fade' | 'cut'): boolean => {
    if (id === S!.view || !scenes[id]) return false
    const from = S!.view
    S!.prev = from
    S!.view = id
    const t = transition || config.transition || 'fade'
    S!.fade = t === 'cut' ? 0 : 1
    if (S!.fade > 0 && config.transitionSound) {
      // APPEND (never overwrite) so a world's own per-tick sounds coexist; a
      // defineScenes world should push to wd.__play_sound, not assign it. No
      // object spread — ES2017 target would emit a tslib helper that breaks the
      // worker's .toString() injection of this function.
      if (!Array.isArray(wd.__play_sound)) wd.__play_sound = []
      const s = config.transitionSound
      ;(wd.__play_sound as Array<Record<string, unknown>>).push(
        { frequency: s.frequency, duration: s.duration, volume: s.volume, type: s.type || 'sine' })
    }
    fireEnterExit(from, id)
    return true
  }

  // ── clicks: NAV exits of the CURRENT scene, nearest-first (the overlap bug is
  // structurally gone — one hit wins). Only while settled (fade below midpoint),
  // so a click during a transition can't double-fire. navClicked lets the world
  // skip its own puzzle-click handling for a click the nav already ate.
  let navClicked = false
  const mx = wd.mouse_x as number | undefined
  const my = wd.mouse_y as number | undefined
  const down = !!wd.mouse_down
  const clickEdge = down && !S._down
  S._down = down
  if (clickEdge && typeof mx === 'number' && typeof my === 'number' && S.fade < 0.35) {
    const exits = (scenes[S.view]?.exits || []).filter(whenOk)
    let best: SceneExit | null = null
    let bestD = Infinity
    for (const ex of exits) {
      const dx = mx - ex.zone.x, dy = my - ex.zone.y
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d <= ex.zone.r && d < bestD) { bestD = d; best = ex }
    }
    if (best) { go(best.to, best.transition); navClicked = true }
  }

  // ── crossfade decay ──
  if (S.fade > 0) S.fade = Math.max(0, S.fade - dt / fadeSeconds)

  return {
    view: S.view,
    viewIndex: Math.max(0, keys.indexOf(S.view)),
    prev: S.prev,
    prevIndex: Math.max(0, keys.indexOf(S.prev)),
    fade: S.fade,
    state: S.state,
    navClicked,
    warnings: S._warn || [],
    go,
    in: (id: string) => S!.view === id && S!.fade < 0.35,
    exits: () => (scenes[S!.view]?.exits || []).map(ex => ({
      to: ex.to,
      x: ex.zone.x, y: ex.zone.y, r: ex.zone.r,
      dir: ex.chevron ? (DIRMAP[ex.chevron.dir] ?? 0) : -1,
      enabled: whenOk(ex),
    })),
  }
}

/** Thorough graph check for BAKE TIME (`node <cartridge>.mjs`) and dev. Static —
 *  cannot evaluate `when` predicates, so it walks ALL edges for reachability.
 *  Returns errors (real bugs) + warnings (probable), never throws. */
export function validateSceneGraph(config: SceneConfig): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const scenes = config.scenes || {}
  const keys = Object.keys(scenes)
  if (!keys.length) { errors.push('no scenes defined'); return { errors, warnings } }
  const start = config.start
  if (!start || !scenes[start]) errors.push(`start scene "${start}" is not defined`)

  for (const id of keys) {
    const def = scenes[id] || {}
    const exits = def.exits || []
    for (const ex of exits) {
      if (!ex || typeof ex.to !== 'string') { errors.push(`scene "${id}": exit with no target`); continue }
      if (!scenes[ex.to]) errors.push(`scene "${id}": exit → undefined scene "${ex.to}"`)
      const z = ex.zone
      if (!z || typeof z.x !== 'number' || typeof z.y !== 'number' || typeof z.r !== 'number') {
        errors.push(`scene "${id}": exit → "${ex.to}" has no valid zone`)
      } else if (z.x < 0 || z.x > 512 || z.y < 0 || z.y > 512) {
        warnings.push(`scene "${id}": exit → "${ex.to}" zone center off-canvas (${z.x},${z.y})`)
      }
    }
    // overlap: two zones whose centers are closer than 60% of the summed radii
    for (let i = 0; i < exits.length; i++) {
      for (let j = i + 1; j < exits.length; j++) {
        const a = exits[i]?.zone, b = exits[j]?.zone
        if (!a || !b) continue
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (d < (a.r + b.r) * 0.6) warnings.push(`scene "${id}": exits → "${exits[i].to}" and "${exits[j].to}" overlap (a click could hit both)`)
      }
    }
    if (exits.length === 0 && !def.terminal) warnings.push(`scene "${id}": no exits and not terminal — a dead end (mark terminal:true if intended)`)
  }

  // reachability from start over ALL edges (ignoring `when`)
  if (start && scenes[start]) {
    const seen = new Set<string>([start])
    const stack = [start]
    while (stack.length) {
      const cur = stack.pop()!
      for (const ex of scenes[cur]?.exits || []) {
        if (scenes[ex.to] && !seen.has(ex.to)) { seen.add(ex.to); stack.push(ex.to) }
      }
    }
    for (const id of keys) if (!seen.has(id)) warnings.push(`scene "${id}": unreachable from start "${start}"`)
  }
  return { errors, warnings }
}

/** WGSL helper a world opts into: draws the standard hover-glowing chevron at
 *  each ENABLED exit, read from a reserved uniform block the world packs from
 *  handle.exits(). Layout at `base`: uni(base) = exit count, then per exit 5
 *  floats [x, y, r, dir(0-3, <0 = no chevron), enabled(0/1)]. Because the SAME
 *  handle.exits() feeds both this draw and the click test, an invisible door
 *  (drawn-but-dead or dead-but-drawn) is impossible by construction. */
export const SCENE_CHEVRONS_WGSL = `
fn scene_chevron_at(uv: vec2f, mp: vec2f, c: vec2f, r: f32, dir: i32, t: f32) -> f32 {
  // local coords, y-down screen space (0..512 mapped by the caller to uv units)
  let d = length(uv - c);
  if (d > r) { return 0.0; }
  let p = (uv - c) / r;                       // -1..1 within the zone
  // orient so the chevron points along dir: 0 right,1 left,2 up,3 down
  var q = p;
  if (dir == 1) { q = vec2f(-p.x, p.y); }
  else if (dir == 2) { q = vec2f(p.y, -p.x); }
  else if (dir == 3) { q = vec2f(-p.y, p.x); }
  // a ">" wedge: two strokes meeting at the right
  let a = abs(q.y) - (0.55 - q.x * 0.55);
  let stroke = smoothstep(0.16, 0.0, abs(a)) * step(q.x, 0.45) * step(-0.55, q.x);
  let hov = smoothstep(r * 1.4, r * 0.6, length(mp - c));
  return stroke * (0.5 + 0.7 * hov);
}
fn scene_chevrons(base: i32, uv: vec2f, mp: vec2f, t: f32) -> vec3f {
  let n = i32(uni(base) + 0.5);
  var acc = 0.0;
  for (var i = 0; i < n; i = i + 1) {
    let o = base + 1 + i * 5;
    let enabled = uni(o + 4);
    let dir = i32(uni(o + 3) + 0.5);
    if (enabled < 0.5 || uni(o + 3) < 0.0) { continue; }
    let c = vec2f(uni(o), uni(o + 1));
    let r = uni(o + 2);
    acc = max(acc, scene_chevron_at(uv, mp, c, r, dir, t));
  }
  return vec3f(0.85, 0.92, 1.0) * acc;
}`

// keep a reference so the DIR constant isn't dead-code-eliminated for callers
export const SCENE_DIRS = DIR
