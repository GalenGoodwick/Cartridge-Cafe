// THE UNIFIED WORLD — rung 3 (pure core): the solve/dispatch layer.
//
// ONE function turns a WorldDoc + a viewport into THE PLAN a renderer executes:
// which regions exist at this instance, where they sit (solved rects), which
// backend each routes to (render.kind for game regions / the ui form for chrome),
// and the fit scales its visual must apply. This is the pipeline's spine:
//
//   WorldDoc ──▶ worldSolve(doc, viewport) ──▶ WorldPlan (rects + routes + fit)
//            ──▶ [renderer executes the plan]  ──▶ eye reads the SAME plan
//
// PURE: no GPU, no DOM. The renderer and the eye consume the same plan, so what
// draws and what verifies can never drift (the ui-grid doctrine, extended to the
// whole world). The DOM-vs-shader backend question stays DEFERRED: routes carry
// the declared form ('shaderUI' | 'dom' | …) and the executor decides policy.

import { solveUiGrid, type UiGridState, type SolvedRegion } from './ui-grid'
import { validateWorldDoc, defaultFit, type WorldDoc, type FitPolicy } from './world-config'
import { fitWhenMatches, fitUniforms } from './fit'

export type RegionRoute = {
  id: string
  layer: 'cafe' | 'game'
  rect: { x: number; y: number; w: number; h: number }
  z: number
  /** what draws this region: the doc's render.kind for game regions; the ui
   *  content form ('nodes'|'blocks'|'dom') for regions with declared ui;
   *  'empty' when a region has neither (a reserved band at rest). */
  backend: string
  fit: FitPolicy
  /** per-axis scales the visual applies (fit.ts) — shader uniform ready */
  scales: { scaleX: number; scaleY: number }
  slip?: boolean
}

export type WorldPlan = {
  ok: boolean
  errors: string[]          // validator problems (plan still solves when possible)
  viewport: { w: number; h: number }
  routes: RegionRoute[]
  /** region ids declared in layout but culled at this viewport (fit.when) */
  culled: string[]
}

const GRID_STATE = (vp: { w: number; h: number }): UiGridState =>
  ({ mode: 'view', role: 'visitor', worldState: 'done', window: vp, triggers: {} })

/** THE SOLVE — WorldDoc + viewport → the executable plan. */
export function worldSolve(doc: WorldDoc, viewport: { w: number; h: number }, state?: Partial<UiGridState>): WorldPlan {
  const errors = validateWorldDoc(doc)
  const gridState: UiGridState = { ...GRID_STATE(viewport), ...state, window: viewport }
  const solved: SolvedRegion[] = solveUiGrid(doc.layout, gridState)

  const routes: RegionRoute[] = []
  const culled: string[] = []
  for (const r of solved) {
    const fit = doc.fit?.[r.id] ?? defaultFit(r.layer === 'game' ? 'isotropic' : 'contain')
    // the calculated-instance cull: a fit.when that misses this viewport drops
    // the region from the plan entirely (it costs nothing at rest).
    if (!fitWhenMatches(fit.when, viewport)) { culled.push(r.id); continue }
    const ui = doc.ui?.[r.id]
    const backend = ui ? ui.as : (r.layer === 'game' ? doc.render.kind : 'empty')
    routes.push({
      id: r.id, layer: r.layer, rect: r.rect, z: r.z, backend, fit,
      scales: fitUniforms(fit.aspect, r.rect.w, r.rect.h),
      slip: r.slip ? true : undefined,
    })
  }
  // stable draw order: z ascending (the executor draws in plan order)
  routes.sort((a, b) => a.z - b.z)
  return { ok: errors.length === 0, errors, viewport, routes, culled }
}

/** The plan's readable truth for the eye — id → rect/backends, mirroring
 *  __uiRects' role at the world level. */
export function planRects(plan: WorldPlan): Record<string, { rect: RegionRoute['rect']; backend: string }> {
  const out: Record<string, { rect: RegionRoute['rect']; backend: string }> = {}
  for (const r of plan.routes) out[r.id] = { rect: r.rect, backend: r.backend }
  return out
}
