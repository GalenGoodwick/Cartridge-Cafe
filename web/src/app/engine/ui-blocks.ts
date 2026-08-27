// THE ONE ENGINE, rung 1 — the block → ui-node compiler (DESIGN-one-engine.md).
//
// Galen's ruling: the whole app renders as shader pixels through the ONE
// engine; /pages' block organization is the authoring methodology. This
// module is the missing joint: it compiles that block model (and the app
// shell's own chrome) into ui-solver nodes — the SAME declarative tree worlds
// use, solved by the same solver, drawn by the same glass/glyph passes,
// clicked through the same hit table. No DOM anywhere in the path.
//
// Solver facts this compiler is built against (ui-solver.ts / shaders.ts):
//   · GLASS BOXES exist only for TOP-LEVEL panels — so every visual pill here
//     is its own root panel, never a styled child.
//   · ANY node may declare click:'action' — a panel's own rect becomes the
//     hit, so a pill is one panel + one text child, no nested button needed.
//   · The glyph atlas is ASCII 32..90 (lowercase folds up) — labels here are
//     ASCII-only: '<' not '◂', 'MENU' not '☰', 'MAIN - LIVE' not 'main · live'.
//   · Monospace: width = chars × ADV × fontSize, exactly — placement below is
//     arithmetic, not measurement.
//
// Shell actions: shell chrome carries click ids under the `shell:` namespace.
// FieldEngine routes those to the HOST (window 'cafe:shell-ui' event) instead
// of worldData.__uiClick — the world never sees shell clicks.
//
// PURE: no DOM, no GPU — deterministic and unit-tested like the solver.

import { ADV, type UiNode } from './ui-solver'
import { solveUiGrid, uiGridOverlaps, type UiGridDoc, type UiGridState } from './ui-grid'
import type { Block } from '@/lib/page-types'

export const SHELL_NS = 'shell:'
export const shellAction = (a: string) => SHELL_NS + a

/** the shell's glass — quiet amber over near-black, distinct from the solver's
 *  default cyan glass so shell chrome and world UI read as different layers. */
export const SHELL_GLASS = { bg: 'rgba(10,8,6,0.82)', border: 'rgba(216,162,74,0.55)', radius: 5, glow: '' }
const SHELL_INK = 'rgba(236,235,242,0.92)'
const SHELL_MUT = 'rgba(160,157,172,0.9)'

const tw = (text: string, fs: number) => text.length * ADV * fs

// ─── /pages blocks → ui nodes ────────────────────────────────────────────────
// A page is an ordered column of blocks inside ONE glass panel (the region's
// content). Headings/text become glyph runs; buttons/links become click rects
// whose action carries the href (the host navigates on shell:href:*); shader
// blocks become identified slots a WGSL pass can adopt (`blk.<id>`).

const HEADING_FS: Record<1 | 2 | 3, number> = { 1: 26, 2: 19, 3: 15 }

export function blocksToUi(blocks: Block[]): UiNode[] {
  const out: UiNode[] = []
  for (const b of blocks) {
    switch (b.kind) {
      case 'heading':
        out.push({ id: `blk.${b.id}`, kind: 'text', text: b.text, fontSize: HEADING_FS[b.level], color: SHELL_INK, wrap: true })
        break
      case 'text':
        out.push({ id: `blk.${b.id}`, kind: 'text', text: b.text, fontSize: 12, color: SHELL_MUT, wrap: true })
        break
      case 'button':
        out.push({ id: `blk.${b.id}`, kind: 'row', pad: 6, click: shellAction(`href:${b.href}`), children: [
          { kind: 'text', text: `[ ${b.text.toUpperCase()} ]`, fontSize: 13, color: SHELL_INK },
        ] })
        break
      case 'link':
        out.push({ id: `blk.${b.id}`, kind: 'text', text: `> ${b.text}`, fontSize: 12, color: SHELL_INK, click: shellAction(`href:${b.href}`) })
        break
      case 'shader':
        // a reserved slot the WORLD/page shader draws into (the glass panel
        // punches a hole over the first slot — solver contract)
        out.push({ id: `blk.${b.id}`, kind: 'slot', w: '80%', h: b.aspect === 'tall' ? 300 : b.aspect === 'wide' ? 140 : 220 })
        break
    }
  }
  return out
}

/** a whole page doc as one anchored glass column (the page IS a region's content) */
export function pageToUi(blocks: Block[], opts?: { anchor?: UiNode['anchor']; w?: number | string }): UiNode[] {
  return [{
    id: 'page', kind: 'panel', gap: 10, pad: 14, w: opts?.w ?? '82%',
    anchor: opts?.anchor ?? { gx: 256, gy: 256 }, align: 'c',
    draggable: false, collapsible: false,
    glass: SHELL_GLASS,
    children: blocksToUi(blocks),
  }]
}

// ─── the app shell's top band, as engine UI ─────────────────────────────────
// The shader twin of the DOM WorldTopbar (chrome.topbar): three PERCHER pills
// pinned to the viewport's top corners — [<] [TITLE/SUB] at left, [MENU|DOCK]
// at right. vx/vy anchors reach the TRUE viewport corners at any aspect (the
// solver's responsive band layer), so phone and desktop are the same
// declaration — instance only changes which right pill exists, exactly the
// platform doc's culling model.

export interface ShellTopbarOpts {
  title: string
  sub?: string
  instance: 'phone' | 'desktop'
  /** offer DOCK on desktop (never on phone — docking leads to editing) */
  dockable?: boolean
  /** offer MENU on phone — pass true only once the host handles shell:menu
   *  (a button with no sheet behind it is a lie, not chrome) */
  menu?: boolean
}

const EDGE = 8       // gap from the viewport edge, design units
const PILL_PAD = 7   // panel pad inside each pill
const BACK_FS = 15
const NAME_FS = 13
const SUB_FS = 8
const TITLE_MAX_W = 190

export function shellTopbarUi(o: ShellTopbarOpts): UiNode[] {
  const title = (o.title || 'WORLD').toUpperCase()
  const sub = (o.sub ?? 'MAIN - LIVE').toUpperCase()

  // exact pill widths — the same arithmetic the solver will run (including
  // its 24-unit minimum panel width)
  const backW = Math.max(24, tw('<', BACK_FS) + PILL_PAD * 2)
  const titleW = Math.max(24, Math.min(Math.max(tw(title, NAME_FS), tw(sub, SUB_FS)) + PILL_PAD * 2, TITLE_MAX_W))

  const nodes: UiNode[] = [
    {
      id: 'shell.back', kind: 'panel', pad: PILL_PAD, glass: SHELL_GLASS,
      click: shellAction('back'), draggable: false, collapsible: false,
      anchor: { vx: 0, vy: 0, dx: EDGE, dy: EDGE }, align: 'tl',
      children: [{ id: 'shell.back.t', kind: 'text', text: '<', fontSize: BACK_FS, color: SHELL_INK }],
    },
    {
      id: 'shell.title', kind: 'panel', pad: PILL_PAD, gap: 2, w: titleW,
      glass: SHELL_GLASS, draggable: false, collapsible: false,
      anchor: { vx: 0, vy: 0, dx: EDGE + backW + 6, dy: EDGE }, align: 'tl',
      children: [
        { id: 'shell.title.name', kind: 'text', text: title, fontSize: NAME_FS, color: SHELL_INK },
        { id: 'shell.title.sub', kind: 'text', text: sub, fontSize: SUB_FS, color: SHELL_MUT },
      ],
    },
  ]
  const right = o.instance === 'phone'
    ? (o.menu ? { id: 'shell.menu', label: 'MENU', action: 'menu' } : null)
    : o.dockable
      ? { id: 'shell.dock', label: 'DOCK', action: 'dock' }
      : null
  if (right) {
    nodes.push({
      id: right.id, kind: 'panel', pad: PILL_PAD, glass: SHELL_GLASS,
      click: shellAction(right.action), draggable: false, collapsible: false,
      anchor: { vx: 1, vy: 0, dx: -EDGE, dy: EDGE }, align: 'tr',
      children: [{ id: `${right.id}.t`, kind: 'text', text: right.label, fontSize: 12, color: SHELL_INK }],
    })
  }
  return nodes
}

// ─── THE WORLD SHELL — every world's chrome as engine pixels (THE CONVERSION,
// Galen Aug 27: "any world birthing or existing worlds needs to show through
// the one new UI"). Composes the FULL band set the DOM chrome used to draw:
// topbar (back + title), the desktop action rail (PLAY / INSTRUCTIONS / FORK /
// EDIT), and the footer BUILDERBOX pill. Placement is DECLARED (anchors +
// aligns — the solver's arithmetic), never dragged. Actions ride the shell:
// namespace to the host; the host commands the engine back by NAME
// ('cafe:shell-cmd'), so the seam law holds in both directions.
//
// Phone instance (viewport-narrow): the rail collapses — PLAY joins the footer
// beside BUILDERBOX; INSTRUCTIONS/EDIT wait for the menu sheet (a button with
// no sheet behind it is a lie — the sheet is the next rung). FOLLOW/SHARE stay
// DOM this rung (session flows), still solver-placed.

export interface WorldChromeOpts {
  title: string
  sub?: string
  instance: 'phone' | 'desktop'
  isOwner: boolean
  isHub?: boolean
  live?: number                 // engine-count badge for the BuilderBox pill
  window: { w: number; h: number }   // real viewport px — the solve needs it
}

// ─── THE WORLD-CHROME BANDS (Galen, Aug 27: "movers and perchers... it isn't
// unifying"). THE KEYSTONE: the world's chrome is not hand-placed pills — it is
// BANDS (movers) solved by the REAL ui-grid layout brain, with buttons
// (perchers) roosting inside each solved band, emitted as ui-solver shader
// nodes. Same declaration /design/shell used; now shader-drawn. One doc:
// ui-grid solves the bars → perchers flow within → the engine draws them.
const CHROME_BANDS: UiGridDoc = {
  regions: [
    // TOP BAR — back + title roost here; full width, thin.
    { id: 'chrome.topbar', layer: 'cafe', anchor: { vx: [0, 1], vy: [0, 0.075] }, z: 60 },
    // SIDE BAR (rail) — the action stack; desktop only (a mover culled by the
    // when-clause on a phone, exactly like the shell proof).
    { id: 'chrome.rail', layer: 'cafe', anchor: { vx: [0.845, 1], vy: [0.1, 0.9] }, z: 50, when: { viewport: { minW: 700 } } },
    // BOTTOM BAR — BuilderBox (desktop) / the whole action row (phone).
    { id: 'chrome.bottombar', layer: 'cafe', anchor: { vx: [0, 1], vy: [0.925, 1] }, z: 55 },
  ],
}
const CHROME_INK = 'rgba(236,235,242,0.92)'
const CHROME_MUT = 'rgba(160,157,172,0.9)'
const PILL_H = 30   // approx solved pill height (pad + text) for centering in a band

type Percher = { id: string; label: string; action: string | null; fs: number; sub?: string }

/** THE COMPILER — one WorldDoc-of-bands → solved bands → roosted perchers →
 *  ui-solver shader nodes. Positions are viewport fractions (vx/vy, the same
 *  space ui-solver anchors in); sizes are design units. */
export function worldChromeUi(o: WorldChromeOpts): UiNode[] {
  const W = Math.max(1, o.window.w), H = Math.max(1, o.window.h)
  const scale = 512 / Math.min(W, H)          // window px → design units (short axis = 512)
  const dvw = W * scale, dvh = H * scale       // the design viewport
  const state: UiGridState = {
    mode: 'view', role: o.isOwner ? 'owner' : 'visitor', worldState: 'done',
    window: { w: W, h: H }, triggers: {},
  }
  const solved = solveUiGrid(CHROME_BANDS, state)
  if (process.env.NODE_ENV !== 'production') {
    const bad = uiGridOverlaps(CHROME_BANDS, solved)
    if (bad.length) console.warn('[world-chrome] bands overlap:', bad)
  }
  const bandOf = (id: string) => {
    const r = solved.find(s => s.id === id)?.rect
    return r ? { x: r.x * scale, y: r.y * scale, w: r.w * scale, h: r.h * scale } : null
  }

  const nodes: UiNode[] = []
  const EDGE = 8, PAD = 7, GAP = 6
  const pillW = (label: string, fs: number) => Math.max(30, label.length * ADV * fs + PAD * 2)
  const emit = (id: string, label: string, action: string | null, dx: number, dy: number, fs: number, w: number, sub?: string) => {
    const children: UiNode[] = [{ id: `${id}.t`, kind: 'text', text: label, fontSize: fs, color: CHROME_INK }]
    if (sub) children.push({ id: `${id}.s`, kind: 'text', text: sub, fontSize: 8, color: CHROME_MUT })
    const node: UiNode = {
      id, kind: 'panel', pad: PAD, gap: 2, w, glass: SHELL_GLASS, draggable: false, collapsible: false,
      anchor: { vx: dx / dvw, vy: dy / dvh }, align: 'tl', children,
    }
    if (action) node.click = shellAction(action)
    nodes.push(node)
  }

  const RFS = 11
  const railPerchers: Percher[] = o.isHub ? [] : [
    { id: 'shell.play', label: '# PLAY', action: 'play', fs: RFS },
    { id: 'shell.instructions', label: '? INSTRUCTIONS', action: 'instructions', fs: RFS },
    ...(!o.isOwner ? [{ id: 'shell.fork', label: '+ FORK WORLD', action: 'fork', fs: RFS }] : []),
    { id: 'shell.edit', label: '/ EDIT', action: 'edit', fs: RFS },
  ]
  const boxLabel = (short: boolean) => `= ${short ? 'BOX' : 'BUILDERBOX'}${o.live ? ` (${o.live})` : ''}`

  // ── TOP BAR — back + title roost at the start ──
  const tb = bandOf('chrome.topbar')
  if (tb) {
    const cy = tb.y + Math.max(2, (tb.h - PILL_H) / 2)
    let x = tb.x + EDGE
    const bw = pillW('<', 15); emit('shell.back', '<', 'back', x, cy, 15, bw); x += bw + GAP
    const sub = (o.sub ?? 'MAIN - LIVE').toUpperCase()
    const titleW = Math.max(pillW(o.title.toUpperCase(), 13), pillW(sub, 8))
    emit('shell.title', o.title.toUpperCase(), null, x, cy, 13, titleW, sub)
  }

  if (o.instance === 'desktop') {
    // ── SIDE BAR — the action stack roosts vertically in the rail band ──
    const rb = bandOf('chrome.rail')
    if (rb && railPerchers.length) {
      const w = Math.max(90, rb.w - PAD * 2)
      let y = rb.y + PAD
      for (const p of railPerchers) { emit(p.id, p.label, p.action, rb.x + PAD, y, p.fs, w); y += PILL_H + GAP }
    }
    // ── BOTTOM BAR — BuilderBox roosts at the left ──
    const bb = bandOf('chrome.bottombar')
    if (bb && !o.isHub) {
      const cy = bb.y + Math.max(2, (bb.h - PILL_H) / 2)
      emit('shell.builderbox', boxLabel(false), 'builderbox', bb.x + EDGE, cy, RFS, pillW(boxLabel(false), RFS))
    }
  } else {
    // ── PHONE — the rail is culled; its perchers + BuilderBox flow in the
    // footer band (thumb row). The expand-from-band menu sheet is the next rung. ──
    const bb = bandOf('chrome.bottombar')
    if (bb && !o.isHub) {
      const cy = bb.y + Math.max(2, (bb.h - PILL_H) / 2)
      let x = bb.x + EDGE
      const footer: Percher[] = [...railPerchers, { id: 'shell.builderbox', label: boxLabel(true), action: 'builderbox', fs: RFS }]
      for (const p of footer) { const w = pillW(p.label, p.fs); emit(p.id, p.label, p.action, x, cy, p.fs, w); x += w + GAP }
    }
  }
  return nodes
}
