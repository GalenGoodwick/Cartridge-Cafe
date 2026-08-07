// engine/persistence/serialize.ts — P2 seam #1: the canonical world→snapshot
// serialization, extracted from FieldEngine where it was inlined at 4 subtly-
// different call sites (owner 2s-sync, version-save, branch-save, hot-load). One
// source of truth here means P1's incremental diffing and snapshot-bytes telemetry
// have exactly one place to live. Pure functions only — no React, no fetch.
import type { FieldSimulation } from '../simulation'
import type { FieldRenderer } from '../renderer'

export interface WgslEntry { name: string; wgsl: string }
export interface StepHookSnap { id: string; author: string; description: string; code: string }

/** Keys the live sim mutates every frame that must NEVER persist into a snapshot:
 *  input state (key_/mouse_) and the GPU population buffer (rebuilt each frame, so
 *  persisting it only bloats the payload). */
export function filterSyncWorldData(worldData: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(worldData).filter(([k]) => !k.startsWith('key_') && !k.startsWith('mouse_') && k !== 'gpuPopulation' && k !== 'save'),   // 'save' is PER-PLAYER (engine persist) — syncing it made one player's progress world-global (the Jul 30 leak)
  )
}

// ── SAVE STATES (the ROM/save-state architecture, DESIGN-save-states.md) ──────
// A world flagged `worldData.__saveArch = 'rom'` is treated like a cartridge in an
// emulator: the stored snapshot is the ROM (authored, written only by design
// actions), and every worldData key the live sim moves off the ROM baseline is the
// player's SAVE STATE — captured by the engine, per-user, no world cooperation.

/** Keys that are never save state: engine plumbing, per-frame render outputs,
 *  input, presence, and the design/registry keys that belong to the ROM itself. */
export const SAVE_STATE_DENY = new Set([
  'gpuUniforms', 'gpuPopulation', 'hud', 'save', 'persist', 'cellSample',
  '__play_sound', '__play_music', 'last_hook_error', 'last_compile_error',
  '__nodes', '__nodeStrict', '__rooms', '__bridge_rev', '__sandbox', '__budget',
  '__fresh', '__frameMeter', '__popProv', '__entities', '__clicks',
  '__saveArch', '__shared', 'instructions', 'vision', 'blurb', 'built_by',
  '__built_at', '__built_ua', 'renderScale', 'postProcess', 'maxBufferPixels',
  'noPixelSampling', 'singlePlayer', 'music_mod', 'ai_focus',
])

function saveStateEligible(k: string, shared: Set<string>): boolean {
  return !SAVE_STATE_DENY.has(k) && !shared.has(k) &&
    !k.startsWith('key_') && !k.startsWith('mouse_')
}

/** The world's declared class-2 keys (`worldData.__shared`) — shared/world-persistent
 *  by design (MOORING lanterns). They keep today's semantics: owner-synced into the
 *  shared snapshot, never captured per-player. */
export function sharedKeys(worldData: Record<string, unknown>): Set<string> {
  const raw = worldData['__shared']
  return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])
}

/** Capture the player's save state: every eligible key whose value has diverged from
 *  the ROM baseline (JSON-compared per key, stringified once each). Baseline-equal
 *  keys are omitted so a redeployed ROM shows through wherever the player never
 *  diverged — emulator savestate semantics with graceful ROM upgrades. */
export function captureSaveState(
  worldData: Record<string, unknown>,
  baseline: Record<string, string>,
  shared: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(worldData)) {
    if (!saveStateEligible(k, shared)) continue
    if (v === undefined) continue
    let ser: string
    try { ser = JSON.stringify(v) ?? '' } catch { continue }   // uncloneables never persist
    if (ser !== baseline[k]) out[k] = JSON.parse(ser)
  }
  return out
}

/** The ROM baseline: eligible keys of the just-applied snapshot worldData, pre-
 *  stringified for cheap per-key comparison in the capture loop. */
export function saveStateBaseline(
  worldData: Record<string, unknown>,
  shared: Set<string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(worldData)) {
    if (!saveStateEligible(k, shared)) continue
    try { const s = JSON.stringify(v); if (s !== undefined) out[k] = s } catch { /* skip */ }
  }
  return out
}

/** ROM protection for the owner 2s sync: strip everything that would be captured as
 *  save state, so the shared snapshot carries only ROM + declared-shared keys. This
 *  is the leak fix — player state stops circulating between tabs entirely. */
export function stripSaveState(
  worldData: Record<string, unknown>,
  baseline: Record<string, string>,
  shared: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(worldData)) {
    if (saveStateEligible(k, shared)) {
      let ser: string | undefined
      try { ser = JSON.stringify(v) ?? undefined } catch { ser = undefined }
      if (ser !== baseline[k]) continue          // diverged → player state → not ROM
    }
    out[k] = v
  }
  return out
}

/** Registered visuals as {name,wgsl}. `excludeBroken` drops quarantined shaders so a
 *  broken visual never circulates through the store (owner-sync + version-save do this;
 *  some read/branch paths deliberately keep them). */
export function serializeVisuals(renderer: FieldRenderer | null, excludeBroken: boolean): WgslEntry[] {
  if (!renderer) return []
  const all = renderer.getAllVisualTypes()
  const src = excludeBroken ? all.filter(vt => !(vt as { broken?: boolean }).broken) : all
  return src.map(vt => ({ name: vt.name, wgsl: vt.wgsl }))
}

export function serializeModules(renderer: FieldRenderer | null): WgslEntry[] {
  if (!renderer) return []
  return renderer.getAllModules().map(m => ({ name: m.name, wgsl: m.wgsl }))
}

export interface WorldSnapshotParts {
  fields: ReturnType<FieldSimulation['generateSnapshots']>
  worldParams: ReturnType<FieldSimulation['getWorldParams']>
  stepHooks: StepHookSnap[]
  worldData: Record<string, unknown>
  interactionEffects: FieldSimulation['interactionEffects']
  visualTypes: WgslEntry[]
  modules: WgslEntry[]
}

/** Canonical world→snapshot serialization. `stepHooks` is passed in because the host
 *  merges live-hook refs the sim itself doesn't own; `excludeBroken` and world-data
 *  filtering vary per call site, so they're explicit options rather than baked in. */
export function serializeWorld(
  sim: FieldSimulation,
  renderer: FieldRenderer | null,
  opts: { stepHooks: StepHookSnap[]; excludeBroken: boolean; filterWorldData?: boolean },
): WorldSnapshotParts {
  return {
    fields: sim.generateSnapshots(),
    worldParams: sim.getWorldParams(),
    stepHooks: opts.stepHooks,
    worldData: opts.filterWorldData === false ? { ...sim.worldData } : filterSyncWorldData(sim.worldData),
    interactionEffects: sim.interactionEffects,
    visualTypes: serializeVisuals(renderer, opts.excludeBroken),
    modules: serializeModules(renderer),
  }
}

/** A saved scene DOCUMENT — the branch/version-save shape (owner-sync's snapshot is
 *  a different, leaner shape). Carries name/timestamp/interactionRules and keeps FULL
 *  worldData. `visualScope` is the one real difference between the save sites:
 *   • 'used'      — only visuals attached to a field or named in a hook/worldData.
 *                   THE ORCHID FIX: the renderer registry is global (every visual from
 *                   every world this session), so a whole-registry grab scoops foreign
 *                   visuals into a branch. Keep only what this world references.
 *   • 'notBroken' — all except quarantined shaders (a broken shader must not circulate).
 *   • 'all'       — the whole registry verbatim. */
export interface SceneDocument {
  name: string
  fields: ReturnType<FieldSimulation['generateSnapshots']>
  worldParams: ReturnType<FieldSimulation['getWorldParams']>
  worldData: Record<string, unknown>
  stepHooks: StepHookSnap[]
  interactionRules: FieldSimulation['interactionRules']
  interactionEffects: FieldSimulation['interactionEffects']
  visualTypes: WgslEntry[]
  modules: WgslEntry[]
  timestamp: number
}

export function serializeSceneDocument(
  sim: FieldSimulation,
  renderer: FieldRenderer | null,
  opts: { name: string; stepHooks: StepHookSnap[]; visualScope: 'used' | 'notBroken' | 'all'; extraWorldData?: Record<string, unknown> },
): SceneDocument {
  const fields = sim.generateSnapshots()
  const worldData = { ...sim.worldData, ...(opts.extraWorldData || {}) }
  let visualTypes: WgslEntry[]
  if (opts.visualScope === 'used') {
    const used = new Set<string>()
    for (const f of fields) { const vn = (f as { visualTypeName?: string }).visualTypeName; if (vn) used.add(vn) }
    const hay = JSON.stringify(opts.stepHooks) + JSON.stringify(worldData)
    visualTypes = (renderer ? renderer.getAllVisualTypes() : []).filter(vt => used.has(vt.name) || hay.includes(vt.name)).map(vt => ({ name: vt.name, wgsl: vt.wgsl }))
  } else {
    visualTypes = serializeVisuals(renderer, opts.visualScope === 'notBroken')
  }
  return {
    name: opts.name,
    fields,
    worldParams: sim.getWorldParams(),
    worldData,
    stepHooks: opts.stepHooks,
    interactionRules: [...sim.interactionRules],
    interactionEffects: [...sim.interactionEffects],
    visualTypes,
    modules: serializeModules(renderer),
    timestamp: Date.now(),
  }
}

/** Teardown guard: skinned fields but ZERO visuals is a hot-reload transient (the
 *  renderer drops to 0 visuals for a beat during recompile), not a real state —
 *  persisting it renders every viewer DARK. Callers skip the sync when this is true. */
export function isTeardownSnapshot(
  fields: Array<{ visualType?: unknown; visualTypeName?: unknown }>,
  visualCount: number,
): boolean {
  return visualCount === 0 && fields.some(f => f.visualType || f.visualTypeName)
}

/** Serialized byte size — feeds the P0 snapshot-bytes readout and P1 diff sizing. */
export function snapshotBytes(parts: unknown): number {
  try { return JSON.stringify(parts).length } catch { return 0 }
}

// ── P1: content-addressed shader sync ──────────────────────────────────────
// The owner 2s-sync re-sent every visual/module's WGSL every time — but shaders
// rarely change while fields/worldData move. So hash each shader; if the server
// already holds that exact content (its stored snapshot), send just {name,hash}.
// The server resolves hash-only entries against its current snapshot; if a hash
// is unknown it asks for a resync of just those. Same hash fn both sides.

/** Stable FNV-1a-32 over the source, base36. Runs identically in browser + node. */
export function wgslHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36)
}

export type ShaderWire = { name: string; hash: string; wgsl?: string }

/** Client: turn full {name,wgsl} into wire entries — omit wgsl when `known` says the
 *  server already holds that content-hash for that name (→ tiny {name,hash}). */
export function diffShaders(entries: WgslEntry[], known: Map<string, string>): ShaderWire[] {
  return entries.map(e => {
    const hash = wgslHash(e.wgsl)
    return known.get(e.name) === hash ? { name: e.name, hash } : { name: e.name, hash, wgsl: e.wgsl }
  })
}

/** Client: the full name→hash map for a shader list (what the server holds after a
 *  successful sync). Stored so the next tick can send hash-only for unchanged shaders. */
export function shaderHashes(entries: WgslEntry[]): Map<string, string> {
  return new Map(entries.map(e => [e.name, wgslHash(e.wgsl)]))
}

/** Server: resolve wire entries to full {name,wgsl}, pulling unchanged shaders from the
 *  CURRENT stored snapshot (by name + hash match). Any hash it can't resolve → `missing`,
 *  so the caller asks the client to resend those (never stores an unresolvable reference). */
export function resolveShaders(
  incoming: ShaderWire[],
  current: WgslEntry[],
): { resolved: WgslEntry[]; missing: string[] } {
  const cur = new Map(current.map(v => [v.name, v.wgsl]))
  const resolved: WgslEntry[] = []
  const missing: string[] = []
  for (const e of incoming) {
    if (typeof e.wgsl === 'string') { resolved.push({ name: e.name, wgsl: e.wgsl }); continue }
    const w = cur.get(e.name)
    if (w !== undefined && wgslHash(w) === e.hash) { resolved.push({ name: e.name, wgsl: w }); continue }
    missing.push(e.name)
  }
  return { resolved, missing }
}
