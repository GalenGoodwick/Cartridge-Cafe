// Snapshot ↔ lifecycle bridge. Derives WorldFacts + spec + revision from a space
// snapshot, runs the checks the SERVER can (hook syntax, shader shape), reads/writes
// the evidence ledger (worldData.__build.evidence), and evaluates. The bridge tools
// build_status / validate_world / complete_build drive these; brief_done becomes a
// derived mirror of stage === 'ready'. Browser-only checks (render / input /
// playthrough / performance) arrive via validate_world {results} from the eye.

import type { BuildSpec } from '@/lib/build-spec'
import { normalizeBuildSpec } from '@/lib/build-spec'
import { BUILTIN_VISUAL_WGSL } from './shaders'
import { evaluateBuild, type ValidationResult, type WorldFacts, type BuildEvaluation, type BuildStage } from './build-lifecycle'

// The re-enabled built-in visual library (solid/glow/circle/…) renders WITHOUT a
// per-world define_visual — a field using one is NOT broken. Seed the renderable
// set with the built-in names so the lifecycle checker doesn't false-fail them.
const BUILTIN_VISUAL_NAMES: ReadonlySet<string> = new Set(BUILTIN_VISUAL_WGSL.map(b => b.name))

export interface SnapshotLike {
  fields?: Array<{ id?: string; visualTypeName?: string; name?: string; shapeType?: string }>
  stepHooks?: Array<{ hookId?: string; code?: string }>
  visualTypes?: Array<{ name?: string; wgsl?: string }>
  modules?: Array<{ name?: string; wgsl?: string }>
  worldData?: Record<string, unknown>
}

export interface BuildLedger {
  stage: BuildStage
  evidence: ValidationResult[]
}

function hashStr(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** The revision is a hash of the AUTHORED surface — hooks, visuals, modules, each
 *  field's shape/visual (NOT its transform: hooks move fields every frame and that
 *  must not churn the revision), and the spec. It changes only on a real gameplay/
 *  shader/spec edit — which is exactly when prior evidence should be invalidated —
 *  and stays stable while evidence is being recorded (recording is not authoring). */
export function worldRevision(snap: SnapshotLike): string {
  const parts: string[] = []
  for (const h of snap.stepHooks ?? []) parts.push('h', h.hookId ?? '', h.code ?? '')
  for (const v of snap.visualTypes ?? []) parts.push('v', v.name ?? '', v.wgsl ?? '')
  for (const m of snap.modules ?? []) parts.push('m', m.name ?? '', m.wgsl ?? '')
  for (const f of snap.fields ?? []) parts.push('f', f.id ?? f.name ?? '', f.shapeType ?? '', f.visualTypeName ?? '')
  parts.push('s', JSON.stringify(snap.worldData?.['spec'] ?? null))
  return hashStr(parts.join(''))
}

export function specFromSnapshot(snap: SnapshotLike): BuildSpec | undefined {
  const s = snap.worldData?.['spec']
  return s ? normalizeBuildSpec(s) : undefined
}

function renderableNames(snap: SnapshotLike): Set<string> {
  const s = new Set<string>(BUILTIN_VISUAL_NAMES) // built-ins render with no define_visual
  for (const v of snap.visualTypes ?? []) if (/fn\s+visual_\w+\s*\(/.test(v.wgsl ?? '')) s.add(v.name ?? '')
  return s
}

export function worldFactsFromSnapshot(snap: SnapshotLike): WorldFacts {
  const fields = snap.fields ?? []
  const hooks = snap.stepHooks ?? []
  const renderable = renderableNames(snap)
  const hasVisual = fields.some(f => !!f.visualTypeName && renderable.has(f.visualTypeName))
  const spec = specFromSnapshot(snap)
  const readsInput = hooks.some(h => /\binput\b|key_|mouse_|__uiClick|wd\.slots|wd\.hud/.test(h.code ?? ''))
  const hasGameplay = !!(spec?.gameplay?.primitives?.length || spec?.gameplay?.controls)
  const interactive = hooks.length > 0 && (readsInput || hasGameplay)
  return { fieldCount: fields.length, hookCount: hooks.length, hasVisual, interactive }
}

export function getLedger(snap: SnapshotLike): BuildLedger {
  const b = snap.worldData?.['__build'] as Partial<BuildLedger> | undefined
  return { stage: b?.stage ?? 'draft', evidence: Array.isArray(b?.evidence) ? b!.evidence! : [] }
}

/** The checks the SERVER can run right now → results at the current revision.
 *  hook-syntax compiles each hook (the same new Function(...) the sandbox uses);
 *  shader-compile is a SHAPE proxy (a field using a non-defining visual renders
 *  black). Full render/input/playthrough need the eye and come via {results}. */
export function serverChecks(snap: SnapshotLike): ValidationResult[] {
  const revision = worldRevision(snap)
  const out: ValidationResult[] = []
  const hooks = snap.stepHooks ?? []
  if (hooks.length) {
    const bad: string[] = []
    for (const h of hooks) { try { new Function('sim', 'dt', String(h.code ?? '')) } catch (e) { bad.push(e instanceof Error ? e.message : String(e)) } }
    out.push({ revision, check: 'hook-syntax', status: bad.length ? 'failed' : 'passed', environment: 'server-compile', details: bad.slice(0, 4) })
  }
  const fields = snap.fields ?? []
  const visuals = snap.visualTypes ?? []
  if (fields.length || visuals.length) {
    const renderable = renderableNames(snap)
    const brokenAttached = fields.filter(f => !!f.visualTypeName && !renderable.has(f.visualTypeName))
    out.push({
      revision, check: 'shader-compile',
      status: brokenAttached.length ? 'failed' : 'passed',
      environment: 'server-shape',
      details: brokenAttached.length ? [`${brokenAttached.length} field(s) use a non-defining visual → renders black: ${brokenAttached.map(f => f.name).filter(Boolean).slice(0, 6).join(', ')}`] : [],
    })
  }
  return out
}

/** Stamp external results (from the eye/playthrough) with the CURRENT revision and
 *  keep only well-formed ones — so evidence can never claim a revision it didn't run
 *  against, and a stale browser result can't sneak in under a new revision. */
export function stampResults(snap: SnapshotLike, results: unknown): ValidationResult[] {
  if (!Array.isArray(results)) return []
  const revision = worldRevision(snap)
  const ok = new Set(['passed', 'failed', 'unavailable'])
  const out: ValidationResult[] = []
  for (const r of results.slice(0, 40)) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const check = typeof o.check === 'string' ? o.check.slice(0, 60) : ''
    if (!check || !ok.has(o.status as string)) continue
    out.push({
      revision, check, status: o.status as ValidationResult['status'],
      environment: typeof o.environment === 'string' ? o.environment.slice(0, 60) : 'external',
      ...(typeof o.artifact === 'string' ? { artifact: o.artifact.slice(0, 400) } : {}),
      details: Array.isArray(o.details) ? o.details.map(d => String(d).slice(0, 300)).slice(0, 8) : [],
    })
  }
  return out
}

/** Merge new evidence into the ledger. The evaluator takes latest-per-check at the
 *  current revision; here we keep ALL current-revision evidence plus a bounded tail
 *  of prior-revision history (for debugging), capped so it can't grow forever. */
export function mergeEvidence(prev: ValidationResult[], add: ValidationResult[], currentRev: string): ValidationResult[] {
  const all = [...prev, ...add]
  const current = all.filter(e => e.revision === currentRev)
  const history = all.filter(e => e.revision !== currentRev).slice(-30)
  return [...history, ...current].slice(-200)
}

export function evaluateFromSnapshot(snap: SnapshotLike, extra: ValidationResult[] = []): BuildEvaluation {
  return evaluateBuild({
    spec: specFromSnapshot(snap),
    facts: worldFactsFromSnapshot(snap),
    revision: worldRevision(snap),
    evidence: [...getLedger(snap).evidence, ...extra],
  })
}
