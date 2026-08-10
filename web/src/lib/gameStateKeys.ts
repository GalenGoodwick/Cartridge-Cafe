// gameStateKeys.ts — the ONE place that decides which worldData keys are GAME
// state, and the capture/restore logic for a world's ORIGINAL state. Pure
// functions, no imports, so both the server reset (lib/worldSave.ts) and the
// client R-key reset (FieldEngine) share EXACTLY this behavior.
//
// The category law:
//   PROGRESS — a world's own game state: __tg / __ga / __moor / __trig /
//              __chapters / the unified `game` holder … i.e. any `__`-prefixed
//              key that isn't CONFIG, plus a few named non-`__` holders. This is
//              what an "original" captures and a reset restores.
//   DERIVED  — rebuilt every frame (gpuUniforms, __budget, error scratch). Never
//              part of an original; always cleared on reset.
//   CONFIG   — the world itself (icon, instructions, flags, the __original blob).
//              NEVER touched by a reset.

/** CONFIG/CONTENT keys a reset must NEVER touch. */
export const PRESERVED_KEYS: ReadonlySet<string> = new Set([
  'icon_wgsl', 'instructions', 'built_by', 'persist', 'postProcess', 'singlePlayer',
  'multiplayer', 'creation_brief', 'brief_done', 'built_notes', 'build_notes',
  '__sandbox', '__house_requested', '__resets', '__built_ua', '__built_at',
  '__bridge_rev', 'rResetKey', '__k', '__fixedStep', '__seed',
  '__original',                                       // the captured original itself
  // node-runtime INFRASTRUCTURE, not game progress: the registry is authored by
  // builders and NOT rebuilt by any hook — the generic `__`-prefix sweep was
  // deleting it on every R-reset (the recurring "__nodes WIPED" mystery,
  // root-caused Aug 9 2026 on veilfire-3d).
  '__nodes', '__nodeSeq', '__nodeStrict',
])

/** Runtime keys rebuilt each frame — cleared on reset, never captured. */
export const DERIVED_KEYS: ReadonlySet<string> = new Set([
  'gpuUniforms', 'gpuPopulation', '__budget', '__fresh', '__trail', '__nudge',
  'cellSample', 'hud', 'last_hook_error', 'last_compile_error',
  '__hook_quarantined', '__hookError', 'music_mod', 'ai_focus', 'save2',
  // engine-convention per-frame publishes: the inspect-entity list, the
  // frame-cost ring, and population provenance are rebuilt continuously by
  // hooks/engine — capturing them baked runtime junk into set_original's
  // baseline (veilfire, Aug 9 2026).
  '__entities', '__frameMeter', '__popProv',
])

/** Named non-`__` game holders (the unified holder + legacy). __-prefixed
 *  progress keys are found generically; these are the exceptions to name. */
const NAMED_GAME_KEYS = ['game']

const isProgressKey = (wd: Record<string, unknown>, k: string): boolean => {
  if (PRESERVED_KEYS.has(k) || DERIVED_KEYS.has(k)) return false
  if (NAMED_GAME_KEYS.includes(k)) return true
  if (Array.isArray(wd.__resets) && (wd.__resets as string[]).includes(k)) return true
  return k.startsWith('__')                           // __tg, __ga, __moor, __trig, __chapters, __helios…
}

/** A world's PROGRESS keys (what an original captures / a reset restores),
 *  discovered generically so it works for ANY world's custom state key. */
export function progressKeysOf(wd: Record<string, unknown>): string[] {
  return Object.keys(wd || {}).filter(k => isProgressKey(wd, k))
}

const clone = (v: unknown): unknown => {
  try { return structuredClone(v) } catch { return v == null ? v : JSON.parse(JSON.stringify(v)) }
}

/** Snapshot the world's current PROGRESS state — the thing to stash as its
 *  original. Derived/config keys excluded. */
export function captureOriginal(wd: Record<string, unknown>): Record<string, unknown> {
  const orig: Record<string, unknown> = {}
  for (const k of progressKeysOf(wd)) orig[k] = clone(wd[k])
  return orig
}

/** ═══ THE RESET LAW (Galen, Aug 9 2026): a reset RESTORES `__original`. ═══
 *
 *  This is the ENGINE's single hard definition of "game start" — not a per-game
 *  convention. `set_original` (bridge verb; auto-fired at brief_done) is the ONE
 *  way to define it. A world with no baked original has the EMPTY original: every
 *  progress key clears and the hooks re-init their code defaults — which is the
 *  same operation, restore-from-{}. There is deliberately no second reset path.
 *
 *  The patch this returns is that restore: every progress key present in the
 *  world OR in the original is targeted; targets found in the original restore
 *  to their baked value, all others delete (`null` = delete, the documented
 *  set_world_data contract, honored by both the DB and the live sim). DERIVED
 *  keys always clear — runtime junk is never part of an original. */
export function resetPatch(wd: Record<string, unknown>, opts: { clearPlayer?: boolean } = {}): Record<string, unknown> {
  const original: Record<string, unknown> =
    (wd.__original && typeof wd.__original === 'object') ? wd.__original as Record<string, unknown> : {}
  const targets = new Set<string>(progressKeysOf(wd))
  for (const k of DERIVED_KEYS) if (k in wd) targets.add(k)
  for (const k of Object.keys(original)) targets.add(k)   // restore even keys not currently present
  if (opts.clearPlayer && 'save' in wd) targets.add('save')
  const patch: Record<string, unknown> = {}
  for (const k of targets) {
    if (PRESERVED_KEYS.has(k)) continue
    if (!DERIVED_KEYS.has(k) && k in original) patch[k] = clone(original[k])   // restore original
    else patch[k] = null                                                       // not in the original → not part of game start
  }
  return patch
}
