// BuildSpec — the ONE creation contract every entry point speaks (Create UI, MCP
// brew_world, bridge create_world). A short prompt is enough to start; the
// connecting AI expands it into this spec before building. Unresolved decisions
// stay visible as fields, not silent assumptions.
//
// This module is the shared PARSER + MAPPER: normalize any door's raw body into a
// canonical BuildSpec, then map that spec to birthWorld's inputs the SAME way for
// every door — so equivalent UI and MCP requests produce equivalent initial state
// and every spec field is preserved. Pure + synchronous (base/fork resolution and
// credits live in the creation service, not here) so it unit-tests exactly.

import { normalizeGamePrimitives, acceptanceFromPrimitives } from '@/app/engine/game-primitives'

export type BuildTarget = 'desktop' | 'mobile' | 'universal'
export type BuildVisibility = 'private' | 'public'
export type AcceptanceVerification = 'state' | 'render' | 'playthrough' | 'human'

export interface AcceptanceCheck {
  id: string
  description: string
  verification: AcceptanceVerification
}

/** A gameplay primitive the world DREW from the palette (game-primitives.ts).
 *  Every field optional — a universal environment draws no primitives at all. */
export type GamePrimitiveKind =
  | 'winCondition' | 'loseCondition' | 'scoring' | 'lives'
  | 'timer' | 'waves' | 'checkpoint' | 'collectible' | 'spawner' | 'progression'

export interface GamePrimitive {
  kind: GamePrimitiveKind
  /** winCondition/loseCondition trigger: reachScore | survive | clearWaves | livesZero | timeout | … */
  when?: string
  /** target value: score to reach, seconds to survive, waves to clear, … */
  target?: number
  /** scoring/lives/timer starting value */
  start?: number
  /** scoring: what earns points */
  per?: string
  /** timer length */
  seconds?: number
  count?: number
  /** freeform detail for any primitive */
  note?: string
  [param: string]: unknown
}

/** Gameplay is DESCRIPTION + a PALETTE, never a form of requirements. Every field
 *  is optional; `primitives` is what the world drew (empty/absent for a universal
 *  environment — no win/lose, nothing imposed). Win/lose live here as primitives,
 *  not as mandatory fields. */
export interface BuildGameplay {
  coreLoop?: string
  controls?: Record<string, string>
  progression?: string
  restartBehavior?: string
  primitives?: GamePrimitive[]
}

export interface BuildPresentation {
  vision: string
  references?: string[]
}

export interface BuildSpec {
  name: string
  brief: string
  target: BuildTarget
  visibility: BuildVisibility
  gameplay?: BuildGameplay
  presentation?: BuildPresentation
  acceptance: AcceptanceCheck[]
}

const TARGETS: ReadonlySet<string> = new Set(['desktop', 'mobile', 'universal'])
const VISIBILITIES: ReadonlySet<string> = new Set(['private', 'public'])
const VERIFICATIONS: ReadonlySet<string> = new Set(['state', 'render', 'playthrough', 'human'])

function str(v: unknown, max = 100000): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

/** Normalize ANY door's raw create body into a canonical BuildSpec. Idempotent:
 *  normalize(normalize(x)) === normalize(x). Unknown/absent fields get safe
 *  defaults (target 'universal' = undeclared; visibility 'private' = born unlisted,
 *  publication is a separate decision). Preserves every provided spec field. */
export function normalizeBuildSpec(raw: unknown): BuildSpec {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const target = TARGETS.has(r.target as string) ? (r.target as BuildTarget) : 'universal'
  const visibility = VISIBILITIES.has(r.visibility as string) ? (r.visibility as BuildVisibility) : 'private'

  const spec: BuildSpec = {
    name: str(r.name, 60).trim(),
    brief: str(r.brief, 2000).trim(),
    target,
    visibility,
    acceptance: normalizeAcceptance(r.acceptance),
  }

  const g = r.gameplay
  if (g && typeof g === 'object') {
    const go = g as Record<string, unknown>
    const gp: BuildGameplay = {}
    if (str(go.coreLoop)) gp.coreLoop = str(go.coreLoop, 2000)
    const controls = normalizeControls(go.controls)
    if (Object.keys(controls).length) gp.controls = controls
    if (str(go.progression)) gp.progression = str(go.progression, 2000)
    if (str(go.restartBehavior)) gp.restartBehavior = str(go.restartBehavior, 2000)
    // the drawn palette — plus legacy win/lose STRINGS folded in as primitives
    const prims = normalizeGamePrimitives(go.primitives)
    if (str(go.winCondition)) prims.push({ kind: 'winCondition', note: str(go.winCondition, 2000) })
    if (str(go.loseCondition)) prims.push({ kind: 'loseCondition', note: str(go.loseCondition, 2000) })
    if (prims.length) gp.primitives = prims
    if (Object.keys(gp).length) spec.gameplay = gp
  }

  const p = r.presentation
  if (p && typeof p === 'object') {
    const po = p as Record<string, unknown>
    const references = Array.isArray(po.references)
      ? po.references.map(x => str(x, 500)).filter(Boolean).slice(0, 20)
      : undefined
    spec.presentation = {
      vision: str(po.vision, 4000),
      ...(references && references.length ? { references } : {}),
    }
  }

  return spec
}

function normalizeControls(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof k === 'string' && str(val)) out[k.slice(0, 40)] = str(val, 200)
  }
  return out
}

function normalizeAcceptance(v: unknown): AcceptanceCheck[] {
  if (!Array.isArray(v)) return []
  const out: AcceptanceCheck[] = []
  for (let i = 0; i < v.length && i < 50; i++) {
    const c = v[i]
    if (!c || typeof c !== 'object') continue
    const co = c as Record<string, unknown>
    const description = str(co.description, 1000).trim()
    if (!description) continue // a check with no description is not a check
    out.push({
      id: str(co.id, 60).trim() || `ac${out.length + 1}`,
      description,
      verification: VERIFICATIONS.has(co.verification as string) ? (co.verification as AcceptanceVerification) : 'human',
    })
  }
  return out
}

/** Adapt the Create-UI / legacy body ({ name, brief, targets, access, base }) into
 *  a canonical BuildSpec. `targets` → target; `access:'open'` → public (SOLO stays
 *  private). Lets the rich doors keep their current form while speaking the one
 *  contract. `base`/fork lineage is handled by the creation service, not here. */
export function buildSpecFromCreateBody(body: unknown): BuildSpec {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  return normalizeBuildSpec({
    name: b.name,
    brief: b.brief,
    target: b.target ?? (b.targets === 'desktop' || b.targets === 'mobile' ? b.targets : 'universal'),
    visibility: b.visibility ?? (b.access === 'open' ? 'public' : 'private'),
    gameplay: b.gameplay,
    presentation: b.presentation ?? (str(b.vision) ? { vision: b.vision } : undefined),
    acceptance: b.acceptance,
  })
}

/** Grid shape at birth. Mobile is born PORTRAIT (base-mobile's proven 576×1024) so
 *  its canvas fills the phone frame from field one; desktop/universal use the
 *  default square. Mirrors resolveBirthExtras' birthParams — the one place. */
export function specToBirthParams(spec: BuildSpec): Record<string, unknown> {
  return spec.target === 'mobile'
    ? { deviceConfig: 'mobile', gridW: 576, gridH: 1024, gridSize: 1024 }
    : {}
}

/** The ONE visibility rule (replaces three drifting per-door rules). A world is
 *  public only when the spec says so AND the owner has no IP-shield — a
 *  proprietary owner's worlds are never auto-shelved public. */
export function specIsPublic(spec: BuildSpec, ownerHasIpShield: boolean): boolean {
  return spec.visibility === 'public' && !ownerHasIpShield
}

/** The acceptance checks a spec must satisfy — the ones the author DECLARED, plus
 *  the ones the drawn gameplay primitives IMPLY. A universal world draws no
 *  primitives and declares no checks → an empty list → nothing imposed. This is
 *  how completion (item 3) stays evidence-driven by what the world actually is,
 *  not by hand-written requirements. */
export function acceptanceFromSpec(spec: BuildSpec): AcceptanceCheck[] {
  const out: AcceptanceCheck[] = [...spec.acceptance]
  const seen = new Set(out.map(c => c.id))
  for (const c of acceptanceFromPrimitives(spec.gameplay?.primitives)) {
    if (!seen.has(c.id)) { seen.add(c.id); out.push(c) }
  }
  return out
}

/** The worldData a newborn carries from its spec. `creation_brief` stays for every
 *  existing reader (cards, publish gate); `presentation.vision` → `vision` for the
 *  same reason; the FULL spec is preserved under `spec` so nothing is lost and
 *  item-3's lifecycle has a home. Facet keys (fit) mirror resolveBirthExtras. */
export function specToWorldData(
  spec: BuildSpec,
  ctx: { by: string; at: number; format?: string },
): Record<string, unknown> {
  const wd: Record<string, unknown> = {
    spec, // the whole contract, preserved
  }
  if (spec.brief) {
    wd.creation_brief = { prompt: spec.brief, by: ctx.by, at: ctx.at, ...(ctx.format ? { format: ctx.format } : {}) }
  }
  if (spec.target !== 'universal') wd.fit = spec.target
  if (spec.presentation?.vision) wd.vision = spec.presentation.vision
  return wd
}
