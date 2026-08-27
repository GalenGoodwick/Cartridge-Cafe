// THE UNIFIED WORLD — rung 1 (DESIGN-unified-world.md).
//
// The ONE schema that composes a world's orthogonal FACETS. A raymarched FPS, a
// 2D field puzzle, a shader-UI catalog, and a mobile app page are the SAME
// WorldDoc with different facet vectors. This module is PURE — types + a
// consistency validator, no render, no DOM. It is the schema every facet agrees
// on; the render-backend choice (shaderUI vs a DOM escape hatch) is deliberately
// deferred to the dispatcher rung, so `render.kind` names the backend without
// committing the engine to it.
//
// Facets (each already exists as an island — this NAMES them, does not rebuild):
//   render   → renderer.ts (field2d/raymarch3d), ui-solver+shaders.ts (shaderUI)
//   layout   → ui-grid.ts (regions/perchers/movers + overlap gate)   [reused below]
//   ui       → ui-solver nodes / ui-blocks compile / DOM escape hatch
//   fit      → when-clauses + aspect-aware recomposition (FitShader principle)
//   input    → __uiClick/__uiRects, TouchControls, key bindings
//   behavior → __nodes step-hooks (node-runtime)
//   state    → worldData

import type { UiGridDoc } from './ui-grid'

// ── RENDER ── how a region's visual is drawn. The backend is NAMED, not yet
// committed (per-kind config is typed at the dispatcher rung).
export type RenderKind = 'field2d' | 'raymarch3d' | 'shaderUI' | 'composite' | 'none'
export const RENDER_KINDS: readonly RenderKind[] = ['field2d', 'raymarch3d', 'shaderUI', 'composite', 'none']
export type RenderFacet = { kind: RenderKind; config?: Record<string, unknown> }

// ── FIT ── how a region recomposes across viewports. `when` culls the instance
// (the calculated-instance predicate, mirroring ui-grid's RegionWhen.viewport);
// `aspect` is how the visual fills its box.
export type AspectPolicy = 'cover' | 'contain' | 'isotropic' | 'stretch'
export const ASPECT_POLICIES: readonly AspectPolicy[] = ['cover', 'contain', 'isotropic', 'stretch']
export type FitWhen = { minW?: number; maxW?: number; minH?: number; maxH?: number }
export type FitPolicy = { aspect: AspectPolicy; when?: FitWhen }

// ── INPUT ── how a region is controlled. Click targets route via __uiClick;
// touch/keys are declarative bindings the engine wires.
export type InputMap = {
  clickTargets?: string[]
  touch?: 'none' | 'stick' | 'buttons' | 'stick+buttons'
  keys?: Record<string, string>
}

// ── UI ── what fills a region: a solver node tree, blocks to compile, or a
// declared DOM tenant (the escape hatch, decided at the dispatcher rung). Opaque
// here — the schema only records WHICH form, not its internals.
export type UiContent =
  | { as: 'nodes'; tree: unknown }
  | { as: 'blocks'; blocks: unknown }
  | { as: 'dom'; tenant: string }

// ── THE ONE DECLARATION ──
export type WorldDoc = {
  id: string
  name: string
  render: RenderFacet
  layout: UiGridDoc                    // regions — reuses the shipped ui-grid doc
  ui?: Record<string, UiContent>       // regionId → content
  fit?: Record<string, FitPolicy>      // regionId → fit policy
  input?: InputMap
  behavior?: unknown                   // __nodes — node-runtime
  state?: Record<string, unknown>      // worldData
}

/** A sensible fit default — contained, no viewport cull. */
export const defaultFit = (aspect: AspectPolicy = 'contain'): FitPolicy => ({ aspect })

/** Which facets a doc actually declares — useful for the eye + debugging. */
export function worldDocFacets(doc: WorldDoc): string[] {
  const f: string[] = ['render', 'layout']
  if (doc.ui && Object.keys(doc.ui).length) f.push('ui')
  if (doc.fit && Object.keys(doc.fit).length) f.push('fit')
  if (doc.input) f.push('input')
  if (doc.behavior) f.push('behavior')
  if (doc.state && Object.keys(doc.state).length) f.push('state')
  return f
}

/** THE CONSISTENCY VALIDATOR — the real logic of rung 1. Every ui/fit facet
 *  must target a region that actually exists in `layout`; render.kind and every
 *  aspect must be known; a viewport window must not be inverted. Returns a list
 *  of human-readable problems ([] = consistent). This is what keeps a WorldDoc
 *  from silently declaring content for a region that isn't there. */
export function validateWorldDoc(doc: WorldDoc): string[] {
  const errs: string[] = []
  if (!doc.id) errs.push('missing id')
  if (!RENDER_KINDS.includes(doc.render?.kind)) errs.push(`render.kind '${doc.render?.kind}' is not a known kind`)

  const regionIds = new Set((doc.layout?.regions ?? []).map(r => r.id))
  for (const k of Object.keys(doc.ui ?? {})) if (!regionIds.has(k)) errs.push(`ui targets region '${k}' which is not in layout`)
  for (const [k, f] of Object.entries(doc.fit ?? {})) {
    if (!regionIds.has(k)) errs.push(`fit targets region '${k}' which is not in layout`)
    if (!ASPECT_POLICIES.includes(f.aspect)) errs.push(`fit['${k}'].aspect '${f.aspect}' is not a known policy`)
    const w = f.when
    if (w && w.minW != null && w.maxW != null && w.minW > w.maxW) errs.push(`fit['${k}'].when has minW > maxW (never matches)`)
    if (w && w.minH != null && w.maxH != null && w.minH > w.maxH) errs.push(`fit['${k}'].when has minH > maxH (never matches)`)
  }
  for (const id of doc.input?.clickTargets ?? []) if (typeof id !== 'string' || !id) errs.push('input.clickTargets has an empty target')
  return errs
}

/** true iff the doc is internally consistent. */
export const worldDocOk = (doc: WorldDoc): boolean => validateWorldDoc(doc).length === 0
