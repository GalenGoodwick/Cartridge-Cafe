// THE SHADER-CHROME LANE (the conversion, DESIGN-unified-world.md) — the bridge
// from Opus's worldSolve to the engine's own glass/glyph passes.
//
//   WorldDoc ─worldSolve→ WorldPlan ─chromePlanToDraw→ {boxes,runs,hits}
//                                                       ↓ the SAME primitives
//                                                       the ui-solver emits,
//                                                       drawn by the WGSL glass
//                                                       + sprite-font glyph pass
//
// Why this shape (the coordinate-honesty lesson from one-engine): worldSolve
// already resolved layout in VIEWPORT PX. Routing chrome back through the
// ui-solver's 512 design-square would re-introduce the two-space seam that made
// text drift. So the chrome executor computes its primitives DIRECTLY in plan
// space — one coordinate authority, the plan's own px. Text placement is exact
// monospace arithmetic (ADV·fontSize), the method proved on /space/one-engine.
//
// A chrome region declares its CONTENT in the doc (doc.ui[id].content); this
// turns that declaration into positioned boxes/runs/hits inside the region's
// solved rect. Actions carry the `shell:` namespace → the host, never the
// world (the one-engine seam law).
//
// PURE: no DOM, no GPU — deterministic, unit-testable like worldSolve.

import { ADV, LINE, type SolvedBox, type SolvedRun, type SolvedHit } from './ui-solver'
import { shellAction, SHELL_GLASS } from './ui-blocks'
import type { WorldPlan, RegionRoute } from './world-solve'

const INK = 'rgba(236,235,242,0.94)'
const MUT = 'rgba(160,157,172,0.9)'

/** the chrome CONTENT a region declares (doc.ui[id].content). Minimal on
 *  purpose — each kind maps to a known shader-chrome layout. */
export type ChromeItem = { label: string; action: string; active?: boolean }
export type ChromeContent =
  | { kind: 'topbar'; title: string; sub?: string; back?: boolean; right?: ChromeItem }
  | { kind: 'nav'; items: ChromeItem[] }
  | { kind: 'buttons'; items: ChromeItem[]; dir?: 'row' | 'col' }
  | { kind: 'title'; title: string; sub?: string }

export interface ChromeDraw { boxes: SolvedBox[]; runs: SolvedRun[]; hits: SolvedHit[] }

const glass = SHELL_GLASS as SolvedBox['style']
const tw = (text: string, fs: number) => text.length * ADV * fs

/** ASCII-FOLD (the atlas is 32-127): the sprite-font pass can only draw that
 *  range, so the executor NEVER emits a glyph outside it — a caller can't crash
 *  the pass with a stray '·' or an em-dash. Common typography folds to its
 *  ASCII kin; anything else becomes a space. Applied to every run's text. */
const FOLD: Record<string, string> = { '·': '-', '•': '-', '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '..' }
function ascii(text: string): string {
  let out = ''
  for (const ch of text) {
    const c = ch.charCodeAt(0)
    if (c >= 32 && c <= 127) out += ch
    else out += FOLD[ch] ?? ' '
  }
  return out
}

/** one pill: a glass box + centered glyph run + (if it acts) a hit rect. */
function pill(id: string, r: { x: number; y: number; w: number; h: number }, label: string, opts: { action?: string; active?: boolean; muted?: boolean } = {}, out: ChromeDraw) {
  out.boxes.push({ id, x: r.x, y: r.y, w: r.w, h: r.h, style: opts.active ? { ...glass, border: 'rgba(255,217,160,0.9)' } : glass, collapsed: false })
  const fs = Math.min(14, r.h * 0.42)
  const glyphs = ascii(label)
  const lx = r.x + Math.max(6, (r.w - tw(glyphs, fs)) / 2)
  out.runs.push({ id: id + '.t', x: lx, y: r.y + (r.h - LINE * fs) / 2, fs, color: opts.active ? INK : opts.muted ? MUT : INK, text: glyphs })
  if (opts.action) out.hits.push({ id, action: opts.action, x: r.x, y: r.y, w: r.w, h: r.h })
}

/** lay one chrome region's declared content into its solved rect. */
function drawRegion(route: RegionRoute, content: ChromeContent, out: ChromeDraw) {
  const R = route.rect
  const pad = Math.min(8, R.h * 0.18)
  const gap = 6
  const id = route.id

  if (content.kind === 'topbar' || content.kind === 'title') {
    const back = content.kind === 'topbar' && content.back
    const bx = R.x + pad
    const bh = R.h - pad * 2
    let cx = bx
    if (back) {
      const bw = Math.max(28, bh)
      pill(id + '.back', { x: cx, y: R.y + pad, w: bw, h: bh }, '<', { action: shellAction('back') }, out)
      cx += bw + gap
    }
    // the title chip — name over sub, its own glass box (a percher, not a button)
    const nameFs = Math.min(13, bh * 0.5)
    const subFs = Math.max(7, nameFs * 0.62)
    const title = content.title.toUpperCase()
    const sub = (content.sub ?? 'MAIN - LIVE').toUpperCase()
    const chipW = Math.min(R.w * 0.55, Math.max(tw(title, nameFs), tw(sub, subFs)) + pad * 2)
    out.boxes.push({ id: id + '.title', x: cx, y: R.y + pad, w: chipW, h: bh, style: glass, collapsed: false })
    out.runs.push({ id: id + '.title.n', x: cx + pad, y: R.y + pad + bh * 0.16, fs: nameFs, color: INK, text: ascii(clip(title, chipW - pad * 2, nameFs)) })
    out.runs.push({ id: id + '.title.s', x: cx + pad, y: R.y + pad + bh * 0.16 + LINE * nameFs, fs: subFs, color: MUT, text: ascii(clip(sub, chipW - pad * 2, subFs)) })
    // the right slot (topbar only): one item pinned to the region's right edge
    if (content.kind === 'topbar' && content.right) {
      const rw = tw(content.right.label, 12) + pad * 2
      pill(id + '.right', { x: R.x + R.w - pad - rw, y: R.y + pad, w: rw, h: bh }, content.right.label, { action: shellAction(content.right.action) }, out)
    }
    return
  }

  if (content.kind === 'nav' || content.kind === 'buttons') {
    const items = content.items
    if (!items.length) return
    const horizontal = content.kind === 'nav' || content.dir !== 'col'
    if (horizontal) {
      const each = (R.w - pad * 2 - gap * (items.length - 1)) / items.length
      items.forEach((it, i) => pill(`${id}.${i}`, { x: R.x + pad + i * (each + gap), y: R.y + pad, w: each, h: R.h - pad * 2 }, it.label.toUpperCase(),
        { action: shellAction(it.action), active: it.active }, out))
    } else {
      const bh = Math.min(32, (R.h - pad * 2 - gap * (items.length - 1)) / items.length)
      items.forEach((it, i) => pill(`${id}.${i}`, { x: R.x + pad, y: R.y + pad + i * (bh + gap), w: R.w - pad * 2, h: bh }, it.label.toUpperCase(),
        { action: shellAction(it.action), active: it.active }, out))
    }
  }
}

/** non-wrap clip in exact monospace units — '..' (ASCII, the atlas is 32-127). */
function clip(text: string, maxW: number, fs: number): string {
  const maxCh = Math.max(1, Math.floor(maxW / (ADV * fs) + 1e-6))
  return text.length > maxCh ? text.slice(0, Math.max(1, maxCh - 2)) + '..' : text
}

/** THE SHADER-CHROME EXECUTOR: a solved plan + the per-region chrome content
 *  (from the doc) → draw primitives in plan/viewport px, drawn by the engine's
 *  glass + sprite-font passes. Game regions are ignored (the render facet draws
 *  them); only cafe regions whose backend is shader-UI carry chrome here. */
export function chromePlanToDraw(plan: WorldPlan, content: Record<string, ChromeContent>): ChromeDraw {
  const out: ChromeDraw = { boxes: [], runs: [], hits: [] }
  for (const route of plan.routes) {
    if (route.layer !== 'cafe') continue
    if (route.backend === 'dom') continue          // DOM escape hatch — not our lane
    const c = content[route.id]
    if (!c) continue                               // a reserved band at rest
    drawRegion(route, c, out)
  }
  return out
}
