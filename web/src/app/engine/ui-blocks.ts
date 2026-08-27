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

export interface ShellWorldOpts {
  title: string
  sub?: string
  instance: 'phone' | 'desktop'
  isOwner: boolean
  isHub?: boolean
  /** engine-count badge for the BuilderBox pill (people + AI live now) */
  live?: number
}

const RAIL_FS = 11
const RAIL_W = 118          // one rail width — the widest label (INSTRUCTIONS) + pad

export function shellWorldUi(o: ShellWorldOpts): UiNode[] {
  const nodes: UiNode[] = shellTopbarUi({ title: o.title, sub: o.sub, instance: o.instance, dockable: false, menu: false })

  const pill = (id: string, label: string, action: string, anchor: UiNode['anchor'], align: UiNode['align'], w?: number): UiNode => ({
    id, kind: 'panel', pad: PILL_PAD, ...(w ? { w } : {}), glass: SHELL_GLASS,
    click: shellAction(action), draggable: false, collapsible: false,
    anchor, align,
    children: [{ id: `${id}.t`, kind: 'text', text: label, fontSize: RAIL_FS, color: SHELL_INK }],
  })

  if (!o.isHub) {
    if (o.instance === 'desktop') {
      // THE RAIL — top-right stack, below the topbar band; uniform width so it
      // reads as one clean column (the DOM dock's items-stretch, declared)
      const railX = -EDGE
      let y = EDGE + 34
      const rail: Array<[string, string, string]> = [
        ['shell.play', '# PLAY', 'play'],
        ['shell.instructions', '? INSTRUCTIONS', 'instructions'],
        ...(!o.isOwner ? [['shell.fork', '+ FORK WORLD', 'fork'] as [string, string, string]] : []),
        ['shell.edit', '/ EDIT', 'edit'],
      ]
      for (const [id, label, action] of rail) {
        nodes.push(pill(id, label, action, { vx: 1, vy: 0, dx: railX, dy: y }, 'tr', RAIL_W))
        y += 30
      }
      nodes.push(pill('shell.builderbox', `= BUILDERBOX${o.live ? ` (${o.live})` : ''}`, 'builderbox',
        { vx: 0, vy: 1, dx: EDGE, dy: -EDGE }, 'bl'))
    } else {
      // PHONE — footer row: BUILDERBOX + PLAY side by side, thumb-reachable
      nodes.push(pill('shell.builderbox', `= BOX${o.live ? ` (${o.live})` : ''}`, 'builderbox',
        { vx: 0, vy: 1, dx: EDGE, dy: -EDGE }, 'bl'))
      nodes.push(pill('shell.play', '# PLAY', 'play',
        { vx: 0, vy: 1, dx: EDGE + 86, dy: -EDGE }, 'bl'))
    }
  }
  return nodes
}
