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
  '__state',                                          // the game-state MANIFEST (DESIGN-game-state.md) — config, never reset
  // node-runtime INFRASTRUCTURE, not game progress: the registry is authored by
  // builders and NOT rebuilt by any hook — the generic `__`-prefix sweep was
  // deleting it on every R-reset (the recurring "__nodes WIPED" mystery,
  // root-caused Aug 9 2026 on veilfire-3d).
  '__nodes', '__nodeSeq', '__nodeStrict',
])

/** The game-state MANIFEST (DESIGN-game-state.md v1). A world declares where its
 *  state lives and its start baseline; the engine drives INIT + RESET off it.
 *  v1 fields only — persist/keepOnDeath (phase 2) are read-tolerant but unused
 *  here. Legacy-neutral: absent manifest ⇒ every function below is a no-op path
 *  and today's behavior holds byte-for-byte. */
export interface StateManifest {
  holder: string                 // the worldData key all game state lives under (e.g. '__vf')
  version?: number
  base?: Record<string, unknown> // the start state seeded into the holder on init/reset
  persist?: string[]             // phase 2 — declared, not yet driven
  keepOnDeath?: string[]         // phase 2 — declared, not yet driven
}

/** Read + shallow-validate a world's manifest. Returns null if absent or malformed
 *  (malformed ⇒ fall back to legacy behavior, never throw). The holder may not be a
 *  CONFIG/DERIVED key — state must be its OWN key, never engine infrastructure. */
export function stateManifestOf(wd: Record<string, unknown>): StateManifest | null {
  const m = wd?.__state
  if (!m || typeof m !== 'object') return null
  const holder = (m as Record<string, unknown>).holder
  if (typeof holder !== 'string' || !holder) return null
  if (PRESERVED_KEYS.has(holder) || DERIVED_KEYS.has(holder)) return null   // never let state alias infrastructure
  const base = (m as Record<string, unknown>).base
  return {
    holder,
    version: typeof (m as Record<string, unknown>).version === 'number' ? (m as Record<string, unknown>).version as number : undefined,
    base: (base && typeof base === 'object') ? base as Record<string, unknown> : undefined,
  }
}

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
  const man = stateManifestOf(wd)
  if (man && k === man.holder) return true            // the manifest's declared holder is ALWAYS progress (even a non-`__` name)
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
  const man = stateManifestOf(wd)
  const targets = new Set<string>(progressKeysOf(wd))
  for (const k of DERIVED_KEYS) if (k in wd) targets.add(k)
  for (const k of Object.keys(original)) targets.add(k)   // restore even keys not currently present
  if (man) targets.add(man.holder)                        // ensure the holder resets even if currently absent
  if (opts.clearPlayer && 'save' in wd) targets.add('save')
  const patch: Record<string, unknown> = {}
  for (const k of targets) {
    if (PRESERVED_KEYS.has(k)) continue
    if (!DERIVED_KEYS.has(k) && k in original) patch[k] = clone(original[k])   // restore original (the on-disk truth)
    else if (man && k === man.holder && man.base) patch[k] = clone(man.base)   // manifest base = the declared start (when no original covers it)
    else patch[k] = null                                                       // not in the original → not part of game start
  }
  return patch
}

/** INIT the game state at world load: seed the holder from the manifest `base`
 *  when it's absent, so hooks can trust `wd[holder]` exists instead of each
 *  hand-rolling `if (!wd.__vf) wd.__vf = {}`. Returns a set_world_data-style
 *  patch (empty when there's nothing to do). Legacy-neutral: no manifest ⇒ {}.
 *  Only seeds when ABSENT — never clobbers a loaded save or a live holder. */
export function initHolderPatch(wd: Record<string, unknown>): Record<string, unknown> {
  const man = stateManifestOf(wd)
  if (!man || !man.base) return {}
  if (wd[man.holder] != null) return {}                   // already present (loaded/live) — never overwrite
  return { [man.holder]: clone(man.base) }
}
