// Safe-zone SLOTS — the low floor for world UI. Instead of authoring a `ui` tree
// with anchors it can get wrong (overlap, mis-centering), an AI drops content into
// NAMED ZONES on a predrawn grid; the solver places them. Overlap between zones is
// impossible (distinct regions); overlap within a zone is impossible (the items
// flow in a column). Alignment is automatic (topRight is top-right; bottomCenter is
// centered). The UI analog of the built-in visuals: pick a slot, not a coordinate.
//
// Publish `worldData.slots` from a hook (or the bridge) and the engine solves it
// through the ONE UI authority — see slotsToUi wired at the FieldEngine solve site.

import type { UiNode, UiTree } from './ui-solver'

/** One piece of content in a slot. Give ONE of: text, meter, or button. */
export interface SlotItem {
  text?: string
  fontSize?: number
  color?: string
  /** 0..1 → renders a meter bar (with optional label) */
  meter?: number
  label?: string
  /** renders a clickable button with this label */
  button?: string
  /** action for a button, or to make a text item clickable → wd.__uiClick */
  click?: string
}

export type SlotZone =
  | 'topLeft' | 'topCenter' | 'topRight'
  | 'midLeft' | 'center' | 'midRight'
  | 'bottomLeft' | 'bottomCenter' | 'bottomRight'

/** The safe-zone grid. Each zone holds a stack of items (flowed, never overlapping);
 *  `bottomBar` is a row of evenly-spaced CELLS (the predrawn bottom grid). */
export type SlotsSpec = Partial<Record<SlotZone, SlotItem[]>> & {
  bottomBar?: SlotItem[][]
  /** subtle glass boxes behind each populated zone (default false = plain text) */
  glass?: boolean
}

// Anchor to the WORLD SQUARE (gx/gy, 0..512), NOT the full viewport (vx/vy). This
// is what keeps a HUD contained ON the world in ANY frame — full-bleed /space or
// the letterboxed /grid player where the world is a centered square. vx/vy would
// spill the UI into the margins beside a framed world (the "all over the place"
// bug). Full-bleed screen-edge UI is an advanced case for raw worldData.ui.
const M = 14 // margin from the square edge, in the 512 design grid
const ZONES: Record<SlotZone, { gx: number; gy: number; align: NonNullable<UiNode['align']> }> = {
  topLeft: { gx: M, gy: M, align: 'tl' },
  topCenter: { gx: 256, gy: M, align: 'tc' },
  topRight: { gx: 512 - M, gy: M, align: 'tr' },
  midLeft: { gx: M, gy: 256, align: 'cl' },
  center: { gx: 256, gy: 256, align: 'c' },
  midRight: { gx: 512 - M, gy: 256, align: 'cr' },
  bottomLeft: { gx: M, gy: 512 - M, align: 'bl' },
  bottomCenter: { gx: 256, gy: 512 - M, align: 'bc' },
  bottomRight: { gx: 512 - M, gy: 512 - M, align: 'br' },
}
const ZONE_ORDER: SlotZone[] = ['topLeft', 'topCenter', 'topRight', 'midLeft', 'center', 'midRight', 'bottomLeft', 'bottomCenter', 'bottomRight']

function itemToNode(it: SlotItem): UiNode {
  if (typeof it.meter === 'number') {
    return { kind: 'meter', value: Math.max(0, Math.min(1, it.meter)), w: 130, h: 12, ...(it.label ? { label: it.label } : {}), ...(it.color ? { hue: it.color } : {}) }
  }
  if (it.button) {
    return { kind: 'button', text: it.button, ...(it.click ? { click: it.click } : {}) }
  }
  const node: UiNode = { kind: 'text', text: it.text ?? '', fontSize: it.fontSize ?? 14, ...(it.color ? { color: it.color } : {}) }
  if (it.click) node.click = it.click
  return node
}

function fp(it: SlotItem): number {
  return (it.text?.length ?? 0) + (it.button?.length ?? 0) + Math.round((it.meter ?? 0) * 100) + (it.label?.length ?? 0)
}

/** Convert a slots spec into a solver UiTree — one anchored panel per populated
 *  zone (items flow in a column), plus a bottom bar row of cells. */
export function slotsToUi(slots: SlotsSpec): UiTree {
  const root: UiNode[] = []
  let rev = 0
  const glass = slots.glass === true
  const bar = slots.bottomBar
  const barPresent = Array.isArray(bar) && bar.length > 0

  for (const zone of ZONE_ORDER) {
    const items = slots[zone]
    if (!Array.isArray(items) || items.length === 0) continue
    const z = ZONES[zone]
    // when a bottom bar occupies the bottom edge, lift the three bottom zones
    // above it so nothing collides (overlap stays structurally impossible).
    const lift = barPresent && (zone === 'bottomLeft' || zone === 'bottomCenter' || zone === 'bottomRight') ? -52 : 0
    root.push({
      id: `slot_${zone}`, kind: 'panel',
      anchor: { gx: z.gx, gy: z.gy + lift }, align: z.align,
      glass, pad: glass ? 8 : 0, gap: 4,
      children: items.map(itemToNode),
    })
    for (const it of items) rev += fp(it)
  }

  if (barPresent) {
    const cells: UiNode[] = []
    bar!.forEach((cell, i) => {
      if (i > 0) cells.push({ kind: 'spacer', flex: 1 })
      cells.push({ id: `bar_${i}`, kind: 'col', gap: 3, children: (cell || []).map(itemToNode) })
      for (const it of (cell || [])) rev += fp(it)
    })
    // the PANEL carries w:'92%' (only top-level panels honor an explicit width);
    // its row child inherits that span, so the flex spacers push the cells to the
    // bar's edges — an evenly-laid predrawn bottom grid.
    root.push({
      id: 'slot_bottomBar', kind: 'panel',
      anchor: { gx: 256, gy: 512 - M }, align: 'bc',
      w: '92%', glass, pad: glass ? 8 : 0,
      children: [{ kind: 'row', gap: 12, children: cells }],
    })
    rev += 7
  }

  return { rev, root }
}
