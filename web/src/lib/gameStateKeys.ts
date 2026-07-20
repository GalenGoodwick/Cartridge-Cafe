// gameStateKeys.ts — the ONE list of worldData keys that are GAME/runtime state,
// shared by the server reset (lib/worldSave.ts) and the client R-key reset
// (FieldEngine). Pure constants, no imports, so the browser can use it too.
//
// A world's CONTENT (fields/visuals/hooks/modules snapshot arrays) and CONFIG
// (icon, instructions, flags) live outside this list and are never wiped.

/** Runtime/progress keys wiped on a reset. `game` is the unified holder new
 *  worlds should keep ALL their shared state under; the rest are legacy
 *  scattered keys kept clearable so anything built before this resets cleanly. */
export const GAME_STATE_KEYS: readonly string[] = [
  'game',                                            // ← the unified holder
  '__tg', '__trig', '__edge', '__chapters', '__fresh',
  'gpuUniforms', 'gpuPopulation', 'save2', 'music_mod', 'ai_focus',
  '__trail', '__nudge', '__budget',
  'last_hook_error', 'last_compile_error', '__hook_quarantined', '__hookError',
  'cellSample', 'hud',
]

/** CONFIG/CONTENT keys a reset must NEVER touch (the world itself). */
export const PRESERVED_KEYS: ReadonlySet<string> = new Set([
  'icon_wgsl', 'instructions', 'built_by', 'persist', 'postProcess', 'singlePlayer',
  'creation_brief', 'brief_done', 'built_notes', 'build_notes',
  '__sandbox', '__house_requested', '__resets', '__built_ua', '__built_at',
  '__bridge_rev', 'rResetKey', '__k', '__fixedStep', '__seed',
])
