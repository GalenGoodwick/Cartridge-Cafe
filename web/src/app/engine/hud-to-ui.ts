// hud → ui compatibility adapter. The legacy `worldData.hud` DOM overlay is
// retired: there is ONE UI render authority now — the ui-solver (engine pixels,
// recorded by REC, contained in framed worlds, layout-solved). Worlds still
// publishing `hud` keep working: each `text`/`bar` element becomes an anchored
// solver panel at the same position. `html`/`image`/`css` have NO engine-pixel
// equivalent and are dropped (Galen, Sep 7: game worlds don't need HTML/CSS UI) —
// a world wanting rich structured UI authors `worldData.ui` directly.

import type { UiNode, UiTree } from './ui-solver'
import type { HudElement } from './types'

const GRID = 512 // the design square hud coords live in (px or % of it)

/** parse a hud coord ('16px' | '50%' | 16) into design units (0..512). */
function coord(v: string | number | undefined, def = 0): number {
  if (v == null) return def
  const s = String(v).trim()
  if (s.endsWith('%')) return (parseFloat(s) / 100) * GRID
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : def
}

/** Convert a legacy hud element list into a solver UiTree. Text/bar only. */
export function hudToUi(hud: HudElement[]): UiTree {
  const root: UiNode[] = []
  let rev = 0
  for (const el of hud) {
    if (!el || !el.id || el.visible === false) continue
    if (el.type === 'html' || el.type === 'image') continue // no engine-pixel equivalent

    // Anchor to whichever edges the element pinned: x/y = top-left, right/bottom
    // = the opposite edges (faithful to the DOM's left/top/right/bottom).
    const hasR = el.right != null, hasB = el.bottom != null
    const gx = hasR ? GRID - coord(el.right) : coord(el.x)
    const gy = hasB ? GRID - coord(el.bottom) : coord(el.y)
    const align: UiNode['align'] = hasR ? (hasB ? 'br' : 'tr') : (hasB ? 'bl' : 'tl')

    let child: UiNode
    if (el.type === 'bar') {
      const e = el as HudElement & { width?: string; barColor?: string }
      const fill = el.max ? Math.max(0, Math.min(1, (el.value ?? 0) / el.max)) : 0
      child = { kind: 'meter', value: fill, w: coord(e.width, 100), h: 12, hue: e.barColor ?? el.color }
      rev += Math.round(fill * 100)
    } else {
      const text = el.text ?? ''
      child = { kind: 'text', text, fontSize: coord(el.fontSize, 16), color: el.color }
      rev += text.length
    }
    if (el.clickable) child.click = el.id

    root.push({ id: el.id, kind: 'panel', anchor: { gx, gy }, align, glass: false, pad: 0, children: [child] })
    rev += Math.round(gx + gy)
  }
  return { rev, root }
}
