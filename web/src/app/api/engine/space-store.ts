import { prisma } from '@/lib/prisma'
import crypto from 'crypto'
import type { SceneSnapshot, InteractionRule, FieldMemoryEntry } from '@/app/engine/types'
import { loadScene, saveScene } from './store'   // scene path: branches live in the file store, not the DB

// --- In-memory cache for space snapshots ---

interface CachedSpace {
  snapshot: SceneSnapshot | null
  lastLoaded: number
}

const CACHE_TTL = 30_000 // 30s

const g = globalThis as unknown as {
  __spaceSnapshotCache?: Map<string, CachedSpace>
  __spacePersistTimers?: Map<string, ReturnType<typeof setTimeout>>
}
const cache: Map<string, CachedSpace> = g.__spaceSnapshotCache ??= new Map()
const persistTimers: Map<string, ReturnType<typeof setTimeout>> = g.__spacePersistTimers ??= new Map()

// --- Token validation ---

export async function validateSpaceToken(rawToken: string): Promise<{
  spaceId: string
  ownerId: string
  slug: string
  spaceName: string
} | null> {
  if (!rawToken.startsWith('uc_st_')) return null

  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')

  const token = await prisma.spaceToken.findUnique({
    where: { tokenHash },
    include: {
      space: {
        select: { id: true, ownerId: true, slug: true, name: true },
      },
    },
  })

  if (!token) return null
  if (token.revokedAt) return null
  if (token.expiresAt && token.expiresAt < new Date()) return null

  // Update lastUsedAt (fire-and-forget)
  prisma.spaceToken.update({
    where: { id: token.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {})

  return {
    spaceId: token.space.id,
    ownerId: token.space.ownerId,
    slug: token.space.slug,
    spaceName: token.space.name,
  }
}

// --- Snapshot load/save ---

export async function getSpaceSnapshot(spaceId: string, fresh = false): Promise<SceneSnapshot | null> {
  // Check cache first — UNLESS this is a read-modify-write (fresh=true). The
  // cache is per-lambda; on serverless a warm lambda can hold a stale snapshot
  // (missing what ANOTHER lambda just wrote). Mutating that stale copy and
  // writing it back silently DROPS the other lambda's commands — that's how a
  // world lost its robots visual/hook while keeping the arena. Reads for a MUTATE
  // must come from the DB.
  if (!fresh) {
    const cached = cache.get(spaceId)
    if (cached && Date.now() - cached.lastLoaded < CACHE_TTL) {
      return cached.snapshot
    }
  }

  const space = await prisma.playerSpace.findUnique({
    where: { id: spaceId },
    select: { snapshot: true },
  })

  const snapshot = (space?.snapshot as unknown as SceneSnapshot) ?? null

  cache.set(spaceId, { snapshot, lastLoaded: Date.now() })
  return snapshot
}

export async function setSpaceSnapshot(spaceId: string, snapshot: SceneSnapshot): Promise<void> {
  // SANDBOX INVARIANT (security): a player space is UNTRUSTED ground. Any
  // snapshot that carries JS hooks MUST be flagged __sandbox, always — so no
  // sequence of commands (e.g. add_step_hook then set_world_data {__sandbox:
  // null}) can persist a world whose hooks would then run on a visitor's main
  // thread with their cookies + same-origin fetch. This is the single choke
  // point every space write funnels through, so the rule can't be bypassed.
  // (The client ALSO sandboxes /space worlds by origin — belt and suspenders.)
  if (snapshot?.stepHooks?.length) {
    ;(snapshot.worldData as Record<string, unknown>) = { ...(snapshot.worldData || {}), __sandbox: true }
  }
  // Update cache immediately
  cache.set(spaceId, { snapshot, lastLoaded: Date.now() })

  // Persist NOW, awaited — a setTimeout debounce dies with the frozen lambda,
  // so a lone bridge command (one set_world_data, then silence) could return
  // ok:true and never reach the DB. Bursts still coalesce: while a write is
  // in flight, later snapshots just mark dirty and the tail write ships the
  // final state once — at most two DB writes per burst, none lost.
  const existing = persistTimers.get(spaceId)
  if (existing) clearTimeout(existing)   // clear any legacy timer (hot reload)
  const g2 = globalThis as unknown as { __spacePersistBusy?: Map<string, SceneSnapshot | true> }
  const busy = g2.__spacePersistBusy ??= new Map()
  if (busy.has(spaceId)) { busy.set(spaceId, snapshot); return }   // in flight — the tail write takes it
  busy.set(spaceId, true)
  try {
    for (;;) {
      await prisma.playerSpace.update({
        where: { id: spaceId },
        data: {
          snapshot: snapshot as unknown as Parameters<typeof prisma.playerSpace.update>[0]['data']['snapshot'],
          updatedAt: new Date(),
        },
      })
      const queued = busy.get(spaceId)
      if (queued === true || queued === undefined) break
      snapshot = queued            // a newer state arrived mid-write — ship it too
      busy.set(spaceId, true)
    }
  } catch (err) {
    console.error(`Failed to persist space ${spaceId}:`, err)
  } finally {
    busy.delete(spaceId)
  }
}

// --- World-family resolution (for the multi-AI Roundtable) ---
//
// A "family" is a root world plus every branch grown from it — the same set
// concurrent editors share. We walk parentSpaceId up to the root (like the
// ancestry route), then breadth-first down to gather every descendant. Each
// member carries its newest token use so a reader can tell which AIs are live.

// The family walk lives in lib/spaceTree (audit #12 — one provenance walk).
// Re-exported here so existing importers (bridge/route.ts) stay untouched.
export { familyOf as getSpaceFamily, type SpaceFamily } from '@/lib/spaceTree'

/** Invalidate cache for a space (e.g. after deletion) */
export function invalidateSpaceCache(spaceId: string): void {
  cache.delete(spaceId)
  const timer = persistTimers.get(spaceId)
  if (timer) {
    clearTimeout(timer)
    persistTimers.delete(spaceId)
  }
}

// --- Server-side command processing for space mode ---

// #5b: curated known-params per command. Unknown keys are surfaced as a
// (non-fatal) warning so a typo'd param stops silently vanishing.
const KNOWN_PARAMS: Record<string, Set<string>> = {
  create_field: new Set(['type', 'name', 'color', 'shape', 'shapeType', 'x', 'y', 'width', 'height', 'w', 'h', 'radius', 'scale', 'visualType', 'visualParams', 'tags', 'noHit', 'properties', 'parentFieldId', 'fieldId', 'renderTarget']),
  set_visual: new Set(['type', 'fieldId', 'visualType', 'visualParams', 'renderTarget', 'sampleTargets', 'renderOrder']),
  set_position: new Set(['type', 'fieldId', 'x', 'y', 'z', 'rotX', 'rotY']),
  set_color: new Set(['type', 'fieldId', 'color']),
  set_scale: new Set(['type', 'fieldId', 'scale']),
  set_world_data: new Set(['type', 'data']),
  define_visual: new Set(['type', 'name', 'wgsl']),
  define_module: new Set(['type', 'name', 'wgsl']),
  remove_module: new Set(['type', 'name']),
  add_interaction_effect: new Set(['type', 'wgsl', 'fieldA', 'fieldB', 'blend', 'spread', 'precedence', 'hooks', 'author', 'description', 'order']),
  remove_interaction_effect: new Set(['type', 'effectId']),
  clone_field: new Set(['type', 'fieldId', 'name', 'offsetX', 'offsetY']),
  delete_field: new Set(['type', 'fieldId']),
  move: new Set(['type', 'fieldId', 'dx', 'dy']),
  set_parent: new Set(['type', 'fieldId', 'parentFieldId']),
  set_shape: new Set(['type', 'fieldId', 'shape', 'shapeType', 'radius', 'w', 'h']),
  set_name: new Set(['type', 'fieldId', 'name']),
  add_tag: new Set(['type', 'fieldId', 'tags']),
  remove_tag: new Set(['type', 'fieldId', 'tags']),
  update_effect: new Set(['type', 'fieldId', 'effectId', 'wgsl', 'glsl', 'description', 'blend', 'feedback']),
  remove_interaction: new Set(['type', 'ruleId']),
}

function emptySnapshot(): SceneSnapshot {
  return {
    name: '',
    fields: [],
    worldParams: { gravity: 0, friction: 0.1, collisionForce: 50, boundaryMode: 'solid', bounciness: 0.5, gravitationalConstant: 0 },
    worldData: {},
    stepHooks: [],
    interactionRules: [],
    interactionEffects: [],
    visualTypes: [],
    modules: [],
    timestamp: Date.now(),
  }
}

/**
 * Apply a bridge command directly to a space's snapshot (server-side).
 * This allows Claude Code to work without a browser being open.
 * Returns the command result metadata (e.g. generated fieldId).
 */
/** Apply one build command to a snapshot OBJECT, in place, with NO I/O. This is
 *  the shared brain: the space path (DB-backed) and the scene path (file-store
 *  branches) both run through it, so a branch is edited by the exact same command
 *  semantics as a space — no divergent second implementation.
 *
 *  ── DELIBERATELY LIVE-ONLY commands (documented policy, not an accident) ──
 *  The snapshot can only persist what SceneSnapshot carries and what the loaders
 *  (space load / load_scene in FieldEngine) actually restore: fields, worldParams,
 *  worldData, stepHooks (JS), interactionRules, interactionEffects, visualTypes,
 *  modules. Everything below mutates live structures OUTSIDE that schema, is
 *  transient by design, is a read, or is handled by another server path — it
 *  relays to open tabs over SSE but intentionally does NOT persist here:
 *    · select, set_tool, set_camera — per-session UI/camera state
 *    · generate — UI generation flow; its output lands as add_effect (persisted)
 *    · inject_wgsl/inject_glsl, register_wgsl_mod/register_glsl_mod,
 *      remove_wgsl_mod/remove_glsl_mod — shader-mod registry has no snapshot
 *      section (global mode persists mods in the global store via the bridge)
 *    · apply_force — a physics impulse; transient by design
 *    · spawn_effect, spawn_projectile, clear_effects — pixel-buffer stamps and
 *      timed particles; pixel state is never snapshotted
 *    · add_gpu_step_hook/remove_gpu_step_hook — GPU hooks have no snapshot
 *      section (SceneSnapshot.stepHooks holds JS hooks only)
 *    · add_state_shader/remove_state_shader — renderer-global state shader, no
 *      snapshot section
 *    · define_command/execute_command — custom-command registry has no snapshot
 *      section; the bridge expands execute_command macros server-side
 *    · set_game_state/define_game_state — game-state machine, no snapshot section
 *    · add_timer/remove_timer/fire_event/add_collision_callback/
 *      remove_collision_callback/tween/cancel_tween — sim runtime structures,
 *      cleared on every load, no snapshot section
 *    · define_propagation — renderer propagation registry, no snapshot section
 *    · create_render_target/destroy_render_target — renderer target registry, no
 *      snapshot section (global mode persists them in the global store)
 *    · set_order (and set_visual's renderOrder param) — field.renderOrder is not
 *      serialized by generateSnapshots, so it cannot survive a reload anywhere
 *    · undo_visual — the snapshot keeps no visual history (in global mode the
 *      bridge rewrites it to define_visual with the restored WGSL)
 *    · save_world/save_scene/load_scene/list_scenes/delete_scene — scene-store
 *      operations with their own server routes
 *    · get_properties/sample_region/status/main_say/main_read/render_probe —
 *      reads / bridge-intercepted, nothing to persist */
export function applyCommandToSnapshotObject(
  snap: SceneSnapshot,
  cmd: Record<string, unknown>
): Record<string, unknown> {
  // snapshots built up from a blank brew (or written by older code) may lack
  // whole sections — every array the commands push into must exist
  const blank = emptySnapshot()
  const s = snap as unknown as Record<string, unknown>
  for (const k of ['fields', 'stepHooks', 'interactionRules', 'interactionEffects', 'visualTypes', 'modules'] as const) {
    if (!Array.isArray(s[k])) s[k] = (blank as unknown as Record<string, unknown>)[k]
  }
  if (!snap.worldData || typeof snap.worldData !== 'object') snap.worldData = blank.worldData
  const result: Record<string, unknown> = { type: cmd.type }

  switch (cmd.type) {
    case 'create_field': {
      const fieldId = `field_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const color = (cmd.color as [number, number, number, number]) ?? [1, 1, 1, 1]
      // Shape default follows what the field IS. This is a shader-composition
      // engine: a skinned field's real shape is its visual's ALPHA (the engine
      // reads back per-field pixel presence for pixel-perfect interaction), so
      // the geometric primitive is just the canvas the shader paints inside.
      // Defaulting a skinned field to a 20px circle shipped dot-sized worlds
      // (LATTICE). So:
      //   · skinned + no size given  → 'screen' (full-viewport canvas; alpha = shape)
      //   · explicit radius          → 'circle' (bounded, movable disc)
      //   · explicit w/h             → 'rect'   (bounded, movable box)
      //   · unskinned + nothing      → 'circle' r20 (a real physics primitive)
      const hasRadius = cmd.radius != null
      const hasWH = cmd.w != null || cmd.width != null || cmd.h != null || cmd.height != null
      const skinned = cmd.visualType != null
      const shape = (cmd.shape as string) ?? (
        hasRadius ? 'circle' : hasWH ? 'rect' : skinned ? 'screen' : 'circle'
      )
      snap.fields.push({
        id: fieldId,
        name: (cmd.name as string) ?? 'Unnamed',
        color,
        effects: [],
        transform: {
          x: (cmd.x as number) ?? 256,
          y: (cmd.y as number) ?? 256,
          rotation: 0,
          scale: (cmd.scale as number) ?? 1,
          vx: 0, vy: 0, vr: 0,
        },
        memory: [],
        proximity: [],
        shapeType: shape as 'circle' | 'rect' | 'screen',
        radius: (cmd.radius as number) ?? (shape === 'circle' ? 20 : undefined),
        w: (cmd.width as number) ?? (cmd.w as number) ?? (shape === 'rect' ? 50 : undefined),
        h: (cmd.height as number) ?? (cmd.h as number) ?? (shape === 'rect' ? 50 : undefined),
        visualTypeName: cmd.visualType as string | undefined,
        visualParams: cmd.visualParams as [number, number, number, number] | undefined,
        tags: cmd.tags as string[] | undefined,
        noHit: cmd.noHit as boolean | undefined,
        properties: cmd.properties as Record<string, unknown> | undefined,
      })
      result.fieldId = fieldId
      break
    }

    case 'delete_field': {
      const id = cmd.fieldId as string
      snap.fields = snap.fields.filter(f => f.id !== id)
      // a field's overlap shaders die with it — an orphaned interactionEffect
      // referencing a deleted field corrupts rendering (VEILFIRE went dark)
      snap.interactionEffects = snap.interactionEffects.filter(ix => {
        const e = ix as { fieldA?: string; fieldB?: string }
        return e.fieldA !== id && e.fieldB !== id
      })
      break
    }

    case 'remove_interaction_effect': {
      const eid = cmd.effectId as string
      if (eid) snap.interactionEffects = snap.interactionEffects.filter(ix => (ix as { id?: string }).id !== eid)
      break
    }

    case 'set_position': {
      const f = snap.fields.find(f => f.id === cmd.fieldId)
      if (f) {
        if (cmd.x != null) f.transform.x = cmd.x as number
        if (cmd.y != null) f.transform.y = cmd.y as number
        // 3D extras — the live engine sets these too and they ride the transform
        if (cmd.z !== undefined) f.transform.z = cmd.z as number
        if (cmd.rotX !== undefined) f.transform.rotX = cmd.rotX as number
        if (cmd.rotY !== undefined) f.transform.rotY = cmd.rotY as number
      }
      break
    }

    case 'move': {
      // relative nudge — live semantics are `x += dx, y += dy`
      const f = snap.fields.find(f => f.id === cmd.fieldId)
      if (!f) { result.error = `move: no field with id "${cmd.fieldId}"`; return result }
      f.transform.x += (cmd.dx as number) || 0
      f.transform.y += (cmd.dy as number) || 0
      break
    }

    case 'set_color': {
      const f = snap.fields.find(f => f.id === cmd.fieldId)
      if (f && cmd.color) f.color = cmd.color as [number, number, number, number]
      break
    }

    case 'set_scale': {
      const f = snap.fields.find(f => f.id === cmd.fieldId)
      if (f && cmd.scale != null) f.transform.scale = cmd.scale as number
      break
    }

    case 'set_shape': {
      const f = snap.fields.find(f => f.id === cmd.fieldId)
      if (!f) { result.error = `set_shape: no field with id "${cmd.fieldId}"`; return result }
      const shape = (cmd.shape ?? cmd.shapeType) as 'circle' | 'rect' | 'screen' | undefined
      if (shape) f.shapeType = shape
      if (cmd.radius !== undefined) f.radius = cmd.radius as number
      if (cmd.w !== undefined) f.w = cmd.w as number
      if (cmd.h !== undefined) f.h = cmd.h as number
      break
    }

    case 'set_name': {
      const f = snap.fields.find(f => f.id === cmd.fieldId)
      if (!f) { result.error = `set_name: no field with id "${cmd.fieldId}"`; return result }
      f.name = (cmd.name as string) || f.name
      break
    }

    case 'set_parent': {
      // mirror sim.setParent: parent must exist, no self-parent, no cycles,
      // hierarchy depth capped at 5
      const f = snap.fields.find(f => f.id === cmd.fieldId)
      if (!f) { result.error = `set_parent: no field with id "${cmd.fieldId}"`; return result }
      const pid = cmd.parentFieldId as string | undefined
      if (!pid) { f.parentFieldId = undefined; break }
      if (pid === f.id) { result.error = 'set_parent: cannot parent a field to itself'; return result }
      const byId = new Map(snap.fields.map(x => [x.id, x]))
      if (!byId.has(pid)) { result.error = `set_parent: no field with id "${pid}"`; return result }
      let cur: string | undefined = pid
      let hops = 0
      const seen = new Set<string>()
      while (cur) {
        if (cur === f.id) { result.error = 'set_parent: would create a cycle'; return result }
        if (seen.has(cur)) break
        seen.add(cur)
        hops++
        cur = byId.get(cur)?.parentFieldId
      }
      if (hops >= 5) { result.error = 'set_parent: depth limit (5) exceeded'; return result }
      f.parentFieldId = pid
      break
    }

    case 'add_tag': {
      const f = snap.fields.find(f => f.id === cmd.fieldId)
      const tags = cmd.tags as string[] | undefined
      if (!f || !tags?.length) { result.error = 'add_tag: fieldId and tags required'; return result }
      f.tags = f.tags ?? []
      for (const t of tags) if (!f.tags.includes(t)) f.tags.push(t)
      break
    }

    case 'remove_tag': {
      const f = snap.fields.find(f => f.id === cmd.fieldId)
      const tags = cmd.tags as string[] | undefined
      if (f?.tags && tags?.length) f.tags = f.tags.filter(t => !tags.includes(t))
      break
    }

    case 'set_property': {
      // Persist a field render property (the client already applies it live, but
      // it was lost on reload / never reached a headless build). The key one is
      // `superimpose: true` — that field draws OPAQUE (last-write-wins) over
      // whatever's behind it instead of alpha-blending, so a foreground field (a
      // pitch over a crowd) fully covers the backdrop instead of letting it bleed
      // through. Also: lighting, specular, bidirectionalBehind.
      const f = snap.fields.find(f => f.id === cmd.fieldId)
      const key = cmd.key as string | undefined
      if (f && key) {
        f.properties = { ...(f.properties as Record<string, unknown> | undefined), [key]: cmd.value }
      }
      break
    }

    case 'clone_field': {
      const src = snap.fields.find(f => f.id === cmd.fieldId)
      if (src) {
        const fieldId = `field_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        snap.fields.push({
          ...JSON.parse(JSON.stringify(src)),
          id: fieldId,
          name: (cmd.name as string) ?? `${src.name} (copy)`,
          transform: {
            ...src.transform,
            x: src.transform.x + ((cmd.offsetX as number) ?? 30),
            y: src.transform.y + ((cmd.offsetY as number) ?? 30),
          },
        })
        result.fieldId = fieldId
      }
      break
    }

    case 'reset': {
      // NUCLEAR by contract (guide: "clears everything") — the owner's
      // category-law reset is lib/worldSave.resetWorld, a different operation.
      snap.fields = []
      snap.stepHooks = []
      snap.interactionRules = []
      snap.interactionEffects = []
      snap.visualTypes = []
      snap.modules = []
      snap.worldData = {}
      snap.worldParams = emptySnapshot().worldParams
      break
    }

    case 'list_fields': {
      result.fields = snap.fields.map(f => ({
        id: f.id,
        name: f.name,
        x: f.transform.x,
        y: f.transform.y,
        color: f.color,
        shape: f.shapeType,
        visualType: f.visualTypeName,
      }))
      return result // read-only, no save needed
    }

    case 'define_visual': {
      if (!snap.visualTypes) snap.visualTypes = []
      const existing = snap.visualTypes.findIndex(v => v.name === cmd.name)
      if (existing >= 0) {
        snap.visualTypes[existing].wgsl = cmd.wgsl as string
      } else {
        snap.visualTypes.push({ name: cmd.name as string, wgsl: cmd.wgsl as string })
      }
      break
    }

    case 'remove_module': {
      if (snap.modules) snap.modules = snap.modules.filter(m => m.name !== cmd.name)
      break
    }

    case 'define_module': {
      if (!snap.modules) snap.modules = []
      const existing = snap.modules.findIndex(m => m.name === cmd.name)
      if (existing >= 0) {
        snap.modules[existing].wgsl = cmd.wgsl as string
      } else {
        snap.modules.push({ name: cmd.name as string, wgsl: cmd.wgsl as string })
      }
      break
    }

    case 'add_effect': {
      const f = snap.fields.find(f => f.id === cmd.fieldId)
      if (f) {
        f.effects.push({
          id: `fx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          author: 'claude-code',
          wgsl: cmd.wgsl as string,
          description: (cmd.description as string) ?? '',
          blend: (cmd.blend as 'alpha' | 'additive' | 'multiply') ?? 'alpha',
          order: f.effects.length,
          feedback: cmd.feedback as boolean | undefined,
        })
      }
      break
    }

    case 'remove_effect': {
      const f = snap.fields.find(f => f.id === cmd.fieldId)
      if (f && f.effects) f.effects = f.effects.filter(e => e.id !== (cmd.effectId as string))
      break
    }

    case 'update_effect': {
      // atomic in-place swap of an existing effect's shader (live compiles first;
      // headless we persist optimistically, same as add_effect)
      const f = snap.fields.find(f => f.id === cmd.fieldId)
      if (!f) { result.error = `update_effect: no field with id "${cmd.fieldId}"`; return result }
      const e = f.effects?.find(e => e.id === cmd.effectId)
      if (!e) { result.error = `update_effect: no effect "${cmd.effectId}" on field "${cmd.fieldId}"`; return result }
      const wgsl = (cmd.wgsl ?? cmd.glsl) as string | undefined
      if (!wgsl) { result.error = 'update_effect: wgsl required'; return result }
      e.wgsl = wgsl
      if (cmd.description) e.description = cmd.description as string
      if (cmd.blend) e.blend = cmd.blend as 'alpha' | 'additive' | 'multiply'
      if (cmd.feedback !== undefined) e.feedback = !!cmd.feedback
      break
    }

    case 'clear_effect': {
      // no fieldId = strip every field's stack, matching the live-engine command
      for (const f of snap.fields) {
        if (cmd.fieldId && f.id !== cmd.fieldId) continue
        if (f.effects) f.effects = []
      }
      break
    }

    case 'clear_all': {
      // live semantics: wipe painted pixel buffers + every field's effect stack;
      // fields themselves survive (unlike reset). Pixels aren't snapshotted, so
      // the persistable mirror is the all-fields effect wipe.
      for (const f of snap.fields) f.effects = []
      break
    }

    case 'set_world_params': {
      if (cmd.params) {
        snap.worldParams = { ...snap.worldParams, ...(cmd.params as Record<string, unknown>) } as SceneSnapshot['worldParams']
      }
      break
    }

    case 'set_world_data': {
      if (cmd.data) {
        snap.worldData = { ...snap.worldData, ...(cmd.data as Record<string, unknown>) }
        // documented contract: a null value DELETES the key (the live-sim path
        // honors this; the DB path was persisting literal nulls instead)
        for (const [k, v] of Object.entries(cmd.data as Record<string, unknown>)) {
          if (v === null) delete (snap.worldData as Record<string, unknown>)[k]
        }
      }
      break
    }

    case 'remove_step_hook': {
      // live engine accepts `name` as an alias for hookId — mirror that
      const hookId = (cmd.hookId as string) || (cmd.name as string) || ''
      snap.stepHooks = snap.stepHooks.filter(h => h.id !== hookId)
      break
    }

    case 'add_step_hook':
    case 'update_step_hook': {
      // Same hookId REPLACES — without this, every re-push of a hook appended a
      // duplicate and all of them ran each frame (one agent stacked 49 physics
      // hooks before noticing). Omitting hookId still appends a fresh one.
      // update_step_hook is the live engine's explicit replace spelling — the
      // persisted semantics are identical (live also aliases `name` → hookId).
      const hookId = (cmd.hookId as string) || (cmd.name as string) || `hook_${Date.now()}`
      snap.stepHooks = snap.stepHooks.filter(h => h.id !== hookId)
      snap.stepHooks.push({
        id: hookId,
        author: (cmd.author as string) ?? 'claude-code',
        description: (cmd.description as string) ?? '',
        code: cmd.code as string,
      })
      // A space token is an UNTRUSTED author (AI / player build). Flag the world
      // so every visitor runs its JS hooks in the sealed Worker sandbox, never on
      // the main thread. This is what makes "allow JS hooks" safe on a public site.
      ;(snap.worldData as Record<string, unknown>).__sandbox = true
      break
    }

    case 'define_interaction': {
      if (cmd.rule) {
        const rule = cmd.rule as Record<string, unknown>
        snap.interactionRules.push({
          id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          definedBy: (rule.definedBy as string) ?? 'claude-code',
          trigger: (rule.trigger as 'overlap' | 'proximity' | 'always') ?? 'overlap',
          triggerDistance: rule.triggerDistance as number | undefined,
          fieldA: rule.fieldA as string | undefined,
          fieldB: rule.fieldB as string | undefined,
          effect: (rule.effect as InteractionRule['effect']) ?? 'apply_force',
          effectParams: (rule.effectParams as Record<string, unknown>) ?? {},
          description: rule.description as string | undefined,
        })
      }
      break
    }

    case 'remove_interaction': {
      const rid = cmd.ruleId as string
      if (rid) snap.interactionRules = snap.interactionRules.filter(r => r.id !== rid)
      break
    }

    case 'field_message': {
      // the live engine writes the exchange into BOTH fields' memory (which is
      // part of the field snapshot); the dialog overlay itself is UI-only
      const fromId = cmd.fromFieldId as string
      const toId = cmd.toFieldId as string
      const from = snap.fields.find(f => f.id === fromId)
      const to = snap.fields.find(f => f.id === toId)
      const fromName = from?.name || fromId
      const toName = to?.name || toId
      const MAX_MEMORY = 100   // FieldSimulation.MAX_MEMORY
      const remember = (f: typeof from, entry: FieldMemoryEntry) => {
        if (!f) return
        f.memory = [...(f.memory ?? []), entry].slice(-MAX_MEMORY)
      }
      remember(from, {
        timestamp: new Date().toISOString(),
        type: 'message_sent',
        content: `Sent to ${toName}: "${cmd.content}"`,
        sourceFieldId: toId,
        data: cmd.data as Record<string, unknown> | undefined,
      })
      remember(to, {
        timestamp: new Date().toISOString(),
        type: 'message_received',
        content: `From ${fromName}: "${cmd.content}"`,
        sourceFieldId: fromId,
        data: cmd.data as Record<string, unknown> | undefined,
      })
      break
    }

    case 'add_interaction_effect': {
      if (cmd.wgsl) {
        snap.interactionEffects.push({
          id: `ix_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          wgsl: cmd.wgsl as string,
          fieldA: cmd.fieldA as string | undefined,
          fieldB: cmd.fieldB as string | undefined,
          blend: (cmd.blend as string) ?? 'alpha',
          spread: (cmd.spread as number) ?? 0,
          precedence: (cmd.precedence as boolean) ?? false,
          hooks: cmd.hooks as unknown[] | undefined,
          author: (cmd.author as string) ?? 'bridge',
          description: cmd.description as string | undefined,
          order: (cmd.order as number) ?? 0,
        } as (typeof snap.interactionEffects)[number])
      }
      break
    }

    case 'create_portal': {
      const targetSlug = cmd.targetSlug as string
      if (!targetSlug) { result.error = 'targetSlug required'; return result }
      const targetName = (cmd.targetName as string) || targetSlug
      const fieldId = `field_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

      // Ensure portal visual type is in the snapshot (so it gets registered on load)
      if (!snap.visualTypes) snap.visualTypes = []
      if (!snap.visualTypes.some(v => v.name === 'portal')) {
        snap.visualTypes.push({
          name: 'portal',
          wgsl: `fn visual_portal(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f {
  let a = smoothstep(0.5, -0.5, sdf);
  if (a < 0.01) { return vec4f(0.0); }
  let pol = polar(uv);
  let swirl = pol.y + pol.x * 3.0 - time * 2.0;
  let spiralCount = 3.0 + p.x * 3.0;
  let spiral = 0.5 + 0.5 * sin(swirl * spiralCount);
  let tunnel = exp(-pol.x * 2.0);
  let n = fbm(uv * 4.0 + time * 0.3, 3);
  let rimVal = ring(uv, 0.7, 0.15);
  let c = col.rgb * spiral * (0.5 + n * 0.5) + col.rgb * rimVal * 2.0;
  let centerMask = tunnel * 0.6;
  let finalC = mix(c, behind.rgb, centerMask * behind.a);
  return vec4f(finalC, a * col.a);
}`,
        })
      }

      snap.fields.push({
        id: fieldId,
        name: `Portal to ${targetName}`,
        color: [0.133, 0.827, 0.933, 1.0],
        effects: [],
        transform: {
          x: (cmd.x as number) ?? 256,
          y: (cmd.y as number) ?? 256,
          rotation: 0, scale: (cmd.scale as number) ?? 1,
          vx: 0, vy: 0, vr: 0,
        },
        memory: [],
        proximity: [],
        shapeType: 'circle',
        radius: (cmd.radius as number) ?? 30,
        visualTypeName: 'portal',
        visualParams: [0.5, 0, 0, 0],
        properties: { portalTarget: targetSlug, portalType: 'space' },
      })
      result.fieldId = fieldId
      break
    }

    case 'set_visual': {
      // THE binding that was silently lost headless: attach a registered visual
      // to an existing field so it actually renders (persisted, no browser needed).
      const f = snap.fields.find(f => f.id === cmd.fieldId)
      if (!f) { result.error = `set_visual: no field with id "${cmd.fieldId}"`; return result }
      const vt = cmd.visualType
      if (typeof vt === 'string') {
        f.visualTypeName = vt
        delete f.visualType   // numeric ids are per-session; the NAME is authoritative on load
      } else if (vt === null) {
        delete f.visualTypeName
        delete f.visualType
      }
      // (a bare numeric visualType is a session-local id — nothing durable to persist)
      if (cmd.visualParams !== undefined) {
        f.visualParams = cmd.visualParams as [number, number, number, number]
      }
      // renderTarget / sampleTargets live in field.properties (that's where the
      // live engine puts them, and properties round-trip through the snapshot)
      if (cmd.renderTarget !== undefined) {
        const props = { ...(f.properties as Record<string, unknown> | undefined) }
        if (cmd.renderTarget === null) delete props.renderTarget
        else props.renderTarget = cmd.renderTarget
        f.properties = props
      }
      if (cmd.sampleTargets !== undefined) {
        const props = { ...(f.properties as Record<string, unknown> | undefined) }
        if (cmd.sampleTargets === null) delete props.sampleTargets
        else props.sampleTargets = cmd.sampleTargets
        f.properties = props
      }
      // NOTE: renderOrder is accepted live but not serialized by the engine's
      // snapshot format — see the live-only list in the function doc.
      break
    }

    default:
      // Unknown command — no server-side processing, just pass through to SSE
      return result
  }

  // #5b: surface unknown/typo'd params (non-fatal) — a silent drop becomes visible
  const known = KNOWN_PARAMS[cmd.type as string]
  if (known) {
    const unknown = Object.keys(cmd).filter(k => !known.has(k))
    if (unknown.length) result.warnings = [`unknown params ignored: ${unknown.join(', ')}`]
  }

  // #6: echo the AUTHORITATIVE resulting field so the agent can verify the change
  // persisted (a bare {ok:true} hid a set_visual that never bound its visualType).
  const affectedId = (result.fieldId as string) || (cmd.fieldId as string)
  if (affectedId) {
    const f = snap.fields.find(f => f.id === affectedId)
    if (f) result.field = {
      id: f.id, name: f.name, visualType: f.visualTypeName ?? null,
      x: f.transform.x, y: f.transform.y, scale: f.transform.scale,
      shape: f.shapeType, w: f.w, h: f.h, radius: f.radius, color: f.color,
    }
  }
  if (cmd.type === 'define_visual') {
    result.visual = { name: cmd.name, registered: !!snap.visualTypes?.some(v => v.name === cmd.name) }
  }

  snap.timestamp = Date.now()
  return result
}

/** The EYE on the space path. Scene branches auto-version on every store write,
 *  but a space token writes straight into the PlayerSpace DB row — an AI could
 *  reshape a world all afternoon and leave no save point behind. This watcher
 *  cuts a SpaceVersion at BURST BOUNDARIES: when a write arrives and the row
 *  has sat settled longer than the gap, the settled state is versioned before
 *  the new burst lands. Serverless-safe (no timers — the next burst is the
 *  trigger), deduped byte-identical, fire-and-forget off the write path. */
const EYE_BURST_GAP_MS = 5 * 60 * 1000
const eyeChecked: Map<string, number> = (g as unknown as { __spaceEyeChecked?: Map<string, number> }).__spaceEyeChecked ??= new Map()

async function eyeOnSpace(spaceId: string): Promise<void> {
  const now = Date.now()
  if (now - (eyeChecked.get(spaceId) || 0) < EYE_BURST_GAP_MS) return   // mid-burst: skip cheaply
  eyeChecked.set(spaceId, now)
  const space = await prisma.playerSpace.findUnique({
    where: { id: spaceId },
    select: { updatedAt: true, snapshot: true },
  })
  if (!space?.snapshot) return
  if (now - space.updatedAt.getTime() < EYE_BURST_GAP_MS) return        // previous burst hasn't settled yet
  const sn = space.snapshot as unknown as { fields?: unknown[]; stepHooks?: unknown[]; visualTypes?: unknown[] }
  if (!(sn.fields?.length || sn.stepHooks?.length || sn.visualTypes?.length)) return   // blank world — nothing to keep
  const latest = await prisma.spaceVersion.findFirst({
    where: { spaceId },
    orderBy: { version: 'desc' },
    select: { version: true, snapshot: true },
  })
  if (latest && JSON.stringify(latest.snapshot) === JSON.stringify(space.snapshot)) return   // already saved
  await prisma.spaceVersion.create({
    data: {
      spaceId,
      version: (latest?.version || 0) + 1,
      snapshot: space.snapshot,
      note: 'the eye — settled burst',
    },
  })
}

/** SPACE path: load the PlayerSpace's DB snapshot → apply → persist. */
export async function applyCommandToSnapshot(
  spaceId: string,
  cmd: Record<string, unknown>
): Promise<Record<string, unknown>> {
  eyeOnSpace(spaceId).catch(() => {})   // burst boundary? version the settled world first
  const snap = (await getSpaceSnapshot(spaceId, true)) ?? emptySnapshot()   // fresh: never mutate a stale cache
  const result = applyCommandToSnapshotObject(snap, cmd)
  // Bridge revision: a monotonic counter every bridge write bumps. A tab's own
  // 2s sync round-trips it unchanged, so `server rev > tab rev` means exactly
  // one thing: an AI wrote something this tab never ingested. The tab's
  // auto-load watcher polls it (snapshot?rev=1) and hot-reloads the world —
  // no more stale tab silently syncing an old world back over a fresh build.
  const wd = (snap.worldData ??= {}) as Record<string, unknown>
  wd.__bridge_rev = (Number(wd.__bridge_rev) || 0) + 1
  await setSpaceSnapshot(spaceId, snap)
  return result
}

/** SCENE path: a branch lives in the file scene-store (no DB row), so it can't
 *  ride the space snapshot machinery. Load THIS scene → apply → save (the store
 *  auto-versions on write, which is the eye). Headless and isolated: it touches
 *  ONLY the named scene — never the global registry, never main. This is what a
 *  branch-scoped token uses so a connected AI can never overwrite another world. */
export function applyCommandToScene(
  sceneName: string,
  cmd: Record<string, unknown>
): Record<string, unknown> {
  const snap = loadScene(sceneName) ?? emptySnapshot()
  const result = applyCommandToSnapshotObject(snap, cmd)
  saveScene(sceneName, snap)
  return result
}
