import { prisma } from '@/lib/prisma'
import crypto from 'crypto'
import type { SceneSnapshot, InteractionRule, FieldMemoryEntry } from '@/app/engine/types'
import { autoRegisterHook } from '@/app/engine/node-autoregister'   // node-runtime rung 3: every hook auto-becomes a node
import { canPush, stampHold, canRelease, holdStatus, type NodeRecord } from '@/app/engine/node-gate'   // the HARD access pathway: a held node rejects a foreign push
import { appendNodeRev, capWorldHistory, historyMeta, findRevertTarget, markRevBad, shouldAutoRevert, type NodeHist } from '@/lib/node-dock'   // co-build: per-node version chains + revert
import { mayWritePolicy } from '@/lib/world-policy'   // the immutable social contract
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
  tokenName: string | null
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
    tokenName: token.name ?? null,
  }
}

// ── RUNG 2 (co-build): runtime errors heal the node, never the builder's hope.
// The live sandbox reports hook errors (hook-errors route) → each report on a
// FRESH push (probation window) counts against that (node, rev). At the
// threshold the node AUTO-REVERTS to its last good version — the bad rev is
// marked and never a future target. A node with no good ancestor stays put
// (its error chain is the builder's breadcrumb); the world never loses it.
export const NODE_ERR_PROBATION_MS = 30 * 60_000   // only a fresh push is on probation

/** Pure core: account one error against the node's CURRENT rev; auto-revert at
 *  threshold. Mutates snap. Returns what happened (for telemetry/feed). */
export function noteNodeError(
  snap: SceneSnapshot,
  hookId: string,
  now: number,
): { counted?: number; reverted?: number; noAncestor?: boolean } {
  const wd = snap.worldData as Record<string, unknown>
  const hist = (wd.__nodeHist && typeof wd.__nodeHist === 'object' ? wd.__nodeHist : null) as NodeHist | null
  const chain = hist?.[hookId] ?? []
  const cur = chain[chain.length - 1]
  if (!cur) return {}
  if (now - cur.at > NODE_ERR_PROBATION_MS) return {}   // an old, settled rev isn't on probation
  const errs = (wd.__nodeErrs && typeof wd.__nodeErrs === 'object' ? wd.__nodeErrs : (wd.__nodeErrs = {})) as Record<string, { rev: number; n: number }>
  const e = errs[hookId]?.rev === cur.rev ? errs[hookId] : (errs[hookId] = { rev: cur.rev, n: 0 })
  e.n++
  if (!shouldAutoRevert(e.n)) return { counted: e.n }
  const r = applyCommandToSnapshotObject(snap, {
    type: 'node_revert', id: hookId,
    reason: `auto: ${e.n} errors on rev ${cur.rev}`,
    __holder: 'auto-heal', __now: now, __admin: true,
  })
  delete errs[hookId]
  if (r.ok !== true) return { counted: e.n, noAncestor: true }
  return { counted: e.n, reverted: Number(r.revertedTo) }
}

/** SHADER VERSIONING (rung 2, visuals half): every landed define_visual /
 *  define_module appends a rev under 'visual:<name>' / 'module:<name>' in the
 *  same __nodeHist chain hooks use — one history, one budget, one heal law. */
export function appendShaderRev(snap: SceneSnapshot, kind: 'visual' | 'module', name: string, wgsl: string, cmd: Record<string, unknown>): void {
  const wd = snap.worldData as Record<string, unknown>
  const hist = (wd.__nodeHist && typeof wd.__nodeHist === 'object' ? wd.__nodeHist : (wd.__nodeHist = {})) as NodeHist
  const key = `${kind}:${name}`
  const last = (hist[key] ?? [])[hist[key]?.length - 1]
  appendNodeRev(hist, key, {
    rev: (Number(last?.rev) || 0) + 1,
    code: wgsl,
    at: Number(cmd.__now ?? Date.now()),
    // prefer the VERIFIED account (cmd.__by, route-stamped) over the token hash
    by: String(cmd.__by ?? cmd.__holder ?? '') || 'anon',
  })
  capWorldHistory(hist)
}

/** VERIFIED ATTRIBUTION (Galen Sep 1): record WHO made / last touched each thing
 *  in a flat, queryable `worldData.__provenance` map — keyed `field:<id>` /
 *  `visual:<name>` / `module:<name>` / `node:<hookId>`. `by` is the route-stamped,
 *  un-spoofable identity (a crew member's @handle, or 'owner'), never the
 *  client-supplied author. Answers "who added this?" for real, per-thing. */
export function stampProv(snap: SceneSnapshot, key: string, cmd: Record<string, unknown>): void {
  const wd = snap.worldData as Record<string, unknown>
  const by = String((cmd.__by ?? cmd.__holder ?? '') || 'anon')
  const at = Number(cmd.__now ?? Date.now())
  const prov = (wd.__provenance && typeof wd.__provenance === 'object' ? wd.__provenance : (wd.__provenance = {})) as Record<string, { by: string; at: number; lastBy: string; lastAt: number; edits: number }>
  const e = prov[key]
  if (!e) prov[key] = { by, at, lastBy: by, lastAt: at, edits: 1 }   // creator kept; last editor tracked
  else { e.lastBy = by; e.lastAt = at; e.edits = (Number(e.edits) || 1) + 1 }
}

/** A QUARANTINED shader heals to last-good instead of being stripped (the
 *  doggo-bounce fix). A WGSL compile failure is deterministic, so ONE report
 *  triggers the heal — no threshold wait. The bad rev is marked; the restore
 *  lands forward through define_visual/define_module (history is append-only).
 *  No good ancestor → the shader stays put; quarantine benches it live but the
 *  registry never loses it. */
export function noteShaderError(
  snap: SceneSnapshot,
  kind: 'visual' | 'module',
  name: string,
  now: number,
): { reverted?: number; noAncestor?: boolean } {
  const wd = snap.worldData as Record<string, unknown>
  const hist = (wd.__nodeHist && typeof wd.__nodeHist === 'object' ? wd.__nodeHist : null) as NodeHist | null
  const key = `${kind}:${name}`
  const chain = hist?.[key] ?? []
  const cur = chain[chain.length - 1]
  if (!cur) return {}
  if (now - cur.at > NODE_ERR_PROBATION_MS) return {}   // settled shaders never auto-move
  markRevBad(hist!, key, cur.rev)
  const target = findRevertTarget(hist!, key, cur.rev)
  if (!target) return { noAncestor: true }
  const r = applyCommandToSnapshotObject(snap, {
    type: kind === 'visual' ? 'define_visual' : 'define_module',
    name, wgsl: target.code,
    __holder: 'auto-heal', __now: now, __admin: true,
  })
  if (r.ok === false) return { noAncestor: true }
  return { reverted: target.rev }
}

export async function recordShaderError(spaceId: string, kind: 'visual' | 'module', name: string): Promise<{ reverted?: number; noAncestor?: boolean }> {
  const snap = await getSpaceSnapshot(spaceId, true)
  if (!snap) return {}
  const out = noteShaderError(snap, kind, name, Date.now())
  if (out.reverted !== undefined || out.noAncestor) await setSpaceSnapshot(spaceId, snap)
  return out
}

/** The async wrapper hook-errors calls: fresh read-modify-write on the space. */
export async function recordNodeError(spaceId: string, hookId: string): Promise<{ counted?: number; reverted?: number; noAncestor?: boolean }> {
  const snap = await getSpaceSnapshot(spaceId, true)
  if (!snap) return {}
  const out = noteNodeError(snap, hookId, Date.now())
  if (out.counted !== undefined) await setSpaceSnapshot(spaceId, snap)
  return out
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
  create_field: new Set(['type', 'name', 'color', 'shape', 'shapeType', 'x', 'y', 'width', 'height', 'w', 'h', 'radius', 'scale', 'visualType', 'visualParams', 'tags', 'noHit', 'noCollide', 'pixelCollide', 'properties', 'parentFieldId', 'fieldId', 'renderTarget']),
  set_visual: new Set(['type', 'fieldId', 'visualType', 'visualParams', 'renderTarget', 'sampleTargets', 'renderOrder']),
  set_position: new Set(['type', 'fieldId', 'x', 'y', 'z', 'rotX', 'rotY']),
  set_color: new Set(['type', 'fieldId', 'color']),
  set_scale: new Set(['type', 'fieldId', 'scale']),
  set_world_data: new Set(['type', 'data']),
  define_visual: new Set(['type', 'name', 'wgsl']),
  define_module: new Set(['type', 'name', 'wgsl']),
  remove_module: new Set(['type', 'name']),
  create_render_target: new Set(['type', 'name', 'persist']),
  destroy_render_target: new Set(['type', 'name']),
  register_node: new Set(['type', 'id', 'node']),
  remove_node: new Set(['type', 'id']),
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
  put_world: new Set(['type', 'world']),
}

export function emptySnapshot(): SceneSnapshot {
  return {
    name: '',
    fields: [],
    // collisionForce 0: field-vs-field physics is an OPT-IN primitive
    // (set_world_params {collisionForce: N}), not ambient default behavior —
    // overlapping composition fields (viewers, HUD layers, multi-pass rigs)
    // were silently shoved apart by the old default of 50. Existing worlds
    // keep their own persisted worldParams; this only seeds new/blank worlds.
    worldParams: { gravity: 0, friction: 0.1, collisionForce: 0, boundaryMode: 'solid', bounciness: 0.5, gravitationalConstant: 0 },
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
 *    · create_render_target/destroy_render_target — persisted in
 *      snap.renderTargets (cold loads must restore them; see the case handlers)
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
      // honor a caller-supplied fieldId (headless builders address fields
      // deterministically — hooks/effects reference them by id); fall back to a
      // generated one. Collisions refuse loudly instead of silently forking.
      const wantedId = typeof cmd.fieldId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(cmd.fieldId) ? cmd.fieldId : null
      if (wantedId && snap.fields.some(f => f.id === wantedId)) { result.error = `create_field: field id "${wantedId}" already exists`; return result }
      const fieldId = wantedId ?? `field_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
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
        noCollide: cmd.noCollide as boolean | undefined,
        // PIXEL-COLLIDE LAW: collision body = rendered pixels (appearance IS geometry)
        pixelCollide: cmd.pixelCollide as boolean | undefined,
        // renderTarget / sampleTargets may arrive as top-level command keys (the
        // create_field whitelist accepts them) but the live engine reads them from
        // field.properties — fold them in here so they round-trip through the
        // snapshot, exactly as set_visual does. Without this the assignment is
        // silently dropped and the field never writes to its render target.
        properties: (() => {
          const props = { ...(cmd.properties as Record<string, unknown> | undefined) }
          if (cmd.renderTarget != null) props.renderTarget = cmd.renderTarget
          if (cmd.sampleTargets != null) props.sampleTargets = cmd.sampleTargets
          return Object.keys(props).length > 0 ? props : undefined
        })(),
      })
      result.fieldId = fieldId
      stampProv(snap, `field:${fieldId}`, cmd)
      break
    }

    case 'delete_field': {
      if (cmd.__member === true && cmd.__admin !== true) {
        result.ok = false
        result.error = "member keys build — they don't demolish. delete_field needs the world owner's key (or hide it: set_visibility false)"
        return result
      }
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
      if (cmd.__member === true && cmd.__admin !== true) {
        result.ok = false
        result.error = "member keys build — they don't demolish. RESET needs the world owner's key"
        return result
      }
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
      // THE CODE GATE for shaders (rung 2): empty WGSL never lands — the
      // visual stays at its last version. (True compile happens on the GPU;
      // the quarantine report path heals a compile-broken push to last-good.)
      {
        const wgslStr = String(cmd.wgsl ?? '')
        if (!wgslStr.trim()) {
          result.ok = false
          result.error = `empty WGSL never lands — visual "${cmd.name}" stays as it was`
          return result
        }
      }
      const existing = snap.visualTypes.findIndex(v => v.name === cmd.name)
      if (existing >= 0) {
        snap.visualTypes[existing].wgsl = cmd.wgsl as string
      } else {
        snap.visualTypes.push({ name: cmd.name as string, wgsl: cmd.wgsl as string })
      }
      appendShaderRev(snap, 'visual', String(cmd.name), String(cmd.wgsl), cmd)
      stampProv(snap, `visual:${String(cmd.name)}`, cmd)
      break
    }

    case 'remove_module': {
      if (snap.modules) snap.modules = snap.modules.filter(m => m.name !== cmd.name)
      break
    }

    case 'define_module': {
      if (!snap.modules) snap.modules = []
      {
        const wgslStr = String(cmd.wgsl ?? '')
        if (!wgslStr.trim()) {
          result.ok = false
          result.error = `empty WGSL never lands — module "${cmd.name}" stays as it was`
          return result
        }
      }
      const existing = snap.modules.findIndex(m => m.name === cmd.name)
      if (existing >= 0) {
        snap.modules[existing].wgsl = cmd.wgsl as string
      } else {
        snap.modules.push({ name: cmd.name as string, wgsl: cmd.wgsl as string })
      }
      appendShaderRev(snap, 'module', String(cmd.name), String(cmd.wgsl), cmd)
      stampProv(snap, `module:${String(cmd.name)}`, cmd)
      break
    }

    case 'create_render_target': {
      // Persist target defs in the snapshot: a cold load (fresh tab or fresh
      // lambda) must restore them, or fields with a renderTarget draw to
      // screen and sampleTarget() consumers read black. (Before this, defs
      // lived only in server memory — the feature broke on every cold start.)
      if (!snap.renderTargets) snap.renderTargets = []
      const name = cmd.name as string
      const persist = cmd.persist === true ? true : undefined
      const i = snap.renderTargets.findIndex(t => t.name === name)
      if (i >= 0) snap.renderTargets[i] = { name, persist }
      else snap.renderTargets.push({ name, persist })
      break
    }

    case 'destroy_render_target': {
      if (cmd.__member === true && cmd.__admin !== true) {
        result.ok = false
        result.error = "member keys build — they don't demolish. destroy_render_target needs the world owner's key"
        return result
      }
      if (snap.renderTargets) {
        snap.renderTargets = snap.renderTargets.filter(t => t.name !== (cmd.name as string))
      }
      break
    }

    case 'add_effect': {
      const f = snap.fields.find(f => f.id === cmd.fieldId)
      // a miss must be LOUD — this silently 200'd for months (effects targeting a
      // wrong/generated id vanished; the world rendered dark with no signal)
      if (!f) { result.error = `add_effect: no field with id "${cmd.fieldId}" — ids are returned by create_field (fieldId), or pass your own fieldId at create`; return result }
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
      // the documented form (guide + health warnings) carries params TOP-LEVEL
      // — {type:'set_world_params', collisionForce: 0}. The live engine accepts
      // it; persist it too or every fresh load reverts to defaults (fields
      // shoved by collisionForce=50 that the author explicitly zeroed).
      const WORLD_PARAM_KEYS = ['gravity', 'friction', 'bounciness', 'boundaryMode', 'collisionForce', 'gravitationalConstant'] as const
      for (const k of WORLD_PARAM_KEYS) {
        if (cmd[k] !== undefined) {
          snap.worldParams = { ...snap.worldParams, [k]: cmd[k] } as SceneSnapshot['worldParams']
        }
      }
      // GRID DIMENSIONS (task #20): worlds beyond 512×512. Clamped [64, 4096];
      // the engine constructs at this size on load, so a change on a LIVE
      // world takes effect when the tab reloads — warn honestly.
      {
        const pRaw = cmd.params as Record<string, unknown> | undefined
        for (const dim of ['gridSize', 'gridW', 'gridH'] as const) {
          const raw = pRaw?.[dim] ?? cmd[dim]
          if (raw === undefined) continue
          const g = Math.round(Number(raw))
          if (!Number.isFinite(g) || g < 64 || g > 4096) {
            result.error = `${dim} must be an integer 64..4096 (got ${String(raw)})`
            return result
          }
          snap.worldParams = { ...snap.worldParams, [dim]: g } as SceneSnapshot['worldParams']
          if (dim === 'gridSize') result.warning = `gridSize ${g} persisted — the engine constructs at this size on WORLD LOAD; open tabs keep their current grid until reload`
        }
      }
      break
    }

    case 'set_world_data': {
      // PLATFORM KEYS ARE ROUTE-OWNED (audit, Sep 5): __nodes/__provenance/
      // __nodeHist/__budget/… must never arrive from a client — forging them
      // clears holds, frames builders, and dodges the perf gate. Strip every
      // __ key from the payload for non-admin callers (mirrors put_world).
      // (__internal marks ROUTE-COMPOSED beacon writes — __ai_last_cmd/__state/
      // __perf/__built_ua. Unforgeable: the command loop strips every __ key
      // from client commands before anything else runs.)
      if (cmd.data && typeof cmd.data === 'object' && cmd.__admin !== true && cmd.__internal !== true) {
        for (const k of Object.keys(cmd.data as Record<string, unknown>)) {
          if (k.startsWith('__')) delete (cmd.data as Record<string, unknown>)[k]
        }
      }
      if (cmd.data) {
        // THE SOCIAL CONTRACT IS IMMUTABLE (world-policy): policy lands once —
        // at fork/creation — and never changes after, not even for the owner.
        const dataIn = { ...(cmd.data as Record<string, unknown>) }
        if ('policy' in dataIn) {
          // …and a MEMBER key may never be the first writer of the IMMUTABLE
          // contract (audit, Sep 5): it would lock the owner's own world forever.
          if (cmd.__member === true && cmd.__admin !== true) {
            delete dataIn.policy
            result.warnings = [...((result.warnings as string[] | undefined) ?? []), 'policy refused: the social contract is authored by the owner, not a crew key']
          }
        }
        if ('policy' in dataIn) {
          const verdict = mayWritePolicy(snap.worldData as Record<string, unknown>, dataIn.policy)
          if (verdict.ok) dataIn.policy = verdict.policy
          else {
            delete dataIn.policy
            result.warnings = [...((result.warnings as string[] | undefined) ?? []), 'policy refused: ' + verdict.error]
          }
        }
        cmd.data = dataIn
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
      // GRIEF GATE (task: destructive verbs holder/owner-only). Removal is the
      // sharpest verb a crew shares, so at this chokepoint:
      //   · a node HELD by another fresh builder refuses removal for everyone
      //     (same law as overwrite) — admin overrides
      //   · a MEMBER key (__member, route-injected) may remove ONLY a node it
      //     currently holds — dock_node first. That makes removal deliberate
      //     and attributed (the dock trail), never a drive-by wipe.
      {
        const wdG = snap.worldData as Record<string, unknown>
        const nodesG = (wdG.__nodes && typeof wdG.__nodes === 'object' ? wdG.__nodes : null) as Record<string, NodeRecord> | null
        const st = holdStatus(nodesG?.[hookId] ?? null, String(cmd.__holder ?? ''), Number(cmd.__now ?? Date.now()))
        if (cmd.__admin !== true) {
          if (st === 'held') {
            result.ok = false; result.gateRejected = true
            result.error = `node "${hookId}" is HELD by another builder — it can't be removed out from under them`
            return result
          }
          if (cmd.__member === true && st !== 'mine') {
            result.ok = false; result.gateRejected = true
            result.error = `member keys remove only nodes they hold — dock_node {"id":"${hookId}"} first (the hold makes removal deliberate and attributed), or ask the owner`
            return result
          }
        }
      }
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
      // ── PUSH-GATE (node-gate): the hard access pathway. If this hookId's node is
      // HELD by a DIFFERENT builder and the hold is fresh, refuse the overwrite here
      // at the single persist chokepoint — "add your own node, or edit only what you
      // hold." holder/now/admin are ROUTE-INJECTED (__holder = holderOf(token), never
      // the spoofable cmd.author). No holder = free = today's behavior (legacy-neutral).
      {
        const wdG = snap.worldData as Record<string, unknown>
        const nodesG = (wdG.__nodes && typeof wdG.__nodes === 'object' ? wdG.__nodes : null) as Record<string, Record<string, unknown>> | null
        const chk = canPush(nodesG?.[hookId] ?? null, String(cmd.__holder ?? ''), Number(cmd.__now ?? Date.now()), { override: cmd.__admin === true })
        if (!chk.ok) {
          result.ok = false
          result.error = chk.reason
          result.gateRejected = true
          return result
        }
      }
      // ── THE CODE GATE (co-build rung 2, Galen's law): a broken push NEVER
      // lands. Empty code never lands. The server compiles the hook EXACTLY the
      // way the sandbox will — new Function('sim','dt',code), compile only,
      // never invoked — and refuses on SyntaxError. The node simply remains at
      // its last working version; a new node that never compiles never exists.
      {
        const codeStr = String(cmd.code ?? '')
        if (!codeStr.trim()) {
          result.ok = false
          result.error = `empty hook code never lands — node "${hookId}" stays as it was. To remove a node, remove_step_hook (holder/owner).`
          return result
        }
        try { new Function('sim', 'dt', codeStr) } catch (e) {
          result.ok = false
          result.error = `hook code does not compile — NOTHING landed; node "${hookId}" stays at its last version. ${e instanceof Error ? e.message : String(e)}`
          return result
        }
      }
      // KNOWN LIVE-EDIT LIMITATION (live-hotswap, Aug 2026 — Galen/Fable pill
      // experiment): the tab's in-place hot-swap (FieldEngine.hotSwapLive) can
      // re-load hooks into an EXISTING Worker sandbox, but it cannot CREATE one.
      // The sandbox is only spun up on world LOAD, and only when the world loads
      // with stepHooks.length > 0 (FieldEngine ~line 623). So adding the FIRST
      // hook to a world a player already has open HOOK-LESS does nothing live: the
      // hook never runs, so anything it drives (e.g. gpuUniforms a shader reads via
      // uni()) stays 0 — a uniform-driven visual then renders BLACK — until a
      // reload creates the sandbox. New page loads are fine. FIX PATH: teach
      // hotSwapLive to instantiate the sandbox in place when a snapshot adds hooks
      // to a world that has none. Until then, WARN so the builder isn't surprised.
      const wasHookless = snap.stepHooks.length === 0
      // REPLACE IN PLACE — the stepHooks array order IS the per-frame execution
      // order (the runtime runs them top-to-bottom; __nodes slots aren't wired to
      // execution yet). The old filter-then-push moved a re-pushed hook to the
      // END, silently changing run order: re-deploying a world's FIRST hook (e.g.
      // a player/frame node that sets up the gpuUniforms whiteboard every other
      // hook reads) dropped it to last, so every downstream hook read a stale
      // whiteboard and the whole world broke on the next reload — while the live
      // tab (a Map, order-preserving) looked fine. Keeping the existing index
      // makes a re-push a true replace. (Aug 9 2026, veilfire-3d — Galen/Fable.)
      const newHook = {
        id: hookId,
        author: (cmd.author as string) ?? 'claude-code',
        description: (cmd.description as string) ?? '',
        code: cmd.code as string,
      }
      const existingIdx = snap.stepHooks.findIndex(h => h.id === hookId)
      if (existingIdx >= 0) snap.stepHooks[existingIdx] = newHook
      else snap.stepHooks.push(newHook)
      stampProv(snap, `node:${hookId}`, cmd)
      if (wasHookless) {
        result.warning = 'added the FIRST hook to this world — a player who already has it OPEN must RELOAD for the hook to run. The live hot-swap re-loads hooks into an existing sandbox but cannot create one in place, so a uniform-driven shader will render BLACK live until reload. Fresh page loads are unaffected.'
      }
      // A space token is an UNTRUSTED author (AI / player build). Flag the world
      // so every visitor runs its JS hooks in the sealed Worker sandbox, never on
      // the main thread. This is what makes "allow JS hooks" safe on a public site.
      ;(snap.worldData as Record<string, unknown>).__sandbox = true
      // AUTO-REGISTER (node-runtime rung 3). Every hook auto-becomes a node with a
      // stable insertion-order slot + owns.uni inferred from its literal u[N] writes.
      // Re-pushing a hook can no longer reorder it. Purely additive: this writes
      // worldData.__nodes; nothing reads it yet on this deploy, so behavior is
      // unchanged (legacy-neutral). See node-autoregister.ts.
      const autoNode = autoRegisterHook(snap.worldData as Record<string, unknown>, hookId, cmd.code as string)
      // A LEGAL push AUTO-CLAIMS the node for its pusher (add == claim); the hold
      // refreshes on every push so an active builder never goes stale. Only when
      // __holder is resolved (space/scene build tokens).
      {
        const holder = String(cmd.__holder ?? '')
        if (autoNode && holder) stampHold(autoNode as Record<string, unknown>, holder, Number(cmd.__now ?? Date.now()))
      }
      // PER-NODE VERSION CONTROL (co-build dock): every landed push appends this
      // code as a rev on worldData.__nodeHist — the chain node_revert restores
      // from, and the reason a broken node can heal instead of being stripped.
      {
        const wdH = snap.worldData as Record<string, unknown>
        const hist = (wdH.__nodeHist && typeof wdH.__nodeHist === 'object' ? wdH.__nodeHist : (wdH.__nodeHist = {})) as NodeHist
        appendNodeRev(hist, hookId, {
          rev: Number((autoNode as Record<string, unknown> | null)?.rev) || 1,
          code: String(cmd.code ?? ''),
          at: Number(cmd.__now ?? Date.now()),
          by: String(cmd.__holder ?? '') || 'anon',
          note: typeof cmd.note === 'string' ? cmd.note.slice(0, 200) : undefined,
        })
        capWorldHistory(hist)
      }
      // RUNG E build-time coordination: if this hook's auto-inferred owns overlaps
      // another node's lane, MESSAGE the AI (warnings, non-fatal). Nodes are the
      // owners — dock to the one that owns the slot (release yours + claim it),
      // don't write into its lane. "if available" = the owner's hold status.
      {
        const mineUni = ((autoNode as Record<string, unknown> | undefined)?.owns as Record<string, unknown> | undefined)?.uni as number[][] | undefined
        if (Array.isArray(mineUni) && mineUni.length) {
          const nodes = ((snap.worldData as Record<string, unknown>).__nodes ?? {}) as Record<string, Record<string, unknown>>
          const holder = String(cmd.__holder ?? '')
          const now = Number(cmd.__now ?? Date.now())
          const conflicts: string[] = []
          for (const [oid, o] of Object.entries(nodes)) {
            if (oid === hookId) continue
            const theirs = (o.owns as Record<string, unknown> | undefined)?.uni as number[][] | undefined
            if (!Array.isArray(theirs)) continue
            for (const a of mineUni) for (const b of theirs) {
              if (Array.isArray(a) && Array.isArray(b) && a[0] <= b[1] && b[0] <= a[1]) {
                const st = holdStatus(o, holder, now)   // free | mine | stale | held
                const slot = b[0] === b[1] ? `${b[0]}` : `${b[0]}-${b[1]}`
                const dock = (st === 'free' || st === 'stale')
                  ? `it's ${st} — dock there: release_node "${hookId}" + claim_node "${oid}"`
                  : st === 'mine' ? `you already hold "${oid}" — put this behavior in it` : `held by another builder — write a slot you own`
                conflicts.push(`slot ${slot} is owned by node "${oid}" (${dock})`)
              }
            }
          }
          if (conflicts.length) {
            result.warnings = [...((result.warnings as string[] | undefined) ?? []), 'owns conflict — nodes are the owners: ' + conflicts.join(' · ')]
          }
        }
      }
      break
    }

    case 'put_world': {
      // THE ONE-SHOT WHOLE-WORLD PUSH. Sections SENT replace wholesale; sections
      // OMITTED are kept — so a builder can hand over a complete world (or one
      // complete section) in a single verb instead of dozens of create/add calls.
      // Composes the SAME machinery as the per-verb paths (universal pipelines):
      // hooks are delegated to add_step_hook (code gate, replace-in-place,
      // auto-register, auto-claim, history, owns-conflict warnings), the node
      // gate refuses the whole put while any node is held by another fresh
      // builder, and platform-owned worldData keys can never be spoofed in.
      // ATOMIC: every validation and the gate run BEFORE the first mutation.
      // MEMBER KEYS BUILD, NEVER DEMOLISH (audit, Sep 5): put_world replaces
      // sections wholesale — one call could wipe fields/hooks the grief gate
      // protects verb-by-verb. Crew keys use the additive verbs.
      if (cmd.__member === true && cmd.__admin !== true) {
        result.ok = false
        result.error = 'put_world is owner-only — member keys build additively (add_step_hook / create_field / define_visual beside the existing work)'
        break
      }
      const worldRaw = cmd.world
      if (!worldRaw || typeof worldRaw !== 'object' || Array.isArray(worldRaw)) {
        result.ok = false
        result.error = 'put_world needs { world: { fields?, stepHooks?, visualTypes?, modules?, interactionRules?, interactionEffects?, worldData?, worldParams? } } — sections sent replace wholesale, sections omitted are kept'
        return result
      }
      const w = worldRaw as Record<string, unknown>
      const holder = String(cmd.__holder ?? '')
      const now = Number(cmd.__now ?? Date.now())
      const warnings: string[] = []

      // ── VALIDATE (no mutation yet) ─────────────────────────────────────────
      const SECTION_CAPS: Record<string, number> = {
        fields: 256, stepHooks: 128, visualTypes: 128, modules: 64,
        interactionRules: 128, interactionEffects: 128,
      }
      for (const k of Object.keys(SECTION_CAPS)) {
        if (w[k] === undefined) continue
        if (!Array.isArray(w[k])) { result.ok = false; result.error = `put_world: "${k}" must be an array`; return result }
        if ((w[k] as unknown[]).length > SECTION_CAPS[k]) {
          result.ok = false
          result.error = `put_world: "${k}" has ${(w[k] as unknown[]).length} entries — over the cap (${SECTION_CAPS[k]})`
          return result
        }
      }
      const hooksIn = (w.stepHooks as Record<string, unknown>[] | undefined)
      if (hooksIn) {
        const seenH = new Set<string>()
        for (let i = 0; i < hooksIn.length; i++) {
          const h = hooksIn[i]
          if (!h || typeof h !== 'object' || typeof h.code !== 'string' || !h.code.trim()) {
            result.ok = false
            result.error = `put_world: every step hook needs { id, code: string } — entry ${i} ("${String(h?.id ?? '?')}") has no code`
            return result
          }
          try { new Function('sim', 'dt', h.code) } catch (e) {
            result.ok = false
            result.error = `put_world: hook "${String(h.id ?? i)}" does not compile — NOTHING landed. ${e instanceof Error ? e.message : String(e)}`
            return result
          }
          if (typeof h.id !== 'string' || !h.id) h.id = `hook_${now}_${i}`
          if (seenH.has(h.id as string)) { result.ok = false; result.error = `put_world: duplicate hook id "${h.id}"`; return result }
          seenH.add(h.id as string)
        }
      }
      if (w.fields) {
        const seenF = new Set<string>()
        for (const f of w.fields as Record<string, unknown>[]) {
          const id = (f && typeof f.id === 'string') ? f.id : null
          if (!id) continue
          // a duplicate id is a MALFORMED payload (two fields would silently fuse
          // on load) — thrown, not returned, so the route layer 500s loudly
          if (seenF.has(id)) throw new Error(`put_world: duplicate field id "${id}"`)
          seenF.add(id)
        }
      }
      if (w.visualTypes) {
        for (const v of w.visualTypes as Record<string, unknown>[]) {
          if (!v || typeof v.name !== 'string' || typeof v.wgsl !== 'string') {
            result.ok = false; result.error = 'put_world: every visualType needs { name: string, wgsl: string }'; return result
          }
        }
      }

      // ── NODE GATE: replacing hooks wholesale overwrites EVERY node, so any
      // node held fresh by ANOTHER builder refuses the whole put (nothing lands).
      if (hooksIn && cmd.__admin !== true) {
        const wdG = snap.worldData as Record<string, unknown>
        const nodesG = (wdG.__nodes && typeof wdG.__nodes === 'object' ? wdG.__nodes : {}) as Record<string, NodeRecord>
        for (const [nid, node] of Object.entries(nodesG)) {
          if (holdStatus(node, holder, now) === 'held') {
            result.ok = false
            result.gateRejected = true
            result.error = `put_world: node "${nid}" is HELD by another builder — the whole-world push is refused, nothing landed. Wait for the hold to go stale or put around it with per-node verbs.`
            return result
          }
        }
      }

      // ── APPLY (validated — from here on the put lands) ────────────────────
      if (w.worldParams && typeof w.worldParams === 'object' && !Array.isArray(w.worldParams)) {
        // merge onto engine defaults + current — a PARTIAL params object must
        // never strip engine keys (a stripped boundaryMode breaks every load)
        snap.worldParams = { ...blank.worldParams, ...snap.worldParams, ...(w.worldParams as Record<string, unknown>) } as SceneSnapshot['worldParams']
      }
      if (w.worldData && typeof w.worldData === 'object' && !Array.isArray(w.worldData)) {
        // non-__ keys replace wholesale; every __-prefixed key is PLATFORM-OWNED
        // on this path (registry, holds, provenance, revs, originals) — carried
        // from the current world, spoofs stripped. Infrastructure and game state
        // arrive via their own verbs, never the whole-world put. The policy
        // contract stays immutable (mayWritePolicy: lands once, then never).
        const cur = snap.worldData as Record<string, unknown>
        const incoming = w.worldData as Record<string, unknown>
        const next: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(incoming)) {
          // premium + brief_done ride ONLY set_world_data, where their gates
          // live (IP entitlement · render/perf ship gates) — the put path was
          // a bypass (audit, Sep 5)
          if (!k.startsWith('__') && k !== 'policy' && !(cmd.__admin !== true && (k === 'premium' || k === 'brief_done'))) next[k] = v
        }
        for (const [k, v] of Object.entries(cur)) {
          if (k.startsWith('__')) next[k] = v
        }
        if ('policy' in cur) next.policy = cur.policy
        else if ('policy' in incoming) {
          const verdict = mayWritePolicy(cur, incoming.policy)
          if (verdict.ok) next.policy = verdict.policy
          else warnings.push('policy refused: ' + verdict.error)
        }
        snap.worldData = next
      }
      if (w.fields) {
        // normalize hand-written fields into loadable snapshots — the same
        // defaults create_field applies, so a put and a build land identical rows
        snap.fields = (w.fields as Record<string, unknown>[]).map((f, i) => {
          const skinned = (typeof f.visualTypeName === 'string' && f.visualTypeName) || (typeof f.visualType === 'string' && f.visualType) || undefined
          if (!skinned) warnings.push(`field "${String(f.name ?? f.id ?? i)}" has no visualType — it renders as NOTHING until skinned (define_visual + set_visual)`)
          const hasRadius = f.radius != null
          const hasWH = f.w != null || f.h != null
          const shape = (f.shapeType as string) ?? (f.shape as string) ?? (hasRadius ? 'circle' : hasWH ? 'rect' : skinned ? 'screen' : 'circle')
          const t = (f.transform && typeof f.transform === 'object' ? f.transform : {}) as Record<string, unknown>
          return {
            id: (typeof f.id === 'string' && f.id) ? f.id : `field_${now}_${i}`,
            name: (f.name as string) ?? 'Unnamed',
            color: (f.color as [number, number, number, number]) ?? [1, 1, 1, 1],
            effects: Array.isArray(f.effects) ? f.effects : [],
            memory: Array.isArray(f.memory) ? f.memory : [],
            proximity: Array.isArray(f.proximity) ? f.proximity : [],
            transform: {
              x: (t.x as number) ?? (f.x as number) ?? 256,
              y: (t.y as number) ?? (f.y as number) ?? 256,
              rotation: (t.rotation as number) ?? 0,
              scale: (t.scale as number) ?? (f.scale as number) ?? 1,
              vx: (t.vx as number) ?? 0, vy: (t.vy as number) ?? 0, vr: (t.vr as number) ?? 0,
              ...(t.z !== undefined ? { z: t.z as number } : {}),
            },
            shapeType: shape as 'circle' | 'rect' | 'screen',
            radius: (f.radius as number) ?? (shape === 'circle' ? 20 : undefined),
            w: (f.w as number) ?? (shape === 'rect' ? 50 : undefined),
            h: (f.h as number) ?? (shape === 'rect' ? 50 : undefined),
            visualTypeName: skinned,
            visualParams: f.visualParams as [number, number, number, number] | undefined,
            tags: Array.isArray(f.tags) ? f.tags as string[] : undefined,
            noHit: f.noHit as boolean | undefined,
            noCollide: f.noCollide as boolean | undefined,
            pixelCollide: f.pixelCollide as boolean | undefined,
            parentFieldId: f.parentFieldId as string | undefined,
            properties: (f.properties && typeof f.properties === 'object') ? f.properties as Record<string, unknown> : undefined,
          }
        }) as SceneSnapshot['fields']
      }
      if (w.visualTypes) snap.visualTypes = w.visualTypes as SceneSnapshot['visualTypes']
      if (w.modules) snap.modules = w.modules as SceneSnapshot['modules']
      if (w.interactionRules) snap.interactionRules = w.interactionRules as SceneSnapshot['interactionRules']
      if (w.interactionEffects) snap.interactionEffects = w.interactionEffects as SceneSnapshot['interactionEffects']
      if (hooksIn) {
        const wasHookless = snap.stepHooks.length === 0
        // registry follows the hooks: an AUTO node whose hook vanishes in the put
        // drops with it; an EXPLICIT (auto:false) registration is a declaration
        // that outlives any one hook push — it survives.
        {
          const wdN = snap.worldData as Record<string, unknown>
          const nodes = (wdN.__nodes && typeof wdN.__nodes === 'object' ? wdN.__nodes : null) as Record<string, Record<string, unknown>> | null
          if (nodes) {
            const incomingIds = new Set(hooksIn.map(h => h.id as string))
            for (const nid of Object.keys(nodes)) {
              if (nodes[nid]?.auto === true && !incomingIds.has(nid)) delete nodes[nid]
            }
          }
        }
        snap.stepHooks = []
        for (const h of hooksIn) {
          // the SAME landing path as a single push — code gate (re-checked),
          // replace-in-place, provenance stamp, __sandbox, auto-register,
          // auto-claim for the pusher, per-node history, owns-conflict warnings
          const sub = applyCommandToSnapshotObject(snap, {
            type: 'add_step_hook',
            hookId: h.id, code: h.code,
            ...(typeof h.author === 'string' ? { author: h.author } : {}),
            ...(typeof h.description === 'string' ? { description: h.description } : {}),
            ...(typeof h.note === 'string' ? { note: h.note } : {}),
            __holder: cmd.__holder, __now: cmd.__now, __admin: cmd.__admin, __member: cmd.__member,
          })
          if (sub.error) { warnings.push(`hook "${h.id}": ${String(sub.error)}`) }
          for (const sw of (sub.warnings as string[] | undefined) ?? []) warnings.push(sw)
          // sub.warning is the first-hook RELOAD notice — ours below is put-accurate
        }
        if (wasHookless && hooksIn.length) {
          warnings.push('this put added the FIRST hooks to a hookless world — a player who already has it OPEN must RELOAD for them to run (the live hot-swap cannot create a sandbox in place); fresh page loads are unaffected')
        }
      }
      result.ok = true
      result.sections = Object.keys(SECTION_CAPS).concat('worldData', 'worldParams').filter(k => w[k] !== undefined)
      if (warnings.length) result.warnings = warnings
      break
    }

    case 'claim_node': {
      // Take (or refresh) the HOLD on a node — the explicit form of what a push does
      // implicitly. Succeeds if the node is free / stale / already yours; refused if a
      // different builder holds it fresh. holder/now/admin are ROUTE-INJECTED.
      const id = String(cmd.id ?? '')
      const holder = String(cmd.__holder ?? '')
      const now = Number(cmd.__now ?? Date.now())
      if (!id || !holder) { result.ok = false; result.error = 'claim_node needs an id (and a resolved builder identity)'; break }
      const wd = snap.worldData as Record<string, unknown>
      const nodes = (wd.__nodes && typeof wd.__nodes === 'object' ? wd.__nodes : (wd.__nodes = {})) as Record<string, Record<string, unknown>>
      if (!nodes[id]) {
        wd.__nodeSeq = (Number(wd.__nodeSeq) || 0) + 10
        nodes[id] = { id, order: wd.__nodeSeq, owns: { uni: [] }, auto: true, rev: 1 }
      }
      const chk = canPush(nodes[id], holder, now, { override: cmd.__admin === true })   // same rule as a push
      if (!chk.ok) { result.ok = false; result.error = chk.reason }
      else { stampHold(nodes[id], holder, now); result.ok = true; result.node = nodes[id] }
      break
    }

    case 'release_node': {
      // Give up your hold so another builder may take the node. Holder-only (admin override).
      const id = String(cmd.id ?? '')
      const holder = String(cmd.__holder ?? '')
      const nodes = (snap.worldData as Record<string, unknown>)?.__nodes as Record<string, Record<string, unknown>> | undefined
      const n = nodes?.[id]
      if (n && canRelease(n, holder, cmd.__admin === true)) { delete n.holder; delete n.heldAt; result.ok = true; result.node = n }
      else if (n) { result.ok = false; result.error = `node "${id}" is held by ${n.holder ?? 'nobody'} — not yours to release` }
      else { result.ok = false; result.error = `no node "${id}" to release` }
      break
    }

    case 'dock_node': {
      // DOCK — the co-build unit of work: take the hold (same gate as a push)
      // and come back with everything needed to work the node: its record, its
      // version history (metas), and the current code. The internals feed rides
      // the bridge layer (node_feed) — this is the snapshot half.
      const id = String(cmd.id ?? '')
      const holder = String(cmd.__holder ?? '')
      const now = Number(cmd.__now ?? Date.now())
      if (!id || !holder) { result.ok = false; result.error = 'dock_node needs an id (and a resolved builder identity)'; break }
      const wd = snap.worldData as Record<string, unknown>
      const nodes = (wd.__nodes && typeof wd.__nodes === 'object' ? wd.__nodes : (wd.__nodes = {})) as Record<string, Record<string, unknown>>
      if (!nodes[id]) {
        wd.__nodeSeq = (Number(wd.__nodeSeq) || 0) + 10
        nodes[id] = { id, order: wd.__nodeSeq, owns: { uni: [] }, auto: true, rev: 1 }
      }
      const chk = canPush(nodes[id], holder, now, { override: cmd.__admin === true })
      if (!chk.ok) { result.ok = false; result.error = chk.reason; break }
      stampHold(nodes[id], holder, now)
      const hist = (wd.__nodeHist ?? {}) as NodeHist
      const hook = snap.stepHooks.find(h => h.id === id)
      result.ok = true
      result.node = nodes[id]
      result.history = historyMeta(hist, id)
      result.code = hook?.code ?? null
      result.next = `you hold "${id}". Work it, then undock_node {id, code, note} to SUBMIT (a new version) or undock_node {id} to abandon. Post progress with node_feed.`
      break
    }

    case 'undock_node': {
      // UNDOCK — submit-or-abandon. With code: the submission lands through the
      // SAME push path as add_step_hook (gate, auto-register, version capture),
      // then the hold is released. Without code: just release (abandon; drafts
      // were never the world's problem). Holder-only, admin override.
      const id = String(cmd.id ?? '')
      const holder = String(cmd.__holder ?? '')
      const nodes = (snap.worldData as Record<string, unknown>)?.__nodes as Record<string, Record<string, unknown>> | undefined
      const n = nodes?.[id]
      if (!n) { result.ok = false; result.error = `no node "${id}" to undock from`; break }
      if (!canRelease(n, holder, cmd.__admin === true)) { result.ok = false; result.error = `node "${id}" is held by ${n.holder ?? 'nobody'} — not yours to undock`; break }
      if (typeof cmd.code === 'string' && cmd.code.trim()) {
        const sub = applyCommandToSnapshotObject(snap, {
          type: 'add_step_hook', hookId: id, code: cmd.code,
          author: cmd.author, description: cmd.description, note: cmd.note ?? 'submitted on undock',
          __holder: holder, __now: cmd.__now, __admin: cmd.__admin,
        })
        if (sub.ok === false) { result.ok = false; result.error = String(sub.error ?? 'submission rejected'); break }
        result.submitted = true
        result.rev = (nodes![id] as Record<string, unknown>).rev
      }
      delete n.holder; delete n.heldAt
      result.ok = true
      result.node = n
      break
    }

    case 'node_history': {
      // The node's version chain — metas by default (rev/at/by/note/bad/bytes);
      // {rev: N} returns that one version WITH its code (for diffing/restore).
      const id = String(cmd.id ?? '')
      if (!id) { result.ok = false; result.error = 'node_history needs an id'; break }
      const hist = ((snap.worldData as Record<string, unknown>).__nodeHist ?? {}) as NodeHist
      if (cmd.rev !== undefined) {
        const one = (hist[id] ?? []).find(r => r.rev === Number(cmd.rev))
        if (!one) { result.ok = false; result.error = `node "${id}" has no rev ${cmd.rev} in history`; break }
        result.ok = true; result.version = one
      } else {
        result.ok = true; result.history = historyMeta(hist, id)
      }
      break
    }

    case 'node_revert': {
      // REVERT — restore a node to a known-good version WITHOUT touching the
      // rest of the world. The bad rev is marked (never a future revert target),
      // and the restore lands as a NEW version through the same push path —
      // history is append-only, a revert is a forward move to old code. This is
      // the per-node answer to quarantine: heal the node, don't strip it.
      const id = String(cmd.id ?? '')
      const holder = String(cmd.__holder ?? '')
      const now = Number(cmd.__now ?? Date.now())
      if (!id) { result.ok = false; result.error = 'node_revert needs an id'; break }
      const wd = snap.worldData as Record<string, unknown>
      const nodes = wd.__nodes as Record<string, Record<string, unknown>> | undefined
      const n = nodes?.[id]
      if (!n) { result.ok = false; result.error = `no node "${id}" to revert`; break }
      const gate = canPush(n, holder, now, { override: cmd.__admin === true })
      if (!gate.ok) { result.ok = false; result.error = gate.reason; break }
      const hist = (wd.__nodeHist ?? {}) as NodeHist
      const curRev = Number(n.rev) || 0
      const target = cmd.rev !== undefined
        ? (hist[id] ?? []).find(r => r.rev === Number(cmd.rev) && !r.bad) ?? null
        : findRevertTarget(hist, id, curRev)
      if (!target) { result.ok = false; result.error = `node "${id}" has no good version to revert to${cmd.rev !== undefined ? ` (rev ${cmd.rev} missing or marked bad)` : ''}`; break }
      markRevBad(hist, id, curRev)
      const sub = applyCommandToSnapshotObject(snap, {
        type: 'add_step_hook', hookId: id, code: target.code,
        note: `reverted to rev ${target.rev}` + (typeof cmd.reason === 'string' ? ` — ${cmd.reason.slice(0, 120)}` : ''),
        __holder: holder, __now: cmd.__now, __admin: cmd.__admin,
      })
      if (sub.ok === false) { result.ok = false; result.error = String(sub.error ?? 'revert push rejected'); break }
      result.ok = true
      result.revertedTo = target.rev
      result.markedBad = curRev
      result.node = nodes![id]
      break
    }

    case 'register_node': {
      // EXPLICITLY declare a node's owned uniform ranges + provenance (author,
      // order). This is the manual counterpart to auto-register: an explicit
      // record (auto:false) wins over the inferred one. Uniform-range EXCLUSIVITY
      // is enforced HERE — a registration whose owns.uni overlaps another node's
      // is rejected at register time, never at runtime. Respects the hold: a node
      // held by another fresh builder can't be re-registered (same rule as a push).
      const id = String(cmd.id ?? '')
      if (!id) { result.ok = false; result.error = 'register_node needs an id'; break }
      const holder = String(cmd.__holder ?? '')
      const now = Number(cmd.__now ?? Date.now())
      const wd = snap.worldData as Record<string, unknown>
      const nodes = (wd.__nodes && typeof wd.__nodes === 'object' ? wd.__nodes : (wd.__nodes = {})) as Record<string, Record<string, unknown>>
      const gate = canPush(nodes[id], holder, now, { override: cmd.__admin === true })
      if (!gate.ok) { result.ok = false; result.error = gate.reason; break }
      const rec = (cmd.node as Record<string, unknown>) || {}
      const uni = (o: unknown): number[][] => Array.isArray((o as Record<string, unknown>)?.uni)
        ? ((o as Record<string, unknown>).uni as unknown[]).filter(r => Array.isArray(r) && r.length === 2) as number[][] : []
      const mine = uni(rec.owns)
      let clash: string | null = null
      for (const [oid, o] of Object.entries(nodes)) {
        if (oid === id) continue
        for (const a of mine) for (const b of uni(o.owns))
          if (a[0] <= b[1] && b[0] <= a[1]) { clash = `owns.uni [${a}] of ${id} overlaps ${oid} [${b}]`; break }
        if (clash) break
      }
      if (clash) { result.ok = false; result.error = clash }
      else {
        const prev = nodes[id] || {}
        // ...prev preserves an existing hold (holder/heldAt); ...rec is the caller's
        // declaration; auto:false marks it explicit so auto-register won't reshape it.
        nodes[id] = { order: 100, owns: { uni: [] }, ...prev, ...rec, id, auto: false, rev: (Number(prev.rev) || 0) + 1 }
        result.ok = true; result.node = nodes[id]
      }
      break
    }

    case 'remove_node': {
      // Drop a node from the registry (its order falls to the legacy tail). The
      // step-hook itself is untouched — remove_step_hook does that. Respects the
      // hold: you can't remove a node another builder holds fresh.
      const id = String(cmd.id ?? '')
      const holder = String(cmd.__holder ?? '')
      const now = Number(cmd.__now ?? Date.now())
      const nodes = (snap.worldData as Record<string, unknown>)?.__nodes as Record<string, Record<string, unknown>> | undefined
      const n = nodes?.[id]
      if (!n) { result.ok = false; result.error = `no node "${id}" to remove` }
      else {
        const gate = canPush(n, holder, now, { override: cmd.__admin === true })
        if (!gate.ok) { result.ok = false; result.error = gate.reason }
        else { delete nodes![id]; result.ok = true }
      }
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
    const unknown = Object.keys(cmd).filter(k => !known.has(k) && !k.startsWith('__'))  // __-prefixed = route-internal annotations
    if (unknown.length) result.warnings = [...((result.warnings as string[] | undefined) ?? []), `unknown params ignored: ${unknown.join(', ')}`]
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
  // SERIALIZED PER SPACE (Sep 5, the co-build correctness fix): read→apply→
  // write runs under a pg advisory lock inside ONE transaction, so two AIs'
  // commands can never lost-update each other (B reading pre-A state and
  // writing over A's landed node). NON-BLOCKING BY DESIGN: writers queue for
  // the milliseconds a command takes; lock_timeout('4s') means a stuck holder
  // yields a RETRYABLE error, never a hang. Tab syncs (state route) stay on
  // their own lease + skip-identical path.
  try {
    const out = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '4000ms'`)
      // ::text — the lock fn returns SQL `void`, which prisma cannot
      // deserialize (took every prod space-write down for ~40min, Sep 5 —
      // found by ChatGPT mid-edit; my proof rig used raw pg, which is void-ok)
      await tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))::text`, spaceId)
      const rows = await tx.$queryRawUnsafe<Array<{ snapshot: unknown }>>(
        `SELECT snapshot FROM "PlayerSpace" WHERE id = $1`, spaceId)
      const snap = (rows[0]?.snapshot as SceneSnapshot | null) ?? emptySnapshot()
      const result = applyCommandToSnapshotObject(snap, cmd)
      // Bridge revision: a monotonic counter every bridge write bumps. A tab's
      // own 2s sync round-trips it unchanged, so `server rev > tab rev` means
      // an AI wrote something this tab never ingested (auto-load watcher).
      const wd = (snap.worldData ??= {}) as Record<string, unknown>
      wd.__bridge_rev = (Number(wd.__bridge_rev) || 0) + 1
      // SANDBOX INVARIANT — same chokepoint rule as setSpaceSnapshot
      if (snap?.stepHooks?.length) {
        ;(snap.worldData as Record<string, unknown>) = { ...(snap.worldData || {}), __sandbox: true }
      }
      const updated = await tx.$executeRawUnsafe(
        `UPDATE "PlayerSpace" SET snapshot = $1::jsonb, "updatedAt" = now() WHERE id = $2`,
        JSON.stringify(snap), spaceId)
      if (updated === 0) throw new Error('space row missing')
      return { result, snap }
    }, { maxWait: 6000, timeout: 20000 })
    cache.set(spaceId, { snapshot: out.snap, lastLoaded: Date.now() })   // warm cache = the just-committed truth
    return out.result
  } catch (e) {
    const msg = (e as Error)?.message || String(e)
    if (/lock_timeout|canceling statement|deadlock|Transaction.*timeout|maxWait/i.test(msg)) {
      return { ok: false, error: 'the world is busy — another builder is mid-write. Resend this command in a moment.', retryable: true }
    }
    throw e
  }
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
