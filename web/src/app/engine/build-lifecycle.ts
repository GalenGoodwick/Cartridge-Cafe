// Explicit build lifecycle + evidence-bound completion (item 3). A world moves
//   draft → building → validating → ready
//                          ↓
//                    needs_changes
// and "ready" is EARNED by evidence, not asserted by a flag. Each check is a
// ValidationResult tagged with the REVISION it ran against; any authored edit
// bumps the revision (__bridge_rev) and invalidates prior evidence — so a stale
// playthrough can't certify a changed build. GPU-unavailable is `unavailable`,
// never a pass. This module is the pure core (no I/O); the bridge tools
// (build_status / validate_world / complete_build) drive it, and brief_done
// becomes a DERIVED mirror of stage === 'ready'.

import type { BuildSpec } from '@/lib/build-spec'
import { acceptanceFromSpec } from '@/lib/build-spec'

export type BuildStage = 'draft' | 'building' | 'validating' | 'ready' | 'needs_changes'
export type CheckStatus = 'passed' | 'failed' | 'unavailable'

export interface ValidationResult {
  /** the world revision (String(__bridge_rev)) this check ran against */
  revision: string
  check: string
  status: CheckStatus
  /** where it ran — 'server-compile', 'browser-webgpu', 'headless', … (recorded so
   *  a limited environment's evidence is honest about its limits) */
  environment: string
  artifact?: string
  details: string[]
}

/** What the world actually IS — derived from its snapshot (Phase-2 concern). */
export interface WorldFacts {
  fieldCount: number
  hookCount: number
  /** at least one field carries a renderable visual */
  hasVisual: boolean
  /** reads input / has gameplay — an interactive world owes more than a frame */
  interactive: boolean
  perfTargetMs?: number
}

/** The core checks a build can be asked for. Acceptance-scenario ids (from the
 *  spec's drawn primitives) join these as required checks for interactive worlds. */
export const CORE_CHECKS = ['shader-compile', 'render-frame', 'hook-syntax', 'input-response', 'restart', 'performance'] as const

function needsRestart(spec: BuildSpec | undefined): boolean {
  if (!spec?.gameplay) return false
  if (spec.gameplay.restartBehavior) return true
  const kinds = new Set((spec.gameplay.primitives ?? []).map(p => p.kind))
  // a world that can END needs a defined restart
  return kinds.has('winCondition') || kinds.has('loseCondition') || kinds.has('lives') || kinds.has('checkpoint')
}

/** The checks THIS world must pass for its current revision. A render-only world
 *  needs a compiled shader + a clean frame; an INTERACTIVE world additionally needs
 *  input response, each drawn acceptance scenario, and (if it can end) restart — so
 *  a rendered background ALONE can never make a game "ready". */
export function requiredChecks(spec: BuildSpec | undefined, facts: WorldFacts): string[] {
  const req: string[] = []
  if (facts.fieldCount > 0 || facts.hasVisual) req.push('shader-compile', 'render-frame')
  if (facts.hookCount > 0) req.push('hook-syntax')
  if (facts.interactive) {
    req.push('input-response')
    if (spec) for (const c of acceptanceFromSpec(spec)) req.push(c.id)
    if (needsRestart(spec)) req.push('restart')
  }
  if (facts.perfTargetMs != null) req.push('performance')
  return [...new Set(req)]
}

/** Evidence for the CURRENT revision only, latest-run-wins per check. Prior-revision
 *  results are dropped — that is how a hook/shader edit invalidates old evidence. */
export function currentEvidence(evidence: ValidationResult[], revision: string): Map<string, ValidationResult> {
  const m = new Map<string, ValidationResult>()
  for (const e of evidence) if (e.revision === revision) m.set(e.check, e) // last write wins
  return m
}

export interface BuildEvaluation {
  ready: boolean
  stage: BuildStage
  revision: string
  required: string[]
  passed: string[]
  /** checks blocking completion, each with WHY (missing = no evidence this revision) */
  outstanding: Array<{ check: string; status: 'missing' | CheckStatus; detail?: string }>
}

/** Evaluate a build against its evidence: derive whether it is ready and what is
 *  outstanding. `explicitStage` (e.g. an author paused to needs_changes) is honored
 *  only when the evidence itself doesn't already say ready. */
export function evaluateBuild(args: {
  spec?: BuildSpec
  facts: WorldFacts
  revision: string
  evidence: ValidationResult[]
}): BuildEvaluation {
  const required = requiredChecks(args.spec, args.facts)
  const cur = currentEvidence(args.evidence, args.revision)
  const passed: string[] = []
  const outstanding: BuildEvaluation['outstanding'] = []
  for (const check of required) {
    const e = cur.get(check)
    if (e?.status === 'passed') passed.push(check)
    else outstanding.push({ check, status: e ? e.status : 'missing', ...(e?.details?.length ? { detail: e.details[0] } : {}) })
  }
  const ready = required.length > 0 && outstanding.length === 0
  const anyFailed = outstanding.some(o => o.status === 'failed')
  const anyEvidence = cur.size > 0
  const hasContent = args.facts.fieldCount > 0 || args.facts.hookCount > 0
  const stage: BuildStage = ready ? 'ready'
    : anyFailed ? 'needs_changes'
      : anyEvidence ? 'validating'
        : hasContent ? 'building' : 'draft'
  return { ready, stage, revision: args.revision, required, passed, outstanding }
}
