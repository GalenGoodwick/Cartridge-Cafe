// THE UI GRID — the dual-layer primitive (Galen's ruling, Aug 26: "whole
// viewport is infinite grid, culled to necessary Cafe and Game UI, regional
// node system, data structure in the snapshot — we design the whole site with
// the engine"). See DESIGN-ui-grid.md.
//
// This module is PURE: types + the per-window solver + the overlap gate. No
// rendering here — the compositor (rung 2) consumes solved regions; describe
// and the probes read the same structs. Mobile UI is a CALCULATED INSTANCE:
// the same declarations resolved against a narrower window; slip-in regions
// (console/nav) cost zero viewport at rest.

export type UiLayer = 'cafe' | 'game'

/** viewport-fraction bands (0..1) — the fit-law's anchors, or absolute px. */
export interface RegionAnchor {
  /** [from, to] as fractions of the window; mutually exclusive with px. */
  vx?: [number, number]
  vy?: [number, number]
  /** absolute px rect in window space (rare — prefer bands). */
  px?: { x: number; y: number; w: number; h: number }
}

export interface RegionWhen {
  mode?: Array<'view' | 'play' | 'design'>
  role?: Array<'owner' | 'member' | 'visitor' | 'anon'>
  worldState?: Array<'building' | 'done'>
  viewport?: { minW?: number; maxW?: number; minAspect?: number; maxAspect?: number }
}

export interface SlipSpec {
  edge: 'left' | 'right' | 'top' | 'bottom'
  /** named trigger — the shell flips it (e.g. 'console', 'nav'). */
  trigger: string
}

/** A REGION is a NODE on the infinite viewport grid V. */
export interface UiRegion {
  id: string
  layer: UiLayer
  anchor: RegionAnchor
  z?: number
  when?: RegionWhen
  /** slip-in: off `edge` at rest, slides in while its trigger is on. */
  slip?: SlipSpec
  /** same-layer nesting permit: children may overlap this region. */
  parent?: string
  /** element ids allowed to render inside (chrome ownership). */
  owns?: string[]
}

export interface UiGridDoc { regions: UiRegion[] }

// ─── MOVERS & PERCHERS (Galen, Aug 26: "define what is a mover and what is a
// percher") — the kind system of the grid:
//   PERCHER — roosts: occupies a fixed roost inside a space and does not
//     negotiate (cafe buttons, the grid lattice, game HUD elements).
//   MOVER — negotiable space: can relocate, reflow, donate area (the cafe
//     grid, the FieldEngine container, black-space cells, side bars, overlap
//     bands). Movers HOST perchers; the FieldEngine mover hosts its own
//     perchers (game UI) on the game-only layer — never mixed with cafe.
export type UiKind = 'mover' | 'percher'

export interface Rect { x: number; y: number; w: number; h: number }

/** CELL OUT THE BLACK SPACE (Galen): the window minus every occupied rect,
 *  partitioned into addressable rectangular cells — dead pixels become
 *  negotiable MOVER territory. Guillotine by occupied y-edges, free x-runs
 *  per band, then vertical merge of identical runs. */
export function cellOutFreeSpace(win: { w: number; h: number }, occupied: Rect[], minW = 40, minH = 40): Rect[] {
  const ys = new Set<number>([0, win.h])
  for (const r of occupied) { ys.add(Math.max(0, r.y)); ys.add(Math.min(win.h, r.y + r.h)) }
  const bands = [...ys].sort((a, b) => a - b)
  type Run = { x0: number; x1: number }
  const rows: Array<{ y0: number; y1: number; runs: Run[] }> = []
  for (let i = 0; i < bands.length - 1; i++) {
    const y0 = bands[i], y1 = bands[i + 1]
    if (y1 - y0 < 2) continue
    const blockers = occupied.filter(r => r.y < y1 && r.y + r.h > y0)
      .map(r => ({ x0: Math.max(0, r.x), x1: Math.min(win.w, r.x + r.w) }))
      .sort((a, b) => a.x0 - b.x0)
    const runs: Run[] = []
    let x = 0
    for (const b of blockers) { if (b.x0 > x) runs.push({ x0: x, x1: b.x0 }); x = Math.max(x, b.x1) }
    if (x < win.w) runs.push({ x0: x, x1: win.w })
    rows.push({ y0, y1, runs })
  }
  // vertical merge: adjacent rows with an IDENTICAL run fuse into one cell
  const cells: Rect[] = []
  const open = new Map<string, { x0: number; x1: number; y0: number; y1: number }>()
  for (const row of rows) {
    const seen = new Set<string>()
    for (const run of row.runs) {
      const k = run.x0 + ':' + run.x1
      seen.add(k)
      const o = open.get(k)
      if (o && o.y1 === row.y0) o.y1 = row.y1
      else { if (o) cells.push({ x: o.x0, y: o.y0, w: o.x1 - o.x0, h: o.y1 - o.y0 }); open.set(k, { ...run, y0: row.y0, y1: row.y1 }) }
    }
    for (const [k, o] of open) if (!seen.has(k)) { cells.push({ x: o.x0, y: o.y0, w: o.x1 - o.x0, h: o.y1 - o.y0 }); open.delete(k) }
  }
  for (const o of open.values()) cells.push({ x: o.x0, y: o.y0, w: o.x1 - o.x0, h: o.y1 - o.y0 })
  return cells.filter(c => c.w >= minW && c.h >= minH)
}

/** THE SENSE of a cell — what belongs in this shape of space at this position. */
export type CellSense = 'topbar' | 'bottombar' | 'left-rail' | 'right-rail' | 'corner-badge' | 'stage-extension'

export function classifySense(c: Rect, win: { w: number; h: number }): CellSense {
  const wide = c.w > win.w * 0.5, short = c.h < win.h * 0.16, tall = c.h > win.h * 0.5
  const atTop = c.y < win.h * 0.1, atBottom = c.y + c.h > win.h * 0.9
  const atLeft = c.x < win.w * 0.05, atRight = c.x + c.w > win.w * 0.95
  if (wide && short && atTop) return 'topbar'
  if (wide && short && atBottom) return 'bottombar'
  if (tall && atLeft) return 'left-rail'
  if (tall && atRight) return 'right-rail'
  if (c.w < 180 && c.h < 180) return 'corner-badge'
  return 'stage-extension'   // big open space — the game MOVER may grow here
}

/** Which PERCHERS can move into which cells (fit with breathing room). */
export function fitPerchers(cells: Rect[], perchers: Array<{ label: string; w: number; h: number }>, pad = 8) {
  return cells.map(c => ({
    cell: c,
    sense: undefined as CellSense | undefined,   // caller stamps
    fits: perchers.filter(p => p.w + pad * 2 <= c.w && p.h + pad * 2 <= c.h).map(p => p.label),
  }))
}

/** The current 3-axis + window state a solve runs against. */
export interface UiGridState {
  mode: 'view' | 'play' | 'design'
  role: 'owner' | 'member' | 'visitor' | 'anon'
  worldState: 'building' | 'done'
  window: { w: number; h: number }
  /** active slip triggers (e.g. {console: true}). */
  triggers?: Record<string, boolean>
}

export interface SolvedRegion {
  id: string
  layer: UiLayer
  z: number
  slip: boolean
  /** resolved window-space rect this frame (slips resolve at their IN position;
   *  culled/at-rest slips simply don't appear). */
  rect: { x: number; y: number; w: number; h: number }
}

const inRange = (v: number, lo?: number, hi?: number) =>
  (lo === undefined || v >= lo) && (hi === undefined || v <= hi)

function whenPasses(when: RegionWhen | undefined, s: UiGridState): boolean {
  if (!when) return true
  if (when.mode && !when.mode.includes(s.mode)) return false
  if (when.role && !when.role.includes(s.role)) return false
  if (when.worldState && !when.worldState.includes(s.worldState)) return false
  if (when.viewport) {
    const { minW, maxW, minAspect, maxAspect } = when.viewport
    const aspect = s.window.w / Math.max(1, s.window.h)
    if (!inRange(s.window.w, minW, maxW)) return false
    if (!inRange(aspect, minAspect, maxAspect)) return false
  }
  return true
}

function resolveAnchor(a: RegionAnchor, w: number, h: number) {
  if (a.px) return { ...a.px }
  const [vx0, vx1] = a.vx ?? [0, 1]
  const [vy0, vy1] = a.vy ?? [0, 1]
  return { x: Math.round(vx0 * w), y: Math.round(vy0 * h), w: Math.round((vx1 - vx0) * w), h: Math.round((vy1 - vy0) * h) }
}

/** THE SOLVER — one pass: cull by `when`, cull at-rest slips, resolve bands to
 *  window px. Deterministic; the same declarations ARE the mobile UI on a
 *  narrow window (Galen: "a calculated instance of pixels that turn on"). */
export function solveUiGrid(doc: UiGridDoc, s: UiGridState): SolvedRegion[] {
  const out: SolvedRegion[] = []
  for (const r of doc.regions ?? []) {
    if (!r?.id || !r.anchor) continue
    if (!whenPasses(r.when, s)) continue
    if (r.slip && !s.triggers?.[r.slip.trigger]) continue   // at rest — zero viewport
    out.push({ id: r.id, layer: r.layer === 'game' ? 'game' : 'cafe', z: r.z ?? 0, slip: !!r.slip, rect: resolveAnchor(r.anchor, s.window.w, s.window.h) })
  }
  return out.sort((a, b) => a.z - b.z)
}

export interface UiOverlap { a: string; b: string; ox: number; oy: number; area: number }

/** THE OVERLAP GATE — the projection instrument's math, native. Same-layer
 *  regions may not overlap unless parented; a non-empty return FAILS the gate
 *  (design rung ships only on overlaps === []). Cross-layer contact is legal
 *  (cafe composites over game by contract). */
export function uiGridOverlaps(doc: UiGridDoc, solved: SolvedRegion[]): UiOverlap[] {
  const parentOf = new Map<string, string>()
  for (const r of doc.regions ?? []) if (r.parent) parentOf.set(r.id, r.parent)
  const related = (a: string, b: string) => {
    for (let p = parentOf.get(a); p; p = parentOf.get(p)) if (p === b) return true
    for (let p = parentOf.get(b); p; p = parentOf.get(p)) if (p === a) return true
    return false
  }
  const out: UiOverlap[] = []
  for (let i = 0; i < solved.length; i++) for (let j = i + 1; j < solved.length; j++) {
    const A = solved[i], B = solved[j]
    if (A.layer !== B.layer) continue
    if (A.slip || B.slip) continue                     // slip-ins legally cover the base
    if (related(A.id, B.id)) continue
    const ox = Math.min(A.rect.x + A.rect.w, B.rect.x + B.rect.w) - Math.max(A.rect.x, B.rect.x)
    const oy = Math.min(A.rect.y + A.rect.h, B.rect.y + B.rect.h) - Math.max(A.rect.y, B.rect.y)
    if (ox > 2 && oy > 2) out.push({ a: A.id, b: B.id, ox, oy, area: ox * oy })
  }
  return out.sort((x, y) => y.area - x.area)
}

/** Convenience: solve + gate in one breath (what describe/probes report). */
export function uiGridReport(doc: UiGridDoc, s: UiGridState) {
  const solved = solveUiGrid(doc, s)
  return { solved, overlaps: uiGridOverlaps(doc, solved) }
}
