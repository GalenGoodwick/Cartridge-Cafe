// Server-side in-memory field state store
// Uses globalThis to share state across Next.js API route modules
// Persists to disk so state survives server restarts

import type { FieldSnapshot, FieldMemoryEntry, WorldParams, InteractionRule, InteractionEffect, CustomCommand, SceneSnapshot } from '@/app/engine/types'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const MAX_MEMORY_ENTRIES = 100
const PERSIST_PATH = join(process.cwd(), '.engine-store.json')

/** Serialized step hook (no fn — just source code) */
export interface StepHookSnapshot {
  id: string
  author: string
  description: string
  code: string
}

/** Registered visual type for the superimposed uber-shader */
export interface VisualTypeDef {
  name: string
  wgsl: string
  timestamp: number
}

/** Registered uber-shader interaction definition */
export interface InteractionDef {
  name: string
  wgsl: string
  fieldA: string  // field ID
  fieldB: string  // field ID
  timestamp: number
}

/** Registered GLSL mod (reusable shader utility code) */
export interface GlslMod {
  id: string
  author: string
  description: string
  code: string       // Raw GLSL function/utility code
  timestamp: number
}

/** Registered shader module (WGSL utility functions for uber-shader) */
export interface ModuleDef {
  name: string
  wgsl: string
  timestamp: number
}

/** Named render target definition */
export interface RenderTargetDef {
  name: string
  timestamp: number
}

/** Per-field rendered pixel sample (16x16 downsampled RGBA) */
export interface RenderedSample {
  width: number
  height: number
  pixels: number[]  // flat RGBA, row-major
}

interface EngineStore {
  fieldSnapshots: Map<string, FieldSnapshot>
  lastSyncTime: number
  worldParams: WorldParams
  /** Shared mutable key-value store — any field can read/write */
  worldData: Record<string, unknown>
  /** Agent-defined interaction rules (persisted server-side) */
  interactionRules: InteractionRule[]
  /** Agent-defined interaction effects — GLSL shaders for overlap rendering */
  interactionEffects: InteractionEffect[]
  /** Agent-defined custom commands (persisted server-side) */
  customCommands: Map<string, CustomCommand>
  /** Active step hooks (synced from client) */
  stepHooks: StepHookSnapshot[]
  /** Per-field rendered pixel samples (from client readback, NOT persisted to disk) */
  renderedSamples: Record<string, RenderedSample>
  /** Registered GLSL mods — reusable shader utilities injected into all new compilations */
  glslMods: Map<string, GlslMod>
  /** Registered visual types for superimposed uber-shader (persisted) */
  visualTypes: Map<string, VisualTypeDef>
  /** Version history per visual type — previous versions for undo (persisted, max 5 per name) */
  visualTypeHistory: Map<string, VisualTypeDef[]>
  /** Registered uber-shader interaction definitions (persisted) */
  interactionDefs: Map<string, InteractionDef>
  /** Registered shader modules (persisted) */
  modules: Map<string, ModuleDef>
  /** Named render targets (persisted) */
  renderTargetDefs: Map<string, RenderTargetDef>
  /** Saved scenes — complete engine state snapshots */
  scenes: Map<string, SceneSnapshot>
  /** Writer lease — which client session may sync the global world (in-memory) */
  writerId?: string | null
  /** Last heartbeat from the lease holder (ms epoch) */
  writerSeen?: number
}

const DEFAULT_WORLD_PARAMS: WorldParams = {
  gravity: 0,
  friction: 0,
  collisionForce: 0,
  boundaryMode: 'open',
  bounciness: 0.5,
  gravitationalConstant: 0,
}

// --- Disk persistence ---

interface SerializedStore {
  fieldSnapshots: Record<string, FieldSnapshot>
  worldParams: WorldParams
  worldData: Record<string, unknown>
  interactionRules: InteractionRule[]
  interactionEffects?: InteractionEffect[]
  customCommands: Record<string, CustomCommand>
  stepHooks?: StepHookSnapshot[]
  glslMods?: Record<string, GlslMod>
  visualTypes?: Record<string, VisualTypeDef>
  visualTypeHistory?: Record<string, VisualTypeDef[]>
  interactionDefs?: Record<string, InteractionDef>
  modules?: Record<string, ModuleDef>
  renderTargetDefs?: Record<string, RenderTargetDef>
  scenes?: Record<string, SceneSnapshot>
  lastSyncTime: number
}

function loadFromDisk(): Partial<EngineStore> | null {
  try {
    const raw = readFileSync(PERSIST_PATH, 'utf-8')
    const data: SerializedStore = JSON.parse(raw)
    const fieldSnapshots = new Map<string, FieldSnapshot>()
    if (data.fieldSnapshots) {
      for (const [id, snap] of Object.entries(data.fieldSnapshots)) {
        fieldSnapshots.set(id, snap)
      }
    }
    const customCommands = new Map<string, CustomCommand>()
    if (data.customCommands) {
      for (const [name, cmd] of Object.entries(data.customCommands)) {
        customCommands.set(name, cmd)
      }
    }
    const glslMods = new Map<string, GlslMod>()
    if (data.glslMods) {
      for (const [id, mod] of Object.entries(data.glslMods)) {
        glslMods.set(id, mod)
      }
    }
    const visualTypes = new Map<string, VisualTypeDef>()
    if (data.visualTypes) {
      for (const [name, vt] of Object.entries(data.visualTypes)) {
        visualTypes.set(name, vt)
      }
    }
    const visualTypeHistory = new Map<string, VisualTypeDef[]>()
    if (data.visualTypeHistory) {
      for (const [name, history] of Object.entries(data.visualTypeHistory)) {
        visualTypeHistory.set(name, history)
      }
    }
    const interactionDefs = new Map<string, InteractionDef>()
    if (data.interactionDefs) {
      for (const [name, def] of Object.entries(data.interactionDefs)) {
        interactionDefs.set(name, def)
      }
    }
    const scenes = new Map<string, SceneSnapshot>()
    if (data.scenes) {
      for (const [name, scene] of Object.entries(data.scenes)) {
        scenes.set(name, scene)
      }
    }
    const modules = new Map<string, ModuleDef>()
    if (data.modules) {
      for (const [name, mod] of Object.entries(data.modules)) {
        modules.set(name, mod)
      }
    }
    const renderTargetDefs = new Map<string, RenderTargetDef>()
    if (data.renderTargetDefs) {
      for (const [name, rt] of Object.entries(data.renderTargetDefs)) {
        renderTargetDefs.set(name, rt)
      }
    }
    console.log(`[Engine Store] Restored from disk: ${fieldSnapshots.size} fields, ${data.interactionRules?.length || 0} rules, ${data.interactionEffects?.length || 0} ix effects, ${customCommands.size} commands, ${glslMods.size} mods, ${visualTypes.size} visual types, ${interactionDefs.size} interaction defs, ${modules.size} modules, ${renderTargetDefs.size} render targets, ${scenes.size} scenes, ${Object.keys(data.worldData || {}).length} worldData keys`)
    return {
      fieldSnapshots,
      lastSyncTime: data.lastSyncTime || 0,
      worldParams: data.worldParams || { ...DEFAULT_WORLD_PARAMS },
      worldData: data.worldData || {},
      interactionRules: data.interactionRules || [],
      interactionEffects: data.interactionEffects || [],
      customCommands,
      stepHooks: data.stepHooks || [],
      renderedSamples: {},
      glslMods,
      visualTypes,
      visualTypeHistory,
      interactionDefs,
      modules,
      renderTargetDefs,
      scenes,
    }
  } catch {
    // No file or invalid — start fresh
    return null
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

function schedulePersist(): void {
  if (persistTimer) return // already scheduled
  persistTimer = setTimeout(() => {
    persistTimer = null
    try {
      const data: SerializedStore = {
        fieldSnapshots: Object.fromEntries(store.fieldSnapshots),
        worldParams: store.worldParams,
        worldData: store.worldData,
        interactionRules: store.interactionRules,
        interactionEffects: store.interactionEffects,
        customCommands: Object.fromEntries(store.customCommands),
        stepHooks: store.stepHooks,
        glslMods: Object.fromEntries(store.glslMods),
        visualTypes: Object.fromEntries(store.visualTypes),
        visualTypeHistory: Object.fromEntries(store.visualTypeHistory),
        interactionDefs: Object.fromEntries(store.interactionDefs),
        modules: Object.fromEntries(store.modules),
        renderTargetDefs: Object.fromEntries(store.renderTargetDefs),
        scenes: Object.fromEntries(store.scenes),
        lastSyncTime: store.lastSyncTime,
      }
      writeFileSync(PERSIST_PATH, JSON.stringify(data), 'utf-8')
    } catch (err) {
      console.error('[Engine Store] Persist error:', err)
    }
  }, 2000) // debounce 2 seconds
}

// --- Singleton initialization ---

const globalStore = globalThis as unknown as { __engineStore: EngineStore }
if (!globalStore.__engineStore) {
  const restored = loadFromDisk()
  if (restored) {
    globalStore.__engineStore = restored as EngineStore
  } else {
    globalStore.__engineStore = {
      fieldSnapshots: new Map(),
      lastSyncTime: 0,
      worldParams: { ...DEFAULT_WORLD_PARAMS },
      worldData: {},
      interactionRules: [],
      interactionEffects: [],
      customCommands: new Map(),
      stepHooks: [],
      renderedSamples: {},
      glslMods: new Map(),
      visualTypes: new Map(),
      visualTypeHistory: new Map(),
      interactionDefs: new Map(),
      modules: new Map(),
      renderTargetDefs: new Map(),
      scenes: new Map(),
    }
  }
}
const store = globalStore.__engineStore
// Patch: if store was created before newer fields existed, add them
if (!store.worldParams) {
  store.worldParams = { ...DEFAULT_WORLD_PARAMS }
}
if (!store.worldData) {
  store.worldData = {}
}
if (!store.interactionRules) {
  store.interactionRules = []
}
if (!store.interactionEffects) {
  store.interactionEffects = []
}
if (!store.customCommands) {
  store.customCommands = new Map()
}
if (!store.stepHooks) {
  store.stepHooks = []
}
if (!store.renderedSamples) {
  store.renderedSamples = {}
}
if (!store.glslMods) {
  store.glslMods = new Map()
}
if (!store.visualTypes) {
  store.visualTypes = new Map()
}
if (!store.visualTypeHistory) {
  store.visualTypeHistory = new Map()
}
if (!store.interactionDefs) {
  store.interactionDefs = new Map()
}
if (!store.scenes) {
  store.scenes = new Map()
}
if (!store.modules) {
  store.modules = new Map()
}
if (!store.renderTargetDefs) {
  store.renderTargetDefs = new Map()
}

/** Full replace from client sync */
export function setFieldSnapshots(snapshots: FieldSnapshot[], worldParams?: WorldParams, stepHooks?: StepHookSnapshot[], worldData?: Record<string, unknown>, renderedSamples?: Record<string, RenderedSample>, interactionEffects?: InteractionEffect[], visualTypes?: Array<{ name: string; wgsl: string }>, modules?: Array<{ name: string; wgsl: string }>): void {
  store.fieldSnapshots.clear()
  for (const snap of snapshots) {
    store.fieldSnapshots.set(snap.id, snap)
  }
  if (worldParams) {
    store.worldParams = worldParams
  }
  if (stepHooks) {
    store.stepHooks = stepHooks
  }
  if (worldData) {
    // Merge client worldData into server store (client-side hook changes propagate)
    for (const [key, value] of Object.entries(worldData)) {
      if (value === null) {
        delete store.worldData[key]
      } else {
        store.worldData[key] = value
      }
    }
  }
  if (renderedSamples) {
    store.renderedSamples = renderedSamples
  }
  if (interactionEffects) {
    store.interactionEffects = interactionEffects
  }
  if (visualTypes && visualTypes.length > 0) {
    for (const vt of visualTypes) {
      store.visualTypes.set(vt.name, { name: vt.name, wgsl: vt.wgsl, timestamp: Date.now() })
    }
  }
  if (modules && modules.length > 0) {
    for (const m of modules) {
      store.modules.set(m.name, { name: m.name, wgsl: m.wgsl, timestamp: Date.now() })
    }
  }
  store.lastSyncTime = Date.now()
  schedulePersist()
}

/** Get rendered samples */
export function getRenderedSamples(): Record<string, RenderedSample> {
  return store.renderedSamples
}

/** Get rendered sample for a specific field */
export function getRenderedSample(fieldId: string): RenderedSample | undefined {
  return store.renderedSamples[fieldId]
}

/** Set step hooks from client sync */
export function setStepHooks(hooks: StepHookSnapshot[]): void {
  store.stepHooks = hooks
  schedulePersist()
}

/** Get step hooks */
export function getStepHooks(): StepHookSnapshot[] {
  return [...store.stepHooks]
}

/** Get world params */
export function getWorldParams(): WorldParams {
  return { ...store.worldParams }
}

/** Set world params server-side */
export function setWorldParamsStore(params: Partial<WorldParams>): void {
  Object.assign(store.worldParams, params)
  schedulePersist()
}

/** Get a single field snapshot */
export function getFieldSnapshot(id: string): FieldSnapshot | undefined {
  return store.fieldSnapshots.get(id)
}

/** Get all field snapshots */
export function getAllFieldSnapshots(): FieldSnapshot[] {
  return Array.from(store.fieldSnapshots.values())
}

/** Get full engine state with metadata */

/** Add a GLSL mod (server-side copy) */
export function addGlslMod(mod: GlslMod): void {
  store.glslMods.set(mod.id, mod)
  schedulePersist()
}

/** Remove a GLSL mod */
export function removeGlslMod(modId: string): boolean {
  const existed = store.glslMods.delete(modId)
  if (existed) schedulePersist()
  return existed
}

/** Get all GLSL mods */
export function getAllGlslMods(): GlslMod[] {
  return Array.from(store.glslMods.values())
}

/** Add/update a visual type (server-side persistence) — saves previous version to history */
export function addVisualType(name: string, wgsl: string): void {
  const existing = store.visualTypes.get(name)
  if (existing) {
    // Push current version to history before overwriting
    const history = store.visualTypeHistory.get(name) || []
    history.unshift(existing) // newest first
    if (history.length > 5) history.length = 5 // cap at 5 versions
    store.visualTypeHistory.set(name, history)
  }
  store.visualTypes.set(name, { name, wgsl, timestamp: Date.now() })
  schedulePersist()
}

/** Undo visual type — restore previous version from history. Returns restored WGSL or null. */
export function undoVisualType(name: string): VisualTypeDef | null {
  const history = store.visualTypeHistory.get(name)
  if (!history || history.length === 0) return null
  const previous = history.shift()! // pop newest from history
  store.visualTypes.set(name, previous)
  if (history.length === 0) {
    store.visualTypeHistory.delete(name)
  }
  schedulePersist()
  return previous
}

/** Get version history for a visual type */
export function getVisualTypeHistory(name: string): VisualTypeDef[] {
  return store.visualTypeHistory.get(name) || []
}

/** Remove a visual type */
export function removeVisualType(name: string): boolean {
  const existed = store.visualTypes.delete(name)
  store.visualTypeHistory.delete(name)
  if (existed) schedulePersist()
  return existed
}

/** Get all visual types */
export function getAllVisualTypes(): VisualTypeDef[] {
  return Array.from(store.visualTypes.values())
}

/** Add/update an interaction definition (server-side persistence) */
export function addInteractionDef(name: string, wgsl: string, fieldA: string, fieldB: string): void {
  store.interactionDefs.set(name, { name, wgsl, fieldA, fieldB, timestamp: Date.now() })
  schedulePersist()
}

/** Remove an interaction definition */
export function removeInteractionDef(name: string): boolean {
  const existed = store.interactionDefs.delete(name)
  if (existed) schedulePersist()
  return existed
}

/** Get all interaction definitions */
export function getAllInteractionDefs(): InteractionDef[] {
  return Array.from(store.interactionDefs.values())
}

/** Add/update a shader module (server-side persistence) */
export function addModule(name: string, wgsl: string): void {
  store.modules.set(name, { name, wgsl, timestamp: Date.now() })
  schedulePersist()
}

/** Remove a shader module */
export function removeModule(name: string): boolean {
  const existed = store.modules.delete(name)
  if (existed) schedulePersist()
  return existed
}

/** Get all shader modules */
export function getAllModules(): ModuleDef[] {
  return Array.from(store.modules.values())
}

/** Add a render target definition (server-side persistence) */
export function addRenderTargetDef(name: string): void {
  store.renderTargetDefs.set(name, { name, timestamp: Date.now() })
  schedulePersist()
}

/** Remove a render target definition */
export function removeRenderTargetDef(name: string): boolean {
  const existed = store.renderTargetDefs.delete(name)
  if (existed) schedulePersist()
  return existed
}

/** Get all render target definitions */
export function getAllRenderTargetDefs(): RenderTargetDef[] {
  return Array.from(store.renderTargetDefs.values())
}

export function getEngineState(): {
  fields: FieldSnapshot[]
  fieldCount: number
  lastSync: number
  lastSyncAgo: number
  worldParams: WorldParams
  worldData: Record<string, unknown>
  interactionRules: InteractionRule[]
  interactionEffects: InteractionEffect[]
  customCommands: CustomCommand[]
  stepHooks: StepHookSnapshot[]
  glslMods: GlslMod[]
  visualTypes: VisualTypeDef[]
  interactionDefs: InteractionDef[]
  modules: ModuleDef[]
  renderTargets: RenderTargetDef[]
} {
  return {
    fields: getAllFieldSnapshots(),
    fieldCount: store.fieldSnapshots.size,
    lastSync: store.lastSyncTime,
    lastSyncAgo: store.lastSyncTime ? Date.now() - store.lastSyncTime : -1,
    worldParams: getWorldParams(),
    worldData: getWorldData(),
    interactionRules: getInteractionRules(),
    interactionEffects: store.interactionEffects,
    customCommands: getAllCustomCommands(),
    stepHooks: getStepHooks(),
    glslMods: getAllGlslMods(),
    visualTypes: getAllVisualTypes(),
    interactionDefs: getAllInteractionDefs(),
    modules: getAllModules(),
    renderTargets: getAllRenderTargetDefs(),
  }
}

/** Writer lease for the global world. One client session holds the lease and
 *  heartbeats it via its 2s state sync; anyone else gets refused (409) so two
 *  tabs can't fight last-write-wins over the same world. The lease expires
 *  after 8s of silence, and `takeover` claims it explicitly. */
const WRITER_LEASE_MS = 8000
export function claimWriter(clientId: string, takeover = false): boolean {
  const now = Date.now()
  if (
    !store.writerId ||
    store.writerId === clientId ||
    takeover ||
    now - (store.writerSeen || 0) > WRITER_LEASE_MS
  ) {
    store.writerId = clientId
    store.writerSeen = now
    return true
  }
  return false
}

/** Get shared world data */
export function getWorldData(): Record<string, unknown> {
  return { ...store.worldData }
}

/** Set shared world data (merges keys — set value to null to delete a key) */
export function setWorldData(data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (value === null) {
      delete store.worldData[key]
    } else {
      store.worldData[key] = value
    }
  }
  schedulePersist()
}

/** Add an interaction rule (server-side copy) */
export function addInteractionRuleStore(rule: InteractionRule): string {
  const id = `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  store.interactionRules.push({ ...rule, id })
  schedulePersist()
  return id
}

/** Remove an interaction rule */
export function removeInteractionRuleStore(ruleId: string): void {
  store.interactionRules = store.interactionRules.filter(r => r.id !== ruleId)
  schedulePersist()
}

/** Get all interaction rules */
export function getInteractionRules(): InteractionRule[] {
  return [...store.interactionRules]
}

/** Add a custom command (server-side copy) */
export function addCustomCommandStore(cmd: CustomCommand): void {
  store.customCommands.set(cmd.name, cmd)
  schedulePersist()
}

/** Get a custom command */
export function getCustomCommandStore(name: string): CustomCommand | undefined {
  return store.customCommands.get(name)
}

/** Get all custom commands */
export function getAllCustomCommands(): CustomCommand[] {
  return Array.from(store.customCommands.values())
}

// ─── Command Response Channel ───
// Allows the browser (FieldEngine) to send results back to the bridge route
// after processing a command (e.g., shader compile results).

interface CommandWaiter {
  resolve: (result: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

const globalResponses = globalThis as unknown as {
  __commandResponses?: Map<string, unknown>
  __commandWaiters?: Map<string, CommandWaiter>
}
const commandResponses: Map<string, unknown> = globalResponses.__commandResponses ??= new Map()
const commandWaiters: Map<string, CommandWaiter> = globalResponses.__commandWaiters ??= new Map()

/** Post a result for a command (called by FieldEngine via agent route) */
export function postCommandResult(commandId: string, result: unknown): void {
  commandResponses.set(commandId, result)
  const waiter = commandWaiters.get(commandId)
  if (waiter) {
    clearTimeout(waiter.timer)
    commandWaiters.delete(commandId)
    waiter.resolve(result)
  }
  // Bounded cleanup
  if (commandResponses.size > 500) {
    const keys = [...commandResponses.keys()]
    for (let i = 0; i < 250; i++) commandResponses.delete(keys[i])
  }
}

/** Wait for a command result (called by bridge route after pushing define_visual) */
export function waitForCommandResult(commandId: string, timeoutMs: number = 8000): Promise<unknown | null> {
  const existing = commandResponses.get(commandId)
  if (existing !== undefined) {
    commandResponses.delete(commandId)
    return Promise.resolve(existing)
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      commandWaiters.delete(commandId)
      resolve(null) // Timeout — no response received
    }, timeoutMs)
    commandWaiters.set(commandId, { resolve, timer })
  })
}

/** Reset entire store — nuclear option */
export function resetStore(): void {
  store.fieldSnapshots.clear()
  store.worldParams = { ...DEFAULT_WORLD_PARAMS }
  store.worldData = {}
  store.interactionRules = []
  store.customCommands.clear()
  store.stepHooks = []
  store.glslMods.clear()
  store.visualTypes.clear()
  store.visualTypeHistory.clear()
  store.interactionDefs.clear()
  store.modules.clear()
  store.renderTargetDefs.clear()
  store.lastSyncTime = 0
  schedulePersist()
}

/** Append a memory entry to a field (server-side injection between syncs) */
export function appendMemory(fieldId: string, entry: FieldMemoryEntry): void {
  const snap = store.fieldSnapshots.get(fieldId)
  if (!snap) return
  snap.memory.push(entry)
  if (snap.memory.length > MAX_MEMORY_ENTRIES) {
    snap.memory.splice(0, snap.memory.length - MAX_MEMORY_ENTRIES)
  }
  schedulePersist()
}

// ─── Scene Persistence ───

/** Save a scene snapshot */
// ── Scene versioning: every save snapshots what it replaces ──────────────────
// Any edit (bridge, cartridge run, agent) that overwrites a scene first files
// the outgoing version under .engine-versions/<name>/<timestamp>.json.
// Nothing an AI does to a world is unrecoverable.
import { mkdirSync, readdirSync, unlinkSync, existsSync } from 'fs'
const VERSIONS_DIR = join(process.cwd(), '.engine-versions')
const MAX_VERSIONS = 30

function versionDir(name: string): string {
  return join(VERSIONS_DIR, name.replace(/[^a-zA-Z0-9 _-]/g, '_'))
}

function snapshotVersion(name: string, scene: SceneSnapshot): void {
  try {
    const dir = versionDir(name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, Date.now() + '.json'), JSON.stringify(scene))
    const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort()
    while (files.length > MAX_VERSIONS) unlinkSync(join(dir, files.shift()!))
  } catch (e) {
    console.error('[store] version snapshot failed:', e)
  }
}

/** List a scene's saved versions (newest first) */
export function listSceneVersions(name: string): { timestamp: number }[] {
  try {
    if (!existsSync(versionDir(name))) return []
    return readdirSync(versionDir(name))
      .filter(f => f.endsWith('.json'))
      .map(f => ({ timestamp: parseInt(f) }))
      .sort((a, b) => b.timestamp - a.timestamp)
  } catch { return [] }
}

/** Load one saved version of a scene */
export function loadSceneVersion(name: string, timestamp: number): SceneSnapshot | undefined {
  try {
    return JSON.parse(readFileSync(join(versionDir(name), timestamp + '.json'), 'utf8'))
  } catch { return undefined }
}

/** Revert a scene to a saved version (the current state is snapshotted first) */
export function revertScene(name: string, timestamp: number): boolean {
  const v = loadSceneVersion(name, timestamp)
  if (!v) return false
  saveScene(name, v)
  return true
}

export function saveScene(name: string, scene: SceneSnapshot): void {
  const prev = store.scenes.get(name)
  if (prev) snapshotVersion(name, prev)
  store.scenes.set(name, scene)
  schedulePersist()
}

/** Load a scene snapshot by name */
export function loadScene(name: string): SceneSnapshot | undefined {
  return store.scenes.get(name)
}

/** List all saved scene names */
export function listScenes(): string[] {
  return Array.from(store.scenes.keys())
}

/** Delete a saved scene */
export function deleteScene(name: string): boolean {
  const existed = store.scenes.delete(name)
  if (existed) schedulePersist()
  return existed
}

// ─── Game Save Slots ───
// Named progress saves for game cartridges — separate file from the world store
// so a corrupted world never takes the player's saves with it (and vice versa).

const SAVES_PATH = join(process.cwd(), '.engine-saves.json')
let gameSaves: Record<string, { data: unknown; savedAt: number }> | null = null

function loadSaves(): Record<string, { data: unknown; savedAt: number }> {
  if (gameSaves) return gameSaves
  try {
    gameSaves = JSON.parse(readFileSync(SAVES_PATH, 'utf-8'))
  } catch {
    gameSaves = {}
  }
  return gameSaves!
}

function persistSaves(): void {
  try { writeFileSync(SAVES_PATH, JSON.stringify(gameSaves ?? {})) } catch { /* disk write is best-effort */ }
}

/** Write a named game save slot */
export function saveGameSlot(slot: string, data: unknown): void {
  const saves = loadSaves()
  saves[slot] = { data, savedAt: Date.now() }
  persistSaves()
}

/** Read a named game save slot */
export function loadGameSlot(slot: string): unknown | undefined {
  return loadSaves()[slot]?.data
}

/** List all save slots with timestamps */
export function listGameSlots(): Array<{ slot: string; savedAt: number }> {
  const saves = loadSaves()
  return Object.keys(saves).map(k => ({ slot: k, savedAt: saves[k].savedAt }))
}

/** Delete a save slot */
export function deleteGameSlot(slot: string): boolean {
  const saves = loadSaves()
  if (!(slot in saves)) return false
  delete saves[slot]
  persistSaves()
  return true
}
