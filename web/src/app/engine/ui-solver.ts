/**
 * THE UI SOLVER — one layout authority for screen-space world UI.
 *
 * Born Aug 9 2026 from the pentarch UI saga (rounds 15-23 of hand-aligning
 * three layers): shader chrome, DOM panels, and hand-computed hit rects each
 * held their own copy of the same geometry, aligned only by matched
 * coordinates — every edit broke an alignment somewhere else. Veilfire never
 * had the disease because it has ONE render authority (the megashader).
 *
 * The cure, by construction: worlds declare ONE retained UI TREE
 * (worldData.ui), this solver resolves it to ONE rect table, and EVERY
 * consumer reads that table:
 *   - the renderer's glass-box + screen-glyph passes (real engine pixels,
 *     no DOM — probes and recordings finally see the UI)
 *   - click routing (button hits → wd.__uiClick, the existing channel)
 *   - hooks + AI (worldData.__uiRects — the layout is READABLE data)
 *   - UI EDIT mode (drag/resize/collapse overrides re-enter via __uiOverrides)
 *
 * Why leaving DOM is possible now (the Round-19 objection dissolved): the
 * engine font is MONOSPACE — advance is exactly ADV·fontSize per glyph, so
 * text measurement is arithmetic and wrap/auto-height are exactly computable
 * here. The browser's one real advantage (text measurement) doesn't apply.
 *
 * UNITS. Everything is solved in DESIGN UNITS: the 512-grid of the resting
 * letterboxed world square (centered, side = min(W,H)), origin top-left,
 * y DOWN. The same space as worldData.__entities (sx,sy) and design-px
 * fontSize. Conversions:  screen px = unit × (side/512);
 * uv = unit/256 − 1 (y down, matching hud/uv convention — NOT the field
 * shader's y-up grid). UI never follows the grid camera (chrome law).
 *
 * PURE: no DOM, no GPU, no Date — deterministic, unit-testable, and safe to
 * run anywhere (client, worker, render-service).
 */

// ── the glyph metrics (MUST match renderer.ts glyph pass) ──────────────────
export const ADV = 0.62 // per-glyph advance, em
export const LINE = 1.15 // line height, em
export const GRID = 512 // design square

export interface GlassStyle {
  bg?: string // rgba() fill
  border?: string // border color
  radius?: number // corner radius, design units
  glow?: string // outer glow color ('' = none)
}

export interface UiNode {
  id?: string
  kind: 'panel' | 'col' | 'row' | 'text' | 'meter' | 'button' | 'spacer' | 'slot'
  hidden?: boolean
  // top-level panel placement
  anchor?: { x?: number; y?: number; gx?: number; gy?: number; entity?: string; below?: string; gap?: number; dx?: number; dy?: number }
  /** which POINT of the panel the anchor pins: tl tc tr cl c cr bl bc br (default c) */
  align?: 'tl' | 'tc' | 'tr' | 'cl' | 'c' | 'cr' | 'bl' | 'bc' | 'br'
  glass?: boolean | GlassStyle
  /** collapse/drag affordances for UI EDIT mode */
  collapsible?: boolean
  draggable?: boolean
  // sizing: design units, '<n>%' of the square, or 'auto'
  w?: number | string
  h?: number | string
  // flow
  dir?: 'row' | 'col'
  gap?: number
  pad?: number
  flex?: number
  // text / button
  text?: string
  fontSize?: number
  color?: string
  wrap?: boolean
  textAlign?: 'left' | 'center' | 'right'
  // meter
  value?: number // 0..1 fill
  label?: string
  hue?: string
  // button
  click?: string
  children?: UiNode[]
}

export interface UiTree {
  rev?: number
  theme?: GlassStyle
  root: UiNode[]
}

export interface Rect { x: number; y: number; w: number; h: number }
export interface SolvedBox extends Rect { id: string; style: Required<GlassStyle>; collapsed: boolean; hole?: Rect }
export interface SolvedRun { id: string; x: number; y: number; fs: number; color: string; text: string }
export interface SolvedMeter extends Rect { id: string; fill: number; hue: string; label: string; fs: number; color: string }
export interface SolvedHit extends Rect { id: string; action: string }

export interface UiOverride { dx?: number; dy?: number; w?: number; h?: number; collapsed?: boolean }

export interface SolveInput {
  ui: UiTree
  /** entity screen positions for anchor:{entity} — worldData.__entities convention: sx,sy in 0..512 grid */
  entities?: Array<{ id?: string | number; label?: string; sx: number; sy: number; r?: number }>
  overrides?: Record<string, UiOverride>
}

export interface SolvedUi {
  rev: number
  /** every identified node's resolved rect, design units, y-down */
  rects: Record<string, Rect & { hidden?: boolean }>
  boxes: SolvedBox[] // glass panels, paint order = array order
  runs: SolvedRun[] // one per text LINE (wrap pre-broken — renderer just emits quads)
  meters: SolvedMeter[]
  hits: SolvedHit[] // button hit rects + actions
  /** top-level panels with their edit affordances — UI EDIT mode's hit list */
  panels: Array<Rect & { id: string; draggable: boolean; collapsible: boolean; collapsed: boolean }>
}

const DEFAULT_GLASS: Required<GlassStyle> = {
  bg: 'rgba(6,12,20,0.72)',
  border: 'rgba(80,220,255,0.55)',
  radius: 6,
  glow: 'rgba(40,160,220,0.25)',
}

const DEF_FS = 12
const METER_H = 10

/** exact monospace text width in design units */
export function textW(text: string, fs: number): number {
  return text.length * ADV * fs
}

/** greedy word wrap against a width budget — returns the broken lines.
 *  Deterministic and exact because the font is monospace. A word longer than
 *  the budget hard-breaks (never overflows the rect). */
export function wrapText(text: string, fs: number, maxW: number): string[] {
  const perLine = Math.max(1, Math.floor(maxW / (ADV * fs) + 1e-6))
  const out: string[] = []
  for (const para of String(text).split('\n')) {
    if (!para.length) { out.push(''); continue }
    const words = para.split(' ')
    let line = ''
    for (let word of words) {
      while (word.length > perLine) { // hard-break oversized words
        if (line) { out.push(line); line = '' }
        out.push(word.slice(0, perLine))
        word = word.slice(perLine)
      }
      if (!line.length) line = word
      else if (line.length + 1 + word.length <= perLine) line += ' ' + word
      else { out.push(line); line = word }
    }
    out.push(line)
  }
  return out
}

/** size spec → design units against the square (percent strings supported) */
function units(v: number | string | undefined, fallback: number): number {
  if (v == null || v === 'auto') return fallback
  if (typeof v === 'number') return v
  const s = String(v).trim()
  if (s.endsWith('%')) return (parseFloat(s) / 100) * GRID
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : fallback
}

interface Ctx {
  out: SolvedUi
  theme: Required<GlassStyle>
  auto: number // id counter for anonymous nodes
}

/** natural (content) width of a leaf/flow node, unconstrained */
function naturalW(node: UiNode): number {
  const fs = node.fontSize ?? DEF_FS
  switch (node.kind) {
    case 'text':
    case 'button': {
      const t = String(node.text ?? '')
      const w = textW(t, fs)
      return node.kind === 'button' ? w + fs * 1.2 : w // buttons pad their label
    }
    case 'meter':
      return typeof node.w === 'number' ? node.w : 96
    case 'slot':
      return units(node.w, 48)
    case 'spacer':
      return 0
    case 'row': {
      const gap = node.gap ?? 0
      const kids = (node.children ?? []).filter((k) => !k.hidden)
      return kids.reduce((s, k) => s + naturalW(k), 0) + gap * Math.max(0, kids.length - 1)
    }
    case 'col':
    case 'panel': {
      const kids = (node.children ?? []).filter((k) => !k.hidden)
      return kids.reduce((m, k) => Math.max(m, naturalW(k)), 0) + (node.pad ?? 0) * 2
    }
  }
  return 0
}

/** lay a node into (x, y, availW); returns its actual {w, h}.
 *  Writes rects/runs/meters/hits into ctx as it goes. */
function layout(node: UiNode, x: number, y: number, availW: number, ctx: Ctx): { w: number; h: number } {
  if (node.hidden) return { w: 0, h: 0 }
  const id = node.id ?? `_u${ctx.auto++}`
  const fs = node.fontSize ?? DEF_FS
  const color = node.color ?? '#cfe8ff'

  // ANY node may declare click:'action' — its resolved rect becomes an engine
  // hit rect (button does this implicitly; rows/texts/meters opt in, which is
  // how list-row menus get engine-routed clicks with zero hand rect math)
  const sized = (w: number, h: number): { w: number; h: number } => {
    if (node.click && node.kind !== 'button') ctx.out.hits.push({ id, action: node.click, x, y, w, h })
    return { w, h }
  }

  switch (node.kind) {
    case 'spacer': {
      const h = units(node.h, 0)
      ctx.out.rects[id] = { x, y, w: availW, h }
      return sized(availW, h)
    }
    case 'slot': {
      // reserved rect the WORLD draws into (shader graphics anchored INTO the
      // ui — e.g. the portrait pentagon reads its seat from __uiRects)
      const w = Math.min(units(node.w, 48), availW)
      const h = units(node.h, w) // default square
      ctx.out.rects[id] = { x, y, w, h }
      return sized(w, h)
    }
    case 'text': {
      let lines: string[]
      if (node.wrap) lines = wrapText(String(node.text ?? ''), fs, availW)
      else {
        // non-wrap text CLIPS at the panel edge (the GPU has no overflow:hidden
        // — the solver is where clipping happens). '..' not '…': atlas is ASCII.
        const t = String(node.text ?? '')
        const maxCh = Math.max(1, Math.floor(availW / (ADV * fs) + 1e-6))
        lines = [t.length > maxCh ? t.slice(0, Math.max(1, maxCh - 2)) + '..' : t]
      }
      const lh = LINE * fs
      let w = 0
      lines.forEach((ln, i) => {
        const lw = textW(ln, fs)
        w = Math.max(w, lw)
        const lx = node.textAlign === 'center' ? x + (availW - lw) / 2 : node.textAlign === 'right' ? x + availW - lw : x
        ctx.out.runs.push({ id: lines.length > 1 ? `${id}:${i}` : id, x: lx, y: y + i * lh, fs, color, text: ln })
      })
      const h = lines.length * lh
      ctx.out.rects[id] = { x, y, w: node.wrap ? availW : Math.min(w, availW), h }
      return sized(node.wrap ? availW : Math.min(w, availW), h)
    }
    case 'meter': {
      const w = Math.min(units(node.w, availW), availW) // default: fill the row
      const h = units(node.h, METER_H)
      ctx.out.meters.push({ id, x, y, w, h, fill: Math.max(0, Math.min(1, node.value ?? 0)), hue: node.hue ?? '#4fd8ff', label: node.label ?? '', fs, color })
      // the label rides INSIDE the bar (pentarch vitals style), vertically centered
      if (node.label) {
        const lfs = Math.min(fs, h * 0.8)
        ctx.out.runs.push({ id: `${id}:l`, x: x + lfs * 0.4, y: y + (h - LINE * lfs) / 2, fs: lfs, color, text: String(node.label) })
      }
      ctx.out.rects[id] = { x, y, w, h }
      return sized(w, h)
    }
    case 'button': {
      const label = String(node.text ?? '')
      const padX = fs * 0.6, padY = fs * 0.35
      const w = Math.min(textW(label, fs) + padX * 2, availW)
      const h = LINE * fs + padY * 2
      ctx.out.runs.push({ id: `${id}:t`, x: x + padX, y: y + padY, fs, color, text: label })
      ctx.out.hits.push({ id, action: node.click ?? id, x, y, w, h })
      ctx.out.rects[id] = { x, y, w, h }
      return { w, h }
    }
    case 'row': {
      const gap = node.gap ?? 0
      const pad = node.pad ?? 0
      const inner = availW - pad * 2
      const kids = (node.children ?? []).filter((k) => !k.hidden)
      // pass 1: natural widths; leftover → flex children
      const nat = kids.map((k) => naturalW(k))
      const flexTotal = kids.reduce((s, k) => s + (k.flex ?? 0), 0)
      const used = nat.reduce((s, w, i) => s + (kids[i].flex ? 0 : w), 0) + gap * Math.max(0, kids.length - 1)
      const free = Math.max(0, inner - used)
      let cx = x + pad
      let maxH = 0
      const rowEnd = x + pad + inner
      kids.forEach((k, i) => {
        const remain = Math.max(0, rowEnd - cx)
        const kw = Math.min(k.flex ? (free * (k.flex ?? 0)) / (flexTotal || 1) : Math.min(nat[i], inner), remain)
        if (kw <= 0.5 && !k.flex) return                    // no room left — clip, never overflow
        const r = layout(k, cx, y + pad, kw, ctx)
        cx += (k.flex ? kw : r.w) + gap
        maxH = Math.max(maxH, r.h)
      })
      const h = maxH + pad * 2
      ctx.out.rects[id] = { x, y, w: availW, h }
      return sized(availW, h)
    }
    case 'col':
    case 'panel': {
      const gap = node.gap ?? 0
      const pad = node.pad ?? 0
      const inner = availW - pad * 2
      let cy = y + pad
      const kids = (node.children ?? []).filter((k) => !k.hidden)
      kids.forEach((k, i) => {
        const r = layout(k, x + pad, cy, inner, ctx)
        cy += r.h + (i < kids.length - 1 ? gap : 0)
      })
      const h = cy + pad - y
      ctx.out.rects[id] = { x, y, w: availW, h }
      return sized(availW, h)
    }
  }
  return { w: 0, h: 0 }
}

/** resolve a top-level panel's anchor to its top-left, given its size */
function anchorTL(node: UiNode, w: number, h: number, entities: SolveInput['entities'], rects?: SolvedUi['rects']): { x: number; y: number } {
  const a = node.anchor ?? {}
  let px = GRID / 2, py = GRID / 2
  if (a.below != null && rects && rects[a.below]) {
    // CHAINED PANEL: sit under an EARLIER panel's SOLVED rect (left edges
    // aligned) — two stacked panels can never collide however tall the first
    // grows. This is the containment law between siblings.
    const r = rects[a.below]
    return { x: r.x + (a.dx ?? 0), y: r.y + r.h + (a.gap ?? 4) + (a.dy ?? 0) }
  }
  if (a.entity != null && entities) {
    const e = entities.find((e) => String(e.id) === String(a.entity) || e.label === a.entity)
    if (e) { px = e.sx; py = e.sy }
  } else if (a.gx != null || a.gy != null) {
    px = a.gx ?? GRID / 2; py = a.gy ?? GRID / 2
  } else if (a.x != null || a.y != null) {
    // uv seat (−1..+1, y down) — pentarch's chrome convention
    px = ((a.x ?? 0) + 1) * (GRID / 2); py = ((a.y ?? 0) + 1) * (GRID / 2)
  }
  px += a.dx ?? 0; py += a.dy ?? 0
  const al = node.align ?? 'c'
  const ax = al[1] === 'l' || al === 'cl' ? 0 : al[1] === 'r' || al === 'cr' ? 1 : 0.5
  const ay = al[0] === 't' ? 0 : al[0] === 'b' ? 1 : 0.5
  return { x: px - w * ax, y: py - h * ay }
}

/** THE SOLVE — worldData.ui (+ overrides + entity anchors) → the rect table */
export function solveUi(input: SolveInput): SolvedUi {
  const { ui, entities, overrides } = input
  const out: SolvedUi = { rev: ui.rev ?? 0, rects: {}, boxes: [], runs: [], meters: [], hits: [], panels: [] }
  const theme: Required<GlassStyle> = { ...DEFAULT_GLASS, ...(ui.theme ?? {}) }
  const ctx: Ctx = { out, theme, auto: 0 }

  for (const panel of ui.root ?? []) {
    if (!panel || panel.hidden) continue
    const id = panel.id ?? `_p${ctx.auto++}`
    const ov = overrides?.[id] ?? {}
    const collapsed = ov.collapsed === true

    // width: override > declared > natural content width
    const w = ov.w ?? (panel.w != null && panel.w !== 'auto' ? units(panel.w, 120) : Math.max(24, naturalW(panel)))

    // COLLAPSE: only the first child (the header) lays out
    const body: UiNode = collapsed
      ? { ...panel, id, children: (panel.children ?? []).slice(0, 1) }
      : { ...panel, id }

    // measure at origin into a scratch context (anchor needs the height first)
    const scratch: Ctx = { out: { rev: 0, rects: {}, boxes: [], runs: [], meters: [], hits: [], panels: [] }, theme, auto: ctx.auto }
    const size = layout(body, 0, 0, w, scratch)
    const h = ov.h ?? (panel.h != null && panel.h !== 'auto' ? units(panel.h, size.h) : size.h)

    const tl = anchorTL(panel, w, h, entities, out.rects)
    const x = tl.x + (ov.dx ?? 0)
    const y = tl.y + (ov.dy ?? 0)

    // glass box under the content
    let boxRef: SolvedBox | null = null
    if (panel.glass !== false) {
      const style: Required<GlassStyle> = typeof panel.glass === 'object' ? { ...theme, ...panel.glass } : theme
      boxRef = { id, x, y, w, h, style, collapsed }
      out.boxes.push(boxRef)
    }
    // real layout at the anchored position
    layout(body, x, y, w, ctx)
    // slot WINDOW: the panel's first slot punches a hole in the glass so the
    // WORLD's own graphics (a shader portrait seated via __uiRects) show
    // through undimmed — graphics anchored INTO the ui, never under it
    if (boxRef && !collapsed) {
      const findSlot = (n: UiNode): string | null => {
        if (n.kind === 'slot') return n.id ?? null
        for (const c of n.children ?? []) { const s = findSlot(c); if (s) return s }
        return null
      }
      const sid = findSlot(body)
      const sr = sid ? out.rects[sid] : null
      if (sr) boxRef.hole = { x: sr.x, y: sr.y, w: sr.w, h: sr.h }
    }
    // panel rect wins over the inner col rect (same id) — record final size
    out.rects[id] = { x, y, w, h }
    out.panels.push({ id, x, y, w, h, draggable: panel.draggable !== false, collapsible: panel.collapsible !== false, collapsed })
  }
  return out
}

/** design units → uv (−1..+1, y DOWN — the hud/pop convention) */
export function unitToUv(x: number, y: number): [number, number] {
  return [x / (GRID / 2) - 1, y / (GRID / 2) - 1]
}

/** hit-test solved button rects; returns the action or null.
 *  (gx, gy) in design units — the engine converts a click's screen px via the
 *  resting square before calling. */
export function hitUi(solved: SolvedUi, gx: number, gy: number): string | null {
  // last-painted wins (later panels overlay earlier ones)
  for (let i = solved.hits.length - 1; i >= 0; i--) {
    const h = solved.hits[i]
    if (gx >= h.x && gx <= h.x + h.w && gy >= h.y && gy <= h.y + h.h) return h.action
  }
  return null
}
