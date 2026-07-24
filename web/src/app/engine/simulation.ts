// Field Engine v3 — Simulation (CPU-side)

import { DEFAULT_GRID_SIZE, type FieldWorld, type Field, type FieldTransform, type FieldEffect, type FieldMemoryEntry, type FieldSnapshot, type FieldProximity, type WorldParams, type InteractionRule, type InteractionEffect, type CustomCommand, type Projectile, type TweenDef, type TimerDef, type CollisionCallback, type GameStateDef } from './types'

/** Default render extent from field center (pixels). Not a "size" — just the shader execution area. */
const FIELD_RENDER_EXTENT = 32

/**
 * Spatial hash grid for broad-phase collision/overlap queries.
 * Reduces O(n²) pair checks to ~O(n) for evenly distributed fields.
 * Dimension-agnostic: currently hashes (x, y); adding z is a one-line change.
 */
class SpatialHash<T extends { id: string }> {
  private cellSize: number
  private cells: Map<string, T[]> = new Map()

  constructor(cellSize: number) {
    this.cellSize = cellSize
  }

  private key(cx: number, cy: number): string {
    return `${cx},${cy}`
    // Future 3D: return `${cx},${cy},${cz}`
  }

  clear(): void {
    this.cells.clear()
  }

  /** Insert an item by its axis-aligned bounding box. Registers in all overlapping cells. */
  insertAABB(item: T, minX: number, minY: number, maxX: number, maxY: number): void {
    const cs = this.cellSize
    const x0 = Math.floor(minX / cs)
    const y0 = Math.floor(minY / cs)
    const x1 = Math.floor(maxX / cs)
    const y1 = Math.floor(maxY / cs)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = this.key(cx, cy)
        let cell = this.cells.get(k)
        if (!cell) { cell = []; this.cells.set(k, cell) }
        cell.push(item)
      }
    }
  }

  /** Return all unique pairs of items that share at least one cell. */
  getPotentialPairs(): Array<[T, T]> {
    const seen = new Set<string>()
    const pairs: Array<[T, T]> = []
    for (const cell of this.cells.values()) {
      for (let i = 0; i < cell.length; i++) {
        for (let j = i + 1; j < cell.length; j++) {
          const a = cell[i], b = cell[j]
          // Canonical pair key — ensures each pair is yielded once
          const pk = a.id < b.id ? `${a.id}\0${b.id}` : `${b.id}\0${a.id}`
          if (seen.has(pk)) continue
          seen.add(pk)
          pairs.push([a, b])
        }
      }
    }
    return pairs
  }
}

export class FieldSimulation {
  world: FieldWorld
  fields: Map<string, Field>
  running: boolean = false
  private fieldMemory: Map<string, FieldMemoryEntry[]> = new Map()
  private collisionState: Map<string, Set<string>> = new Map()
  /** Agent-defined interaction rules — executed each physics tick */
  interactionRules: InteractionRule[] = []
  /** Agent-defined custom commands — macros of existing commands */
  customCommands: Map<string, CustomCommand> = new Map()
  /** Agent-defined step hooks — JavaScript functions that run every simulation tick */
  stepHooks: Map<string, { author: string; description: string; code: string; fn: (sim: FieldSimulation, dt: number) => void }> = new Map()
  /** Spawn queue — fields created by step hooks are queued and processed after all hooks run */
  spawnQueue: Array<{ name: string; color: [number, number, number, number]; x: number; y: number }> = []
  /** Agent-defined interaction effects — WGSL shaders rendered at field overlap pixels */
  interactionEffects: InteractionEffect[] = []
  /** Shared world data — key-value store accessible from step hooks */
  worldData: Record<string, unknown> = {}
  /** Seeded PRNG state for sim.rand() — armed when worldData.__seed is a number */
  private _randSeed: number | null = null
  private _randState = 0
  /** Lightweight projectiles — rendered via effectData, not as fields */
  projectiles: Projectile[] = []
  /** Per-field pixel presence — populated from GPU readback of each field's rendered output.
   *  Map from fieldId → Uint8Array(gridSize × gridSize), 0 or 255 per pixel.
   *  This is the "field renders to pixels → pixels return data" pipeline. */
  fieldPresence: Map<string, Uint8Array> = new Map()
  /** Tag index — O(1) lookup from tag name to field IDs */
  tagIndex: Map<string, Set<string>> = new Map()
  /** Maps GPU super field array index → fieldId (set by render loop) */
  superFieldOrder: string[] = []
  /** Interaction pairs — maps field IDs to interaction type IDs */
  interactionPairs: { name: string; fieldA: string; fieldB: string; interactionTypeId: number; propagationTypeId?: number }[] = []
  /** GPU hit map reference — set by render loop from renderer.hitMap */
  superHitMap: Uint32Array | null = null
  superHitMapWidth: number = 0
  superHitMapHeight: number = 0
  /** Active tweens */
  tweens: Map<string, TweenDef> = new Map()
  /** Active timers */
  timers: Map<string, TimerDef> = new Map()
  /** Collision callbacks */
  collisionCallbacks: Map<string, CollisionCallback> = new Map()
  /** Game state machine */
  gameState: string = ''
  gameStates: Map<string, GameStateDef> = new Map()
  /** GPU compute step hooks — WGSL functions that run per-field on the GPU (sandboxed) */
  gpuStepHooks: Map<string, { id: string; author: string; description: string; wgsl: string; order: number }> = new Map()
  /** Dirty flag — set when GPU step hooks are added/removed */
  gpuStepHooksDirty: boolean = false

  static readonly MAX_MEMORY = 100
  static readonly MAX_PROJECTILES = 200

  /** Spatial hash for broad-phase pair queries — rebuilt each physics step */
  private spatialHash: SpatialHash<Field> = new SpatialHash<Field>(64)
  /** Cached bounds per field — recomputed once per step, shared across all queries */
  private boundsCache: Map<string, { minX: number; minY: number; maxX: number; maxY: number }> = new Map()
  /** Cached field array — rebuilt when field count changes (avoids per-frame Array.from) */
  private _fieldListCache: Field[] = []
  private _fieldListCacheSize: number = -1
  /** Per-step timestamp — computed once, shared across all memory entries */
  private _stepTimestamp: string = ''

  /** World-level physics parameters */
  worldParams: WorldParams = {
    gravity: 0,
    friction: 0,
    collisionForce: 0,
    boundaryMode: 'open',
    bounciness: 0.5,
    gravitationalConstant: 0,
  }

  gridSize: number

  constructor(gridSize: number = DEFAULT_GRID_SIZE) {
    this.gridSize = gridSize
    const totalCells = gridSize * gridSize * 4
    this.world = {
      size: gridSize,
      colorData: new Float32Array(totalCells),
      stateData: new Float32Array(totalCells),
      effectData: new Float32Array(totalCells),
    }
    this.fields = new Map()
  }

  /** Restore fields from server-stored snapshots (called on mount) */
  restoreFromSnapshots(snapshots: FieldSnapshot[]): void {
    for (const snap of snapshots) {
      this.createField(snap.id, snap.name, snap.color)
      const field = this.fields.get(snap.id)
      if (!field) continue
      Object.assign(field.transform, snap.transform)
      if (snap.effects?.length) {
        field.effects = snap.effects.map(e => ({ ...e }))
      }
      if (snap.properties) {
        for (const [k, v] of Object.entries(snap.properties)) {
          field.properties.set(k, v)
        }
      }
      if (snap.parentFieldId) {
        field.parentFieldId = snap.parentFieldId
      }
      // Restore shape properties
      if (snap.shapeType) field.shapeType = snap.shapeType
      if (snap.radius !== undefined) field.radius = snap.radius
      if (snap.w !== undefined) field.w = snap.w
      if (snap.h !== undefined) field.h = snap.h
      // Restore interaction flags (scene-shipped backdrops rely on these)
      if (snap.noHit) field.noHit = true
      if (snap.noCollide) field.noCollide = true
      // Restore tags
      if (snap.tags?.length) {
        field.tags = [...snap.tags]
        for (const tag of field.tags) {
          if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, new Set())
          this.tagIndex.get(tag)!.add(field.id)
        }
      }
      // Restore visual type for superimposed rendering
      if ((snap as FieldSnapshot & { visualType?: number }).visualType !== undefined) {
        field.visualType = (snap as FieldSnapshot & { visualType?: number }).visualType
      }
      if ((snap as FieldSnapshot & { visualTypeName?: string }).visualTypeName) {
        field.visualTypeName = (snap as FieldSnapshot & { visualTypeName?: string }).visualTypeName
      }
      if ((snap as FieldSnapshot & { visualParams?: [number, number, number, number] }).visualParams) {
        field.visualParams = [...(snap as FieldSnapshot & { visualParams?: [number, number, number, number] }).visualParams!] as [number, number, number, number]
      }
      if (snap.memory?.length) {
        this.fieldMemory.set(snap.id, [...snap.memory])
      }
      // HEAL persisted physics drift: before backdrops were pinned static
      // (e47e7e3), collision force could shove a world-covering field off
      // center and the damage SAVED with the world. A static backdrop can
      // never move again, so an off-center position on one is damage, not
      // intent — snap it home on load. `static:false` (a deliberately moving
      // backdrop) keeps whatever position it saved.
      if (this.isWorldCovering(field) && !field.parentFieldId && field.properties.get('static') !== false) {
        const c = this.gridSize / 2
        if (Math.abs(field.transform.x - c) > 0.5 || Math.abs(field.transform.y - c) > 0.5) {
          field.transform.x = c
          field.transform.y = c
          field.transform.vx = 0
          field.transform.vy = 0
        }
      }
    }
  }

  /** Update world physics parameters */
  setWorldParams(params: Partial<WorldParams>): void {
    Object.assign(this.worldParams, params)
  }

  /** Apply an instantaneous force (impulse) to a field's velocity */
  applyForce(fieldId: string, fx: number, fy: number): void {
    const field = this.fields.get(fieldId)
    if (!field) return
    field.transform.vx += fx
    field.transform.vy += fy
    this.addMemory(fieldId, {
      timestamp: new Date().toISOString(),
      type: 'force_applied',
      content: `Force applied: (${fx.toFixed(1)}, ${fy.toFixed(1)}). Velocity now (${field.transform.vx.toFixed(1)}, ${field.transform.vy.toFixed(1)})`,
      sourceFieldId: null,
      data: { fx, fy, vx: field.transform.vx, vy: field.transform.vy },
    })
  }

  static defaultTransform(): FieldTransform {
    return { x: 0, y: 0, rotation: 0, scale: 1, vx: 0, vy: 0, vr: 0 }
  }

  /** Create a new field */
  createField(id: string, name: string, color: [number, number, number, number], parentFieldId?: string): Field {
    const field: Field = {
      id,
      name,
      color,
      transform: FieldSimulation.defaultTransform(),
      effects: [],
      properties: new Map(),
    }
    if (parentFieldId && this.fields.has(parentFieldId)) {
      field.parentFieldId = parentFieldId
    }
    this.fields.set(id, field)
    this.invalidateFieldListCache()
    this.addMemory(id, {
      timestamp: new Date().toISOString(),
      type: 'created',
      content: `Field "${name}" created`,
      sourceFieldId: null,
    })
    return field
  }

  /** Remove a field — orphans any children (they keep their position) */
  removeField(id: string): void {
    // Remove from tag index
    const field = this.fields.get(id)
    if (field?.tags) {
      for (const tag of field.tags) {
        this.tagIndex.get(tag)?.delete(id)
        if (this.tagIndex.get(tag)?.size === 0) this.tagIndex.delete(tag)
      }
    }
    // Orphan all children before deleting
    for (const child of this.fields.values()) {
      if (child.parentFieldId === id) {
        child.parentFieldId = undefined
      }
    }
    this.fields.delete(id)
    this.invalidateFieldListCache()
    this.clearMemory(id)
  }

  /** Queue a field to be spawned after step hooks finish. Step hooks call this instead of createField directly. */
  queueSpawn(name: string, color: [number, number, number, number], x: number, y: number): void {
    if (this.spawnQueue.length >= 30) return
    this.spawnQueue.push({ name, color, x, y })
  }

  /** Process the spawn queue — called by the engine after step hooks run */
  processSpawnQueue(): Array<{ id: string; field: Field }> {
    const spawned: Array<{ id: string; field: Field }> = []
    for (const req of this.spawnQueue) {
      const id = 'spawn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
      const field = this.createField(id, req.name, req.color)
      field.transform.x = req.x
      field.transform.y = req.y
      spawned.push({ id, field })
    }
    this.spawnQueue = []
    return spawned
  }

  /** Clear everything */
  clearAll(): void {
    this.world.colorData.fill(0)
    this.world.stateData.fill(0)
  }

  /** Clear colorData before render. After GPU renders, colorData is populated via
   *  readbackRendered() — so it reflects actual rendered pixels, not bounding boxes.
   *  This mirrors Genesis Engine's pattern: pixel data comes from what's actually drawn. */
  paintFieldShapes(): void {
    this.world.colorData.fill(0)
  }

  /** Update field transforms based on velocities, then propagate parent deltas to children */
  stepTransforms(dt: number): void {
    // Record positions before velocity integration
    const prevPositions = new Map<string, { x: number; y: number }>()
    for (const field of this.fields.values()) {
      prevPositions.set(field.id, { x: field.transform.x, y: field.transform.y })
    }

    // Apply own velocity — but a STATIC backdrop never drifts: zero any velocity
    // it picked up (a stray force, a leftover impulse) and skip integration so
    // the fullscreen scene holds perfectly still.
    for (const field of this.fields.values()) {
      const t = field.transform
      if (this.isStaticField(field)) { t.vx = 0; t.vy = 0; t.vr = 0; continue }
      if (t.vx !== 0 || t.vy !== 0 || t.vr !== 0) {
        t.x += t.vx * dt
        t.y += t.vy * dt
        t.rotation += t.vr * dt
      }
    }

    // Propagate parent deltas to children (supports nested hierarchies up to depth 5)
    for (let depth = 0; depth < 5; depth++) {
      let anyMoved = false
      for (const field of this.fields.values()) {
        if (!field.parentFieldId) continue
        const parent = this.fields.get(field.parentFieldId)
        if (!parent) continue
        const prev = prevPositions.get(parent.id)
        if (!prev) continue
        const dx = parent.transform.x - prev.x
        const dy = parent.transform.y - prev.y
        if (dx !== 0 || dy !== 0) {
          field.transform.x += dx
          field.transform.y += dy
          anyMoved = true
        }
      }
      if (!anyMoved) break
      // Update prev positions for next depth pass
      for (const field of this.fields.values()) {
        prevPositions.set(field.id, { x: field.transform.x, y: field.transform.y })
      }
    }
  }

  /** A world-covering backdrop (the fullscreen shader) is STATIC: physics never
   *  MOVES it — no gravity, no collision/gravitation push, no velocity
   *  integration — but it still PUSHES/attracts smaller fields. A held scene
   *  that applies force without flying around (Galen: "the fullscreen field
   *  should not be moving/subject to physics though it can apply physics").
   *  Auto for `shapeType:'screen'` and world-covering rects/circles; override
   *  with property `static:false` (a moving backdrop) or `static:true` (pin a
   *  smaller field). Cached per field — the flag only changes on resize/shape. */
  private isStaticField(f: Field): boolean {
    const explicit = f.properties.get('static')
    if (explicit === true) return true
    if (explicit === false) return false
    return this.isWorldCovering(f)
  }

  /** World-covering geometry: `shapeType:'screen'` or ≥90% of the grid. */
  private isWorldCovering(f: Field): boolean {
    if (f.shapeType === 'screen') return true
    const w = f.w ?? (f.radius ? f.radius * 2 : 0)
    const h = f.h ?? (f.radius ? f.radius * 2 : 0)
    return w >= DEFAULT_GRID_SIZE * 0.9 && h >= DEFAULT_GRID_SIZE * 0.9
  }

  /** Get cached field list — rebuilt only when field count changes */
  private getFieldList(): Field[] {
    if (this.fields.size !== this._fieldListCacheSize) {
      this._fieldListCache = Array.from(this.fields.values())
      this._fieldListCacheSize = this.fields.size
    }
    return this._fieldListCache
  }

  /** Invalidate field list cache (call on field add/remove) */
  private invalidateFieldListCache(): void {
    this._fieldListCacheSize = -1
  }

  /** The game loop step — called every frame when running */
  step(dt: number): void {
    if (!this.running) return

    // Compute per-step timestamp once (shared across all memory entries this frame)
    this._stepTimestamp = new Date().toISOString()

    // Check if current game state pauses physics
    const currentGameState = this.gameState ? this.gameStates.get(this.gameState) : null
    const physicsActive = !currentGameState?.pausePhysics

    const wp = this.worldParams

    if (physicsActive) {
      // Rebuild spatial hash for broad-phase pair queries (O(n))
      this.rebuildSpatialHash()

      // Apply gravity to all fields — except a static backdrop (it doesn't fall)
      if (wp.gravity !== 0) {
        for (const field of this.fields.values()) {
          if (this.isStaticField(field)) continue
          field.transform.vy += wp.gravity * dt
        }
      }

      // Apply friction (velocity damping)
      if (wp.friction > 0) {
        const damping = Math.max(0, 1 - wp.friction * dt)
        for (const field of this.fields.values()) {
          field.transform.vx *= damping
          field.transform.vy *= damping
          field.transform.vr *= damping
          if (Math.abs(field.transform.vx) < 0.01) field.transform.vx = 0
          if (Math.abs(field.transform.vy) < 0.01) field.transform.vy = 0
          if (Math.abs(field.transform.vr) < 0.001) field.transform.vr = 0
        }
      }

      // N-body gravitational attraction/repulsion between fields
      if (wp.gravitationalConstant !== 0) {
        this.stepGravitation(dt)
      }

      // Collision detection + forces
      this.stepCollisions(dt)

      // Agent-defined interaction rules
      this.stepInteractionRules(dt)
    }

    // Agent-defined step hooks (always run, even when physics paused).
    // Determinism opt-in: worldData.__fixedStep (seconds) pins the dt every
    // hook sees to one exact quantum — one tick per rendered frame, same tick
    // sequence every run. Pair with worldData.__seed + sim.rand() for replays.
    const fs = this.worldData['__fixedStep']
    const hookDt = (typeof fs === 'number' && fs > 0) ? Math.min(fs, 0.1) : dt
    const seed = this.worldData['__seed']
    if (typeof seed === 'number' && seed !== this._randSeed) {
      this._randSeed = seed
      this._randState = seed | 0
    }
    for (const [hookId, hook] of this.stepHooks) {
      try {
        hook.fn(this, hookDt)
      } catch (e) {
        console.warn(`Step hook ${hookId} failed:`, e)
        this.reportHookError(hookId, e)
      }
    }

    // Process spawn queue (fields created by step hooks)
    if (this.spawnQueue.length > 0) {
      this.processSpawnQueue()
    }

    if (physicsActive) {
      // Boundary enforcement
      if (wp.boundaryMode === 'solid') {
        this.stepBoundaries()
      } else if (wp.boundaryMode === 'wrap') {
        this.stepWrapBoundaries()
      }

      // Update field transforms (velocity → position)
      this.stepTransforms(dt)
    }

    // Update particles (fade, shrink, despawn expired)
    this.stepParticles(dt)

    // Update projectiles and stamp into effectData
    this.stepProjectiles(dt)

    // Fade effect layer
    this.fadeEffects(dt)

    // Step tweens (always run)
    this.stepTweens(dt)

    // Step timers (always run)
    this.stepTimers(dt)

    // Step collision callbacks (only when physics active)
    if (physicsActive) {
      this.stepCollisionCallbacks()
    }
  }

  /** Apply n-body gravitational attraction/repulsion between all field pairs */
  private stepGravitation(dt: number): void {
    const G = this.worldParams.gravitationalConstant
    const fieldList = this.getFieldList()
    const minDist = 10 // Prevent singularity at zero distance

    for (let i = 0; i < fieldList.length; i++) {
      for (let j = i + 1; j < fieldList.length; j++) {
        const a = fieldList[i]
        const b = fieldList[j]

        const dx = b.transform.x - a.transform.x
        const dy = b.transform.y - a.transform.y
        const distSq = dx * dx + dy * dy
        const dist = Math.sqrt(distSq)
        if (dist < minDist) continue

        // F = G / r^2, applied along the direction between fields
        const force = G / distSq * dt
        const nx = dx / dist
        const ny = dy / dist

        // a static backdrop still ATTRACTS the field (it applies physics), but
        // the pull never MOVES the backdrop itself
        if (!this.isStaticField(a)) { a.transform.vx += nx * force; a.transform.vy += ny * force }
        if (!this.isStaticField(b)) { b.transform.vx -= nx * force; b.transform.vy -= ny * force }
      }
    }
  }

  /** Rebuild spatial hash from current field positions — call once per physics step.
   *  @param inflate — dilate each AABB by this many pixels (for spread/proximity queries) */
  private rebuildSpatialHash(inflate: number = 0): void {
    this.spatialHash.clear()
    this.boundsCache.clear()
    for (const field of this.fields.values()) {
      const bounds = this.getFieldBounds(field.id)
      if (!bounds) continue
      this.boundsCache.set(field.id, bounds)
      this.spatialHash.insertAABB(
        field,
        bounds.minX - inflate, bounds.minY - inflate,
        bounds.maxX + inflate, bounds.maxY + inflate,
      )
    }
  }

  /** Lazily yield all unique field pairs — O(n²) fallback for rules that need every pair */
  private *allFieldPairs(): Generator<[Field, Field]> {
    const fieldList = this.getFieldList()
    for (let i = 0; i < fieldList.length; i++) {
      for (let j = i + 1; j < fieldList.length; j++) {
        yield [fieldList[i], fieldList[j]]
      }
    }
  }

  /** Detect collisions between fields and fire events + apply forces */
  private stepCollisions(dt: number): void {
    const wp = this.worldParams
    const pairs = this.spatialHash.getPotentialPairs()

    for (const [a, b] of pairs) {
      // Backdrops opt out: a world-sized visual field overlaps everything forever —
      // collision forces from every body would shove the whole picture around.
      if (a.noCollide || b.noCollide) continue
      const boundsA = this.boundsCache.get(a.id) || this.getFieldBounds(a.id)
      const boundsB = this.boundsCache.get(b.id) || this.getFieldBounds(b.id)
      if (!boundsA || !boundsB) continue

      const overlapX = Math.min(boundsA.maxX, boundsB.maxX) - Math.max(boundsA.minX, boundsB.minX)
      const overlapY = Math.min(boundsA.maxY, boundsB.maxY) - Math.max(boundsA.minY, boundsB.minY)
      const overlapping = overlapX > 0 && overlapY > 0

      const wasColliding = this.collisionState.get(a.id)?.has(b.id) || false

      if (overlapping && !wasColliding) {
        if (!this.collisionState.has(a.id)) this.collisionState.set(a.id, new Set())
        if (!this.collisionState.has(b.id)) this.collisionState.set(b.id, new Set())
        this.collisionState.get(a.id)!.add(b.id)
        this.collisionState.get(b.id)!.add(a.id)

        this.addMemory(a.id, {
          timestamp: this._stepTimestamp,
          type: 'collision',
          content: `Collision with ${b.name} (overlap: ${Math.min(overlapX, overlapY).toFixed(0)}px)`,
          sourceFieldId: b.id,
          data: { overlapX, overlapY, otherFieldId: b.id, otherFieldName: b.name },
        })
        this.addMemory(b.id, {
          timestamp: this._stepTimestamp,
          type: 'collision',
          content: `Collision with ${a.name} (overlap: ${Math.min(overlapX, overlapY).toFixed(0)}px)`,
          sourceFieldId: a.id,
          data: { overlapX, overlapY, otherFieldId: a.id, otherFieldName: a.name },
        })
      } else if (!overlapping && wasColliding) {
        this.collisionState.get(a.id)?.delete(b.id)
        this.collisionState.get(b.id)?.delete(a.id)
      }

      if (overlapping && wp.collisionForce !== 0) {
        const aCenterX = (boundsA.minX + boundsA.maxX) / 2
        const aCenterY = (boundsA.minY + boundsA.maxY) / 2
        const bCenterX = (boundsB.minX + boundsB.maxX) / 2
        const bCenterY = (boundsB.minY + boundsB.maxY) / 2

        let dx = bCenterX - aCenterX
        let dy = bCenterY - aCenterY
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        dx /= len
        dy /= len

        const overlap = Math.min(overlapX, overlapY)
        const forceMag = wp.collisionForce * overlap * dt

        // a static backdrop pushes bodies OUT of itself but is never pushed —
        // otherwise every overlapping body would shove the whole scene around
        if (!this.isStaticField(a)) { a.transform.vx -= dx * forceMag; a.transform.vy -= dy * forceMag }
        if (!this.isStaticField(b)) { b.transform.vx += dx * forceMag; b.transform.vy += dy * forceMag }
      }
    }
  }

  /** Execute agent-defined interaction rules between field pairs */
  private stepInteractionRules(dt: number): void {
    if (this.interactionRules.length === 0) return

    let hashPairs: Array<[Field, Field]> | null = null // lazy — only built when needed

    for (const rule of this.interactionRules) {
      // Choose the optimal pair source for this rule
      let pairs: Iterable<[Field, Field]>

      if (rule.fieldA && rule.fieldB) {
        // Both fields specified — O(1) direct check
        const a = this.fields.get(rule.fieldA)
        const b = this.fields.get(rule.fieldB)
        if (!a || !b) continue
        pairs = [[a, b]]
      } else if (rule.trigger === 'overlap') {
        // Wildcard overlap — spatial hash broad-phase
        if (!hashPairs) hashPairs = this.spatialHash.getPotentialPairs()
        pairs = hashPairs
      } else {
        // Wildcard proximity/always — need all pairs (O(n²) fallback)
        pairs = this.allFieldPairs()
      }

      for (const [a, b] of pairs) {
        const matchesAB = (!rule.fieldA || rule.fieldA === a.id) && (!rule.fieldB || rule.fieldB === b.id)
        const matchesBA = (!rule.fieldA || rule.fieldA === b.id) && (!rule.fieldB || rule.fieldB === a.id)
        if (!matchesAB && !matchesBA) continue

        const [fa, fb] = matchesAB ? [a, b] : [b, a]

        const boundsA = this.boundsCache.get(fa.id) || this.getFieldBounds(fa.id)
        const boundsB = this.boundsCache.get(fb.id) || this.getFieldBounds(fb.id)
        if (!boundsA || !boundsB) continue

        const overlapX = Math.min(boundsA.maxX, boundsB.maxX) - Math.max(boundsA.minX, boundsB.minX)
        const overlapY = Math.min(boundsA.maxY, boundsB.maxY) - Math.max(boundsA.minY, boundsB.minY)
        const overlapping = overlapX > 0 && overlapY > 0

        const aCx = (boundsA.minX + boundsA.maxX) / 2
        const aCy = (boundsA.minY + boundsA.maxY) / 2
        const bCx = (boundsB.minX + boundsB.maxX) / 2
        const bCy = (boundsB.minY + boundsB.maxY) / 2
        const dist = Math.sqrt((bCx - aCx) ** 2 + (bCy - aCy) ** 2)

        let triggered = false
        if (rule.trigger === 'overlap' && overlapping) triggered = true
        if (rule.trigger === 'proximity' && dist < (rule.triggerDistance || 100)) triggered = true
        if (rule.trigger === 'always') triggered = true

        if (!triggered) continue

        const p = rule.effectParams
        switch (rule.effect) {
          case 'apply_force': {
            if (p.impulse) {
              const cooldown = (p.cooldown as number) || 0.5
              const forceKey = `force_${rule.id}_${fa.id}_${fb.id}`
              const now = Date.now()
              const lastFired = this._ruleEventThrottle.get(forceKey) || 0
              if (now - lastFired < cooldown * 1000) break
              this._ruleEventThrottle.set(forceKey, now)
              const fx = (p.fx as number || 0)
              const fy = (p.fy as number || 0)
              fa.transform.vx += fx
              fa.transform.vy += fy
              fb.transform.vx -= fx
              fb.transform.vy -= fy
            } else {
              const fx = (p.fx as number || 0) * dt
              const fy = (p.fy as number || 0) * dt
              fa.transform.vx += fx
              fa.transform.vy += fy
              fb.transform.vx -= fx
              fb.transform.vy -= fy
            }
            break
          }
          case 'send_event': {
            const eventKey = `rule_${rule.id}_${fa.id}_${fb.id}`
            const now = Date.now()
            const lastFired = this._ruleEventThrottle.get(eventKey) || 0
            if (now - lastFired > 1000) {
              this._ruleEventThrottle.set(eventKey, now)
              const content = p.message as string || `Interaction rule "${rule.description || rule.id}" triggered`
              this.addMemory(fa.id, {
                timestamp: this._stepTimestamp,
                type: 'collision',
                content,
                sourceFieldId: fb.id,
                data: { ruleId: rule.id, effect: rule.effect },
              })
            }
            break
          }
        }
      }
    }
  }
  private _ruleEventThrottle: Map<string, number> = new Map()

  /** Add an interaction rule. Returns the rule's id. */
  addInteractionRule(rule: InteractionRule): string {
    const id = rule.id || `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.interactionRules.push({ ...rule, id })
    return id
  }

  /** Remove an interaction rule by id */
  removeInteractionRule(ruleId: string): boolean {
    const before = this.interactionRules.length
    this.interactionRules = this.interactionRules.filter(r => r.id !== ruleId)
    return this.interactionRules.length < before
  }

  /** Register a custom command macro */
  addCustomCommand(cmd: CustomCommand): void {
    this.customCommands.set(cmd.name, cmd)
  }

  /** Get a custom command by name */
  getCustomCommand(name: string): CustomCommand | undefined {
    return this.customCommands.get(name)
  }

  /** Enforce solid boundaries — bounce fields off grid edges using analytic bounds */
  private stepBoundaries(): void {
    const wp = this.worldParams
    for (const field of this.fields.values()) {
      if (this.isStaticField(field)) continue   // a backdrop is the walls, not a body — never bounced
      const bounds = this.getFieldBounds(field.id)
      if (!bounds) continue

      // A field as wide/tall as the world can't be contained — it IS the walls.
      // Enforcing the boundary on it just ping-pongs it 1px every frame (the
      // "vibration" that hit every full-screen backdrop). It's a backdrop, not a
      // physics body: skip containment on any axis where it doesn't fit inside.
      const fitsX = (bounds.maxX - bounds.minX) < this.gridSize
      const fitsY = (bounds.maxY - bounds.minY) < this.gridSize

      if (fitsX) {
        if (bounds.minX < 0) {
          field.transform.x -= bounds.minX
          if (field.transform.vx < 0) field.transform.vx = -field.transform.vx * wp.bounciness
        }
        if (bounds.maxX >= this.gridSize) {
          field.transform.x -= (bounds.maxX - (this.gridSize - 1))
          if (field.transform.vx > 0) field.transform.vx = -field.transform.vx * wp.bounciness
        }
      }
      if (fitsY) {
        if (bounds.minY < 0) {
          field.transform.y -= bounds.minY
          if (field.transform.vy < 0) field.transform.vy = -field.transform.vy * wp.bounciness
        }
        if (bounds.maxY >= this.gridSize) {
          field.transform.y -= (bounds.maxY - (this.gridSize - 1))
          if (field.transform.vy > 0) field.transform.vy = -field.transform.vy * wp.bounciness
        }
      }
    }
  }

  /** Wrap boundaries — toroidal topology. Fields wrap around grid edges. */
  private stepWrapBoundaries(): void {
    for (const field of this.fields.values()) {
      const t = field.transform
      // Wrap position around grid
      if (t.x < 0) t.x += this.gridSize
      if (t.x >= this.gridSize) t.x -= this.gridSize
      if (t.y < 0) t.y += this.gridSize
      if (t.y >= this.gridSize) t.y -= this.gridSize
    }
  }

  /** Wrap fields around grid edges — fields exiting one side appear on the opposite side */
  private stepBoundaryWrap(): void {
    for (const field of this.fields.values()) {
      const t = field.transform
      const bounds = this.getFieldBounds(field.id)
      if (!bounds) continue

      const fieldW = bounds.maxX - bounds.minX
      const fieldH = bounds.maxY - bounds.minY

      // Wrap horizontally
      if (bounds.maxX < 0) {
        t.x += this.gridSize + fieldW
      } else if (bounds.minX >= this.gridSize) {
        t.x -= this.gridSize + fieldW
      }

      // Wrap vertically
      if (bounds.maxY < 0) {
        t.y += this.gridSize + fieldH
      } else if (bounds.minY >= this.gridSize) {
        t.y -= this.gridSize + fieldH
      }
    }
  }

  /** Register a step hook — runs every simulation tick. Returns null on success, error string on failure. */
  addStepHook(id: string, author: string, description: string, code: string): string | null {
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function('sim', 'dt', code) as (sim: FieldSimulation, dt: number) => void
      this.stepHooks.set(id, { author, description, code, fn })
      return null
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`Failed to compile step hook ${id}:`, msg)
      return msg
    }
  }

  /** Remove a step hook */
  removeStepHook(id: string): void {
    this.stepHooks.delete(id)
  }

  /** Serialize step hooks for state sync (excludes fn) */
  getStepHookSnapshots(): Array<{ id: string; author: string; description: string; code: string }> {
    const result: Array<{ id: string; author: string; description: string; code: string }> = []
    for (const [id, hook] of this.stepHooks) {
      result.push({ id, author: hook.author, description: hook.description, code: hook.code })
    }
    return result
  }

  // ─── GPU Step Hooks (WGSL — sandboxed) ───

  /** Add a GPU step hook (WGSL compute shader, runs per-field on GPU) */
  addGpuStepHook(id: string, author: string, description: string, wgsl: string, order?: number): string | null {
    this.gpuStepHooks.set(id, { id, author, description, wgsl, order: order ?? this.gpuStepHooks.size })
    this.gpuStepHooksDirty = true
    return null
  }

  /** Remove a GPU step hook */
  removeGpuStepHook(id: string): void {
    this.gpuStepHooks.delete(id)
    this.gpuStepHooksDirty = true
  }

  /** Serialize GPU step hooks for state sync */
  getGpuStepHookSnapshots(): Array<{ id: string; author: string; description: string; wgsl: string; order: number }> {
    return Array.from(this.gpuStepHooks.values())
  }

  /** Get sorted GPU step hooks for shader compilation */
  getSortedGpuStepHooks(): Array<{ id: string; wgsl: string }> {
    return Array.from(this.gpuStepHooks.values())
      .sort((a, b) => a.order - b.order)
      .map(h => ({ id: h.id, wgsl: h.wgsl }))
  }


  /** Find a field by name (convenience for step hooks: sim.getFieldByName('Alpha')) */
  getFieldByName(name: string): Field | null {
    for (const field of this.fields.values()) {
      if (field.name === name) return field
    }
    return null
  }

  /** Get distance between two fields by their center points */
  getFieldDistance(fieldA: Field, fieldB: Field): number {
    const dx = fieldA.transform.x - fieldB.transform.x
    const dy = fieldA.transform.y - fieldB.transform.y
    return Math.sqrt(dx * dx + dy * dy)
  }

  /** Find all fields within a radius of a point (for step hooks: sim.getFieldsNear(256, 256, 100)) */
  getFieldsNear(x: number, y: number, radius: number): Field[] {
    const result: Field[] = []
    const r2 = radius * radius
    for (const field of this.fields.values()) {
      const dx = field.transform.x - x
      const dy = field.transform.y - y
      if (dx * dx + dy * dy <= r2) {
        result.push(field)
      }
    }
    return result
  }

  /** Broadcast a message to all fields from a source field */
  broadcastMessage(fromFieldId: string, content: string, data?: Record<string, unknown>): void {
    const fromField = this.fields.get(fromFieldId)
    if (!fromField) return
    for (const [id, field] of this.fields) {
      if (id === fromFieldId) continue
      this.addMemory(id, {
        timestamp: new Date().toISOString(),
        type: 'message_received',
        content: `[Broadcast from ${fromField.name}] ${content}`,
        sourceFieldId: fromFieldId,
        data,
      })
    }
  }

  /** Get the total energy across all non-particle fields */
  getTotalEnergy(): number {
    let total = 0
    for (const field of this.fields.values()) {
      if (field.name.startsWith('spark') || field.name.startsWith('particle') || field.name.startsWith('comet')) continue
      const energy = field.properties.get('energy')
      if (typeof energy === 'number') total += energy
    }
    return total
  }

  /** Get count of non-particle fields */
  getFieldCount(): number {
    let count = 0
    for (const field of this.fields.values()) {
      if (!field.name.startsWith('spark') && !field.name.startsWith('particle') && !field.name.startsWith('comet')) count++
    }
    return count
  }

  /** Given a grid coordinate (float), return the topmost field at this pixel.
   *  Prefers pixel-perfect presence data from GPU readback when available,
   *  falls back to rectangular bounds when presence isn't ready yet.
   *  Iterates in reverse insertion order so the most recently created field wins. */
  getFieldAtPoint(x: number, y: number): Field | null {
    // Use GPU hit map for pixel-perfect hit testing (from uber-shader readback)
    if (this.superHitMap && this.superHitMapWidth > 0 && this.superFieldOrder.length > 0) {
      const fieldId = this.getFieldAtPixelFromHitMap(x, y)
      if (fieldId) {
        const field = this.fields.get(fieldId)
        if (field) return field
      }
      // If hit map says no field here, still check per-field presence below
    }

    const px = Math.floor(x)
    const py = Math.floor(y)
    const hasPresence = this.fieldPresence.size > 0
    const inBounds = px >= 0 && px < this.gridSize && py >= 0 && py < this.gridSize
    const idx = py * this.gridSize + px

    if (hasPresence && inBounds) {
      const fields = this.getFieldList()
      for (const field of fields) {
        if (field.noHit) continue
        const presence = this.fieldPresence.get(field.id)
        if (presence && presence[idx] > 0) {
          return field
        }
      }
    }

    return null
  }

  /** Look up the GPU hit map to find which field is at a grid coordinate.
   *  Converts grid coords → screen pixel using the same camera transform as the shader. */
  private getFieldAtPixelFromHitMap(gridX: number, gridY: number): string | null {
    if (!this.superHitMap || !this.superHitMapWidth || !this.superHitMapHeight) return null

    // We need to convert grid coordinates to pixel coordinates
    // This must match the shader's gridCoord → pixel mapping (inverse of what the shader does)
    // The hit map is stored by the FieldEngine with camera/zoom context
    // We use screenToGridInverse stored on the simulation
    const px = this._gridToPixelX
    const py = this._gridToPixelY
    if (!px || !py) return null

    const pixelX = Math.floor(px(gridX))
    const pixelY = Math.floor(py(gridY))

    if (pixelX < 0 || pixelX >= this.superHitMapWidth || pixelY < 0 || pixelY >= this.superHitMapHeight) return null

    const idx = pixelY * this.superHitMapWidth + pixelX
    const fieldIdx = this.superHitMap[idx]
    if (fieldIdx === 0xFFFFFFFF || fieldIdx >= this.superFieldOrder.length) return null

    return this.superFieldOrder[fieldIdx]
  }

  /** Grid-to-pixel conversion functions, set by the render loop */
  _gridToPixelX: ((gx: number) => number) | null = null
  _gridToPixelY: ((gy: number) => number) | null = null

  /** Given a grid coordinate, return the field whose bounds contain it, or null */
  getFieldAtCell(x: number, y: number): Field | null {
    return this.getFieldAtPoint(x, y)
  }

  /** Get all field IDs present at a specific pixel, based on GPU-rendered presence data.
   *  This is pixel-perfect: only returns fields whose shaders actually rendered at this pixel. */
  getFieldsAtPixel(x: number, y: number): string[] {
    if (x < 0 || x >= this.gridSize || y < 0 || y >= this.gridSize) return []
    const idx = y * this.gridSize + x
    const result: string[] = []
    for (const [fieldId, presence] of this.fieldPresence) {
      if (presence[idx] > 0) {
        result.push(fieldId)
      }
    }
    return result
  }

  /** Compute pixel-level overlap mask between two fields using GPU-rendered presence data.
   *  Returns null if either field has no presence data or there's no pixel overlap. */
  computePixelOverlapMask(fieldAId: string, fieldBId: string, spread: number = 0): Uint8Array | null {
    let presA = this.fieldPresence.get(fieldAId)
    let presB = this.fieldPresence.get(fieldBId)
    if (!presA || !presB) return null

    // Dilate each field's presence BEFORE the AND — fields "reach" toward each other
    // by `spread` pixels, so the interaction zone starts before strict pixel overlap.
    // With spread=12, fields within 24px (12+12) of each other get an interaction zone.
    if (spread > 0) {
      presA = this.dilateMask(presA, spread)
      presB = this.dilateMask(presB, spread)
    }

    const overlap = new Uint8Array(this.gridSize * this.gridSize)
    let hasOverlap = false
    for (let i = 0; i < this.gridSize * this.gridSize; i++) {
      if (presA[i] > 0 && presB[i] > 0) {
        overlap[i] = 255
        hasOverlap = true
      }
    }

    if (!hasOverlap) return null
    return overlap
  }

  /** Query cell presence data at a single pixel — uses GPU-rendered presence for pixel-perfect results */
  getCellInfo(x: number, y: number): { color: [number, number, number, number]; fieldCount: number; fieldIds: string[] } | null {
    if (x < 0 || x >= this.gridSize || y < 0 || y >= this.gridSize) return null

    // Use pixel-perfect presence data from GPU readback
    const fieldIds = this.getFieldsAtPixel(x, y)

    return {
      color: [0, 0, 0, fieldIds.length],
      fieldCount: fieldIds.length,
      fieldIds,
    }
  }

  /** Sample aggregate field presence info over a rectangular region */
  sampleRegion(cx: number, cy: number, radius: number): { avgColor: [number, number, number]; totalFieldCount: number; uniqueFieldIds: string[] } {
    const minX = Math.max(0, Math.floor(cx - radius))
    const maxX = Math.min(this.gridSize - 1, Math.ceil(cx + radius))
    const minY = Math.max(0, Math.floor(cy - radius))
    const maxY = Math.min(this.gridSize - 1, Math.ceil(cy + radius))

    let rSum = 0, gSum = 0, bSum = 0, count = 0, totalFields = 0
    const fieldIdSet = new Set<string>()

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = (y * this.gridSize + x) * 4
        const fc = this.world.colorData[idx + 3]
        if (fc > 0) {
          rSum += this.world.colorData[idx]
          gSum += this.world.colorData[idx + 1]
          bSum += this.world.colorData[idx + 2]
          totalFields += fc
          count++
        }
      }
    }

    // Resolve field IDs from bounds
    for (const field of this.fields.values()) {
      const bounds = this.getFieldBounds(field.id)
      if (!bounds) continue
      if (bounds.maxX >= minX && bounds.minX <= maxX && bounds.maxY >= minY && bounds.minY <= maxY) {
        fieldIdSet.add(field.id)
      }
    }

    return {
      avgColor: count > 0 ? [rSum / count, gSum / count, bSum / count] : [0, 0, 0],
      totalFieldCount: Math.round(totalFields),
      uniqueFieldIds: Array.from(fieldIdSet),
    }
  }

  /** Get the axis-aligned bounding box of a field — shader execution area centered on position.
   *  Uses actual shape dimensions (radius/w/h) when available, falls back to FIELD_RENDER_EXTENT. */
  getFieldBounds(fieldId: string): { minX: number; minY: number; maxX: number; maxY: number } | null {
    const field = this.fields.get(fieldId)
    if (!field) return null
    const t = field.transform
    const s = t.scale

    if (field.shapeType === 'circle' && field.radius) {
      const r = field.radius * s
      return { minX: t.x - r, minY: t.y - r, maxX: t.x + r, maxY: t.y + r }
    } else if ((field.shapeType === 'rect' || field.shapeType === 'screen') && field.w && field.h) {
      const hw = (field.w / 2) * s
      const hh = (field.h / 2) * s
      return { minX: t.x - hw, minY: t.y - hh, maxX: t.x + hw, maxY: t.y + hh }
    }

    // Fallback for fields without shape info
    const r = FIELD_RENDER_EXTENT * s
    return { minX: t.x - r, minY: t.y - r, maxX: t.x + r, maxY: t.y + r }
  }

  /** Get the center of a field */
  getFieldCenter(fieldId: string): { x: number; y: number } | null {
    const bounds = this.getFieldBounds(fieldId)
    if (!bounds) return null
    return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
  }

  /** Set field position directly */
  setPosition(fieldId: string, x: number, y: number): void {
    const field = this.fields.get(fieldId)
    if (!field) return
    field.transform.x = x
    field.transform.y = y
  }

  /** Get all direct children of a field */
  getChildren(fieldId: string): Field[] {
    const children: Field[] = []
    for (const field of this.fields.values()) {
      if (field.parentFieldId === fieldId) {
        children.push(field)
      }
    }
    return children
  }

  /** Get the nesting depth of a field (0 = top-level, 1 = child of top-level, etc.) */
  private getDepth(fieldId: string): number {
    let depth = 0
    let currentId: string | undefined = fieldId
    const visited = new Set<string>()
    while (currentId) {
      if (visited.has(currentId)) break // cycle protection
      visited.add(currentId)
      const field = this.fields.get(currentId)
      if (!field?.parentFieldId) break
      currentId = field.parentFieldId
      depth++
    }
    return depth
  }

  /** Set or clear a field's parent. Validates parent exists and enforces depth limit of 5. */
  setParent(fieldId: string, parentFieldId?: string): boolean {
    const field = this.fields.get(fieldId)
    if (!field) return false

    // Clear parent
    if (!parentFieldId) {
      field.parentFieldId = undefined
      return true
    }

    // Can't parent to self
    if (parentFieldId === fieldId) return false

    // Parent must exist
    if (!this.fields.has(parentFieldId)) return false

    // Prevent cycles: walk up from parentFieldId, ensure we don't reach fieldId
    let currentId: string | undefined = parentFieldId
    const visited = new Set<string>()
    while (currentId) {
      if (currentId === fieldId) return false // would create cycle
      if (visited.has(currentId)) break
      visited.add(currentId)
      const parent = this.fields.get(currentId)
      currentId = parent?.parentFieldId
    }

    // Check depth limit: depth of parent + 1 (for this field) + max child depth below this field
    const parentDepth = this.getDepth(parentFieldId)
    if (parentDepth + 1 >= 5) return false

    field.parentFieldId = parentFieldId
    return true
  }

  /** Add an effect to a field's effect stack */
  addFieldEffect(fieldId: string, effect: FieldEffect): void {
    const field = this.fields.get(fieldId)
    if (!field) return
    field.effects.push(effect)
    field.effects.sort((a, b) => a.order - b.order)
    this.addMemory(fieldId, {
      timestamp: new Date().toISOString(),
      type: 'effect_added',
      content: `Effect added: "${effect.description}" (${effect.blend} blend)`,
      sourceFieldId: null,
      data: { effectId: effect.id, author: effect.author },
    })
  }

  /** Remove an effect from a field's stack by effectId */
  removeFieldEffect(fieldId: string, effectId: string): boolean {
    const field = this.fields.get(fieldId)
    if (!field) return false
    const before = field.effects.length
    field.effects = field.effects.filter(e => e.id !== effectId)
    if (field.effects.length < before) {
      this.addMemory(fieldId, {
        timestamp: new Date().toISOString(),
        type: 'effect_removed',
        content: `Effect removed: ${effectId}`,
        sourceFieldId: null,
      })
      return true
    }
    return false
  }

  /** Get proximity info for a field relative to all other fields */
  getProximity(fieldId: string): FieldProximity[] {
    const field = this.fields.get(fieldId)
    if (!field) return []
    const myCenter = this.getFieldCenter(fieldId)
    const myBounds = this.getFieldBounds(fieldId)
    if (!myCenter || !myBounds) return []

    const result: FieldProximity[] = []
    for (const other of this.fields.values()) {
      if (other.id === fieldId) continue
      const ob = this.getFieldBounds(other.id)
      const oc = this.getFieldCenter(other.id)
      if (!ob || !oc) continue

      const gapX = Math.max(myBounds.minX - ob.maxX, ob.minX - myBounds.maxX, 0)
      const gapY = Math.max(myBounds.minY - ob.maxY, ob.minY - myBounds.maxY, 0)
      const overlapX = Math.min(myBounds.maxX, ob.maxX) - Math.max(myBounds.minX, ob.minX)
      const overlapY = Math.min(myBounds.maxY, ob.maxY) - Math.max(myBounds.minY, ob.minY)
      const overlapping = overlapX > 0 && overlapY > 0
      const distance = overlapping
        ? -Math.min(overlapX, overlapY)
        : Math.round(Math.sqrt(gapX * gapX + gapY * gapY))

      const dirX = oc.x - myCenter.x
      const dirY = oc.y - myCenter.y
      const len = Math.sqrt(dirX * dirX + dirY * dirY) || 1

      result.push({
        fieldId: other.id,
        fieldName: other.name,
        distance,
        direction: [dirX / len, dirY / len],
        overlapping,
      })
    }
    return result
  }

  /** Add a memory entry to a field's history */
  addMemory(fieldId: string, entry: FieldMemoryEntry): void {
    let entries = this.fieldMemory.get(fieldId)
    if (!entries) {
      entries = []
      this.fieldMemory.set(fieldId, entries)
    }
    entries.push(entry)
    if (entries.length > FieldSimulation.MAX_MEMORY) {
      entries.splice(0, entries.length - FieldSimulation.MAX_MEMORY)
    }
  }

  /** Get memory entries for a field */
  getMemory(fieldId: string): FieldMemoryEntry[] {
    return this.fieldMemory.get(fieldId) || []
  }

  /** Clear memory for a field */
  clearMemory(fieldId: string): void {
    this.fieldMemory.delete(fieldId)
  }

  /** Get current world params for serialization */
  getWorldParams(): WorldParams {
    return { ...this.worldParams }
  }

  /** Serialize all fields to snapshots for the state store */
  generateSnapshots(): FieldSnapshot[] {
    const snapshots: FieldSnapshot[] = []
    for (const field of this.fields.values()) {
      const center = this.getFieldCenter(field.id)
      let stateAtCenter: { r: number; g: number; b: number; a: number } | undefined
      if (center) {
        const cx = Math.floor(center.x), cy = Math.floor(center.y)
        if (cx >= 0 && cx < this.gridSize && cy >= 0 && cy < this.gridSize) {
          const base = (cy * this.gridSize + cx) * 4
          stateAtCenter = { r: this.world.stateData[base], g: this.world.stateData[base + 1], b: this.world.stateData[base + 2], a: this.world.stateData[base + 3] }
        }
      }
      snapshots.push({
        id: field.id,
        name: field.name,
        color: field.color,
        effects: field.effects.map(e => ({
          id: e.id, author: e.author, wgsl: e.wgsl,
          description: e.description, blend: e.blend, order: e.order,
        })),
        transform: { ...field.transform },
        memory: [...this.getMemory(field.id)],
        proximity: this.getProximity(field.id),
        stateAtCenter,
        properties: Object.fromEntries(field.properties),
        parentFieldId: field.parentFieldId,
        ...(field.shapeType ? { shapeType: field.shapeType } : {}),
        ...(field.radius !== undefined ? { radius: field.radius } : {}),
        ...(field.w !== undefined ? { w: field.w } : {}),
        ...(field.h !== undefined ? { h: field.h } : {}),
        ...(field.tags?.length ? { tags: [...field.tags] } : {}),
        ...(field.visualType !== undefined ? { visualType: field.visualType } : {}),
        ...(field.visualTypeName ? { visualTypeName: field.visualTypeName } : {}),
        ...(field.visualParams ? { visualParams: [...field.visualParams] as [number, number, number, number] } : {}),
      } as FieldSnapshot)
    }
    return snapshots
  }

  /** Return all fields that have at least one effect */
  getFieldsWithEffects(): Field[] {
    const result: Field[] = []
    for (const field of this.fields.values()) {
      if (field.effects.length > 0) result.push(field)
    }
    return result
  }

  /** Particle system — temporary fields that auto-despawn after a lifetime */
  private particles: Map<string, { id: string; lifetime: number; maxLifetime: number; fieldId: string }> = new Map()

  /** Spawn a particle — a temporary field with a limited lifetime (seconds) */
  spawnParticle(name: string, color: [number, number, number, number], x: number, y: number, vx: number, vy: number, lifetime: number = 2.0): string {
    const id = 'particle_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
    const field = this.createField(id, name, color)
    field.transform.x = x
    field.transform.y = y
    field.transform.vx = vx
    field.transform.vy = vy
    field.transform.scale = 0.25
    this.particles.set(id, { id, lifetime, maxLifetime: lifetime, fieldId: id })
    return id
  }

  /** Update particles — decrement lifetime, fade alpha, remove expired */
  stepParticles(dt: number): string[] {
    const expired: string[] = []
    for (const [id, particle] of this.particles) {
      particle.lifetime -= dt
      const field = this.fields.get(particle.fieldId)
      if (!field) {
        expired.push(id)
        continue
      }
      // Fade alpha based on remaining lifetime
      const lifeFrac = Math.max(0, particle.lifetime / particle.maxLifetime)
      field.color[3] = lifeFrac
      // Shrink as it dies
      field.transform.scale = lifeFrac
      if (particle.lifetime <= 0) {
        expired.push(id)
        this.removeField(particle.fieldId)
      }
    }
    for (const id of expired) {
      this.particles.delete(id)
    }
    return expired
  }

  /** Get active particle count */
  getParticleCount(): number {
    return this.particles.size
  }

  /** Render trail dots into the effect layer */
  renderTrailsAndLinks(): void {
    for (const field of this.fields.values()) {
      const hue = this.rgbToHue(field.color)
      const brightness = Math.max(field.color[0], field.color[1], field.color[2])
      this.stampEffectCircle(field.transform.x, field.transform.y, 2, 1, hue, brightness, 0.5)
    }
  }

  /** Convert RGBA color to hue (0-1) for effect layer */
  private rgbToHue(color: [number, number, number, number]): number {
    const [r, g, b] = color
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    if (max === min) return 0
    const d = max - min
    let h = 0
    if (max === r) h = ((g - b) / d + 6) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    return h / 6
  }

  /** Stamp an effect line between two points */
  stampEffectLine(x0: number, y0: number, x1: number, y1: number, width: number, effectType: number, hue: number, brightness: number, intensity: number): void {
    const dx = x1 - x0, dy = y1 - y0
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 1) return
    const steps = Math.ceil(len)
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const cx = x0 + dx * t
      const cy = y0 + dy * t
      // Stamp a small circle at each step for width
      for (let wy = -Math.floor(width / 2); wy <= Math.floor(width / 2); wy++) {
        for (let wx = -Math.floor(width / 2); wx <= Math.floor(width / 2); wx++) {
          if (wx * wx + wy * wy <= (width / 2) * (width / 2)) {
            this.stampEffectPixel(cx + wx, cy + wy, effectType, hue, brightness, intensity)
          }
        }
      }
    }
  }

  // ─── Effect Layer ───

  /** Write a single effect pixel — the atomic operation.
   *  Shapes are defined by which pixels you write to. */
  stampEffectPixel(x: number, y: number, effectType: number, hue: number, brightness: number, intensity: number): void {
    const gx = Math.round(x), gy = Math.round(y)
    if (gx < 0 || gx >= this.gridSize || gy < 0 || gy >= this.gridSize) return
    const idx = (gy * this.gridSize + gx) * 4
    const data = this.world.effectData
    data[idx] = effectType
    data[idx + 1] = hue
    data[idx + 2] = brightness
    data[idx + 3] = Math.max(data[idx + 3], intensity)
  }

  /** Stamp an effect using a pixel offset array — arbitrary shapes.
   *  offsets: array of [dx, dy] pairs relative to (x,y) center */
  stampEffectShape(x: number, y: number, offsets: [number, number][], effectType: number, hue: number, brightness: number, intensity: number): void {
    for (const [dx, dy] of offsets) {
      this.stampEffectPixel(x + dx, y + dy, effectType, hue, brightness, intensity)
    }
  }

  /** Convenience: stamp a circular effect (for simple cases) */
  stampEffectCircle(x: number, y: number, radius: number, effectType: number, hue: number, brightness: number, intensity: number): void {
    const gx = Math.round(x), gy = Math.round(y)
    const r = Math.max(1, Math.round(radius))
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue
        this.stampEffectPixel(gx + dx, gy + dy, effectType, hue, brightness, intensity)
      }
    }
  }

  /** Clear effects in a radius */
  clearEffects(x: number, y: number, radius: number): void {
    const gx = Math.round(x), gy = Math.round(y)
    const r = Math.round(radius)
    const data = this.world.effectData
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue
        const px = gx + dx, py = gy + dy
        if (px < 0 || px >= this.gridSize || py < 0 || py >= this.gridSize) continue
        const idx = (py * this.gridSize + px) * 4
        data[idx] = 0
        data[idx + 1] = 0
        data[idx + 2] = 0
        data[idx + 3] = 0
      }
    }
  }

  /** Fade all effects — called each tick */
  private fadeEffects(dt: number): void {
    const data = this.world.effectData
    const fadeRate = dt * 2.0
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) {
        data[i] -= fadeRate
        if (data[i] <= 0) {
          data[i] = 0
          data[i - 3] = 0
          data[i - 2] = 0
          data[i - 1] = 0
        }
      }
    }
  }

  /** Spawn a lightweight projectile */
  spawnProjectile(x: number, y: number, vx: number, vy: number, effectType: number, hue: number, size: number, intensity: number, lifetime: number): void {
    if (this.projectiles.length >= FieldSimulation.MAX_PROJECTILES) return
    this.projectiles.push({ x, y, vx, vy, effectType, color: hue, size, intensity, age: 0, lifetime })
  }

  /** Update projectiles — move, stamp, expire */
  private stepProjectiles(dt: number): void {
    const alive: Projectile[] = []
    for (const p of this.projectiles) {
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.age += dt
      if (p.age >= p.lifetime) continue
      if (p.x < 0 || p.x >= this.gridSize || p.y < 0 || p.y >= this.gridSize) continue
      const fade = 1.0 - (p.age / p.lifetime)
      this.stampEffectCircle(p.x, p.y, p.size, p.effectType, p.color, 1.0, p.intensity * fade)
      alive.push(p)
    }
    this.projectiles = alive
  }

  // ─── Interaction Effects ───

  /** Add an interaction effect. Returns the effect's id. */
  addInteractionEffect(effect: Omit<InteractionEffect, 'id'> & { id?: string }): string {
    const id = effect.id || `ix_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.interactionEffects.push({ ...effect, id } as InteractionEffect)
    // Sort by order
    this.interactionEffects.sort((a, b) => a.order - b.order)
    return id
  }

  /** Remove an interaction effect by id */
  removeInteractionEffect(effectId: string): boolean {
    const before = this.interactionEffects.length
    this.interactionEffects = this.interactionEffects.filter(e => e.id !== effectId)
    return this.interactionEffects.length < before
  }

  /** Compute the overlap mask (intersection of two fields' bounds), optionally dilated by spread pixels. */
  computeOverlapMask(fieldAId: string, fieldBId: string, spread: number = 0): Uint8Array | null {
    const boundsA = this.getFieldBounds(fieldAId)
    const boundsB = this.getFieldBounds(fieldBId)
    if (!boundsA || !boundsB) return null

    const overlapMinX = Math.max(boundsA.minX, boundsB.minX)
    const overlapMinY = Math.max(boundsA.minY, boundsB.minY)
    const overlapMaxX = Math.min(boundsA.maxX, boundsB.maxX)
    const overlapMaxY = Math.min(boundsA.maxY, boundsB.maxY)

    if (overlapMinX >= overlapMaxX || overlapMinY >= overlapMaxY) return null

    const overlap = new Uint8Array(this.gridSize * this.gridSize)
    const minX = Math.max(0, Math.floor(overlapMinX))
    const minY = Math.max(0, Math.floor(overlapMinY))
    const maxX = Math.min(this.gridSize - 1, Math.ceil(overlapMaxX))
    const maxY = Math.min(this.gridSize - 1, Math.ceil(overlapMaxY))

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        overlap[y * this.gridSize + x] = 255
      }
    }

    if (spread > 0) {
      return this.dilateMask(overlap, spread)
    }

    return overlap
  }

  /** Dilate a binary mask by radius pixels (box dilation) */
  private dilateMask(mask: Uint8Array, radius: number): Uint8Array {
    const gs = this.gridSize
    const dilated = new Uint8Array(gs * gs)
    const r = Math.min(radius, 50) // cap to prevent huge loops

    for (let y = 0; y < gs; y++) {
      for (let x = 0; x < gs; x++) {
        if (mask[y * gs + x] > 0) {
          // Stamp a filled circle of radius r
          const minDy = Math.max(-r, -y)
          const maxDy = Math.min(r, gs - 1 - y)
          for (let dy = minDy; dy <= maxDy; dy++) {
            const minDx = Math.max(-r, -x)
            const maxDx = Math.min(r, gs - 1 - x)
            for (let dx = minDx; dx <= maxDx; dx++) {
              if (dx * dx + dy * dy <= r * r) {
                dilated[(y + dy) * gs + (x + dx)] = 255
              }
            }
          }
        }
      }
    }

    return dilated
  }

  /** Get all active interaction pairs — resolves wildcards, checks for actual overlap.
   *  Returns list of { effect, fieldA, fieldB } for each matching pair with overlap. */
  getActiveInteractionPairs(): Array<{ effect: InteractionEffect; fieldA: Field; fieldB: Field }> {
    const result: Array<{ effect: InteractionEffect; fieldA: Field; fieldB: Field }> = []

    // Rebuild spatial hash with max spread inflation for correct broad-phase
    const hasWildcards = this.interactionEffects.some(e => !e.fieldA || !e.fieldB)
    if (hasWildcards) {
      const maxSpread = this.interactionEffects.reduce((max, e) => Math.max(max, e.spread || 0), 0)
      this.rebuildSpatialHash(maxSpread)
    }

    let hashPairs: Array<[Field, Field]> | null = null

    for (const effect of this.interactionEffects) {
      const spread = effect.spread || 0

      if (effect.fieldA && effect.fieldB) {
        // Specific pair — O(1) direct check
        const a = this.fields.get(effect.fieldA)
        const b = this.fields.get(effect.fieldB)
        if (a && b) {
          const boundsA = this.boundsCache.get(a.id) || this.getFieldBounds(a.id)
          const boundsB = this.boundsCache.get(b.id) || this.getFieldBounds(b.id)
          if (boundsA && boundsB) {
            const overlapX = Math.min(boundsA.maxX, boundsB.maxX) - Math.max(boundsA.minX, boundsB.minX) + 2 * spread
            const overlapY = Math.min(boundsA.maxY, boundsB.maxY) - Math.max(boundsA.minY, boundsB.minY) + 2 * spread
            if (overlapX > 0 && overlapY > 0) {
              result.push({ effect, fieldA: a, fieldB: b })
            }
          }
        }
      } else {
        // Wildcard — use spatial hash broad-phase
        if (!hashPairs) hashPairs = this.spatialHash.getPotentialPairs()
        for (const [a, b] of hashPairs) {
          const matchA = !effect.fieldA || effect.fieldA === a.id || effect.fieldA === b.id
          const matchB = !effect.fieldB || effect.fieldB === a.id || effect.fieldB === b.id
          if (!matchA || !matchB) continue

          const boundsA = this.boundsCache.get(a.id) || this.getFieldBounds(a.id)
          const boundsB = this.boundsCache.get(b.id) || this.getFieldBounds(b.id)
          if (boundsA && boundsB) {
            const overlapX = Math.min(boundsA.maxX, boundsB.maxX) - Math.max(boundsA.minX, boundsB.minX) + 2 * spread
            const overlapY = Math.min(boundsA.maxY, boundsB.maxY) - Math.max(boundsA.minY, boundsB.minY) + 2 * spread
            if (overlapX > 0 && overlapY > 0) {
              result.push({ effect, fieldA: a, fieldB: b })
            }
          }
        }
      }
    }

    return result
  }

  // ─── Tags / Groups ───

  /** Add tags to a field */
  addTag(fieldId: string, tags: string[]): void {
    const field = this.fields.get(fieldId)
    if (!field) return
    if (!field.tags) field.tags = []
    for (const tag of tags) {
      if (!field.tags.includes(tag)) {
        field.tags.push(tag)
        if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, new Set())
        this.tagIndex.get(tag)!.add(fieldId)
      }
    }
  }

  /** Remove tags from a field */
  removeTag(fieldId: string, tags: string[]): void {
    const field = this.fields.get(fieldId)
    if (!field?.tags) return
    for (const tag of tags) {
      const idx = field.tags.indexOf(tag)
      if (idx !== -1) {
        field.tags.splice(idx, 1)
        this.tagIndex.get(tag)?.delete(fieldId)
        if (this.tagIndex.get(tag)?.size === 0) this.tagIndex.delete(tag)
      }
    }
  }

  /** Get all fields with a given tag */
  getFieldsByTag(tag: string): Field[] {
    const ids = this.tagIndex.get(tag)
    if (!ids) return []
    const result: Field[] = []
    for (const id of ids) {
      const field = this.fields.get(id)
      if (field) result.push(field)
    }
    return result
  }

  /** Check if a field has a tag */
  hasTag(fieldId: string, tag: string): boolean {
    return this.tagIndex.get(tag)?.has(fieldId) ?? false
  }

  // ─── Tweens ───

  private static easingFns: Record<string, (t: number) => number> = {
    linear: (t) => t,
    easeIn: (t) => t * t,
    easeOut: (t) => t * (2 - t),
    easeInOut: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  }

  /** Add a tween animation */
  addTween(id: string, fieldId: string, property: string, to: number, duration: number, easing: TweenDef['easing'] = 'linear', onComplete?: string): void {
    const field = this.fields.get(fieldId)
    if (!field) return
    // Read current value as `from`
    let from = 0
    switch (property) {
      case 'x': from = field.transform.x; break
      case 'y': from = field.transform.y; break
      case 'scale': from = field.transform.scale; break
      case 'rotation': from = field.transform.rotation; break
      case 'vx': from = field.transform.vx; break
      case 'vy': from = field.transform.vy; break
      case 'r': from = field.color[0]; break
      case 'g': from = field.color[1]; break
      case 'b': from = field.color[2]; break
      case 'a': from = field.color[3]; break
      default: from = (field.properties.get(property) as number) ?? 0
    }
    this.tweens.set(id, { id, fieldId, property, from, to, duration, elapsed: 0, easing, onComplete })
  }

  /** Cancel a tween */
  cancelTween(id: string): boolean {
    return this.tweens.delete(id)
  }

  /** Step all active tweens */
  stepTweens(dt: number): void {
    if (this.tweens.size === 0) return
    const completed: string[] = []
    for (const [id, tween] of this.tweens) {
      tween.elapsed += dt
      const field = this.fields.get(tween.fieldId)
      if (!field) { completed.push(id); continue }

      const t = Math.min(tween.elapsed / tween.duration, 1)
      const easeFn = FieldSimulation.easingFns[tween.easing] || FieldSimulation.easingFns.linear
      const value = tween.from + (tween.to - tween.from) * easeFn(t)

      switch (tween.property) {
        case 'x': field.transform.x = value; break
        case 'y': field.transform.y = value; break
        case 'scale': field.transform.scale = value; break
        case 'rotation': field.transform.rotation = value; break
        case 'vx': field.transform.vx = value; break
        case 'vy': field.transform.vy = value; break
        case 'r': field.color[0] = value; break
        case 'g': field.color[1] = value; break
        case 'b': field.color[2] = value; break
        case 'a': field.color[3] = value; break
        default: field.properties.set(tween.property, value)
      }

      if (t >= 1) completed.push(id)
    }
    for (const id of completed) {
      const tween = this.tweens.get(id)
      this.tweens.delete(id)
      if (tween?.onComplete) {
        const hook = this.stepHooks.get(tween.onComplete)
        if (hook) {
          try { hook.fn(this, 0) } catch (e) { console.warn(`Tween onComplete hook ${tween.onComplete} failed:`, e) }
        }
      }
    }
  }

  // ─── Timers ───

  /** Add a timer that fires a step hook after a delay */
  addTimer(id: string, hookId: string, delay: number, repeat: boolean = false): void {
    this.timers.set(id, { id, hookId, delay, elapsed: 0, repeat })
  }

  /** Remove a timer */
  removeTimer(id: string): boolean {
    return this.timers.delete(id)
  }

  /** Step all timers */
  stepTimers(dt: number): void {
    if (this.timers.size === 0) return
    const toRemove: string[] = []
    for (const [id, timer] of this.timers) {
      timer.elapsed += dt
      if (timer.elapsed >= timer.delay) {
        const hook = this.stepHooks.get(timer.hookId)
        if (hook) {
          try { hook.fn(this, dt) } catch (e) { console.warn(`Timer ${id} hook ${timer.hookId} failed:`, e) }
        }
        if (timer.repeat) {
          timer.elapsed -= timer.delay
        } else {
          toRemove.push(id)
        }
      }
    }
    for (const id of toRemove) this.timers.delete(id)
  }

  // ─── Seeded RNG ───

  /** Deterministic random [0,1) when worldData.__seed is a number (mulberry32),
   *  else Math.random(). Same seed → same sequence → reproducible runs.
   *  Arrow property: hooks grab it detached (`const rnd = sim.rand`) — a plain
   *  method would lose `this` and throw inside the hook's own try/catch,
   *  killing the world silently. */
  rand = (): number => {
    if (this._randSeed === null) return Math.random()
    this._randState = (this._randState + 0x6D2B79F5) | 0
    let t = Math.imul(this._randState ^ (this._randState >>> 15), 1 | this._randState)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Surface a hook failure where players AND agents can see it: worldData
   *  (synced, bridge-visible as last_hook_error) + the cc:fault overlay.
   *  Once per distinct message — a 60fps failure must not spam either surface. */
  reportHookError(hookId: string, e: unknown): void {
    const msg = String((e as Error)?.message || e)
    const prev = this.worldData['last_hook_error'] as { error?: string } | undefined
    if (prev?.error === msg) return
    this.worldData['last_hook_error'] = { hookId, error: msg, at: Date.now() }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cc:fault', {
        detail: { kind: 'hook-error', message: `step hook '${hookId}' failed: ${msg}` },
      }))
    }
  }

  // ─── Events ───

  /** Fire an event — writes to worldData for step hooks to consume */
  fireEvent(name: string, data?: Record<string, unknown>): void {
    const events = (this.worldData['__events'] as Array<{ name: string; data?: Record<string, unknown>; time: number }>) || []
    events.push({ name, data, time: Date.now() })
    // Keep last 50 events
    if (events.length > 50) events.splice(0, events.length - 50)
    this.worldData['__events'] = events
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Triggers + Chapters — reusable stage/goal primitives.
  //  Before this, a story world was one giant hand-rolled step hook where every
  //  win-condition was `if (x && !flag) { flag = true; … }` re-checked by hand
  //  each frame — the pattern behind flaky "the goal is met but nothing fires"
  //  bugs. These give hooks a real trigger system and chapter state manager.
  //  All state lives in worldData (serializes + persists); pull-based, so there
  //  is no per-frame engine coupling. Stable API for step hooks and AI agents.
  // ═══════════════════════════════════════════════════════════════════════

  /** Fires TRUE exactly once — the first frame `cond` is truthy — latched by id.
   *  The reliable replacement for `if (x && !flag){flag=true;…}`.
   *  e.g. `if (sim.trigger('tree', allSixLit)) growTheTree()`. */
  trigger(id: string, cond: unknown): boolean {
    if (!this.worldData.__trig) this.worldData.__trig = {}
    const L = this.worldData.__trig as Record<string, boolean>
    if (cond) { if (!L[id]) { L[id] = true; return true } }
    return false
  }

  /** Fires TRUE on every false→true edge of `cond` (re-arms when it goes false).
   *  Use for repeatable events; `trigger` is the one-shot. */
  edge(id: string, cond: unknown): boolean {
    if (!this.worldData.__edge) this.worldData.__edge = {}
    const L = this.worldData.__edge as Record<string, boolean>
    const was = !!L[id]; const now = !!cond; L[id] = now
    return now && !was
  }

  /** Re-arm a one-shot `trigger` so it may fire again. */
  resetTrigger(id: string): void {
    const L = this.worldData.__trig as Record<string, boolean> | undefined
    if (L) delete L[id]
  }

  private _ch(): { names: string[]; unlocked: number[]; cur: number } {
    let c = this.worldData.__chapters as { names: string[]; unlocked: number[]; cur: number } | undefined
    if (!c) { c = { names: [''], unlocked: [1], cur: 1 }; this.worldData.__chapters = c }
    return c
  }

  /** Declare the world's chapters (1-indexed in use). Idempotent: names refresh
   *  on every call, but progress (current + unlocked) is preserved. */
  defineChapters(names: string[]): void {
    const c = this._ch()
    c.names = ['', ...names]
    if (!Array.isArray(c.unlocked) || !c.unlocked.length) c.unlocked = [1]
    if (!c.cur) c.cur = 1
  }

  /** The current chapter number (1-based). `if (sim.act === 2) { … }` */
  get act(): number { return this._ch().cur }
  chapterName(n?: number): string { const c = this._ch(); return c.names[n ?? c.cur] || '' }
  chapterCount(): number { return this._ch().names.length - 1 }
  chapterUnlocked(n: number): boolean { return this._ch().unlocked.includes(n) }
  unlockChapter(n: number): void {
    const c = this._ch()
    if (n >= 1 && n <= this.chapterCount() && !c.unlocked.includes(n)) c.unlocked.push(n)
  }

  /** Navigate to chapter n if it is unlocked. Returns whether it moved. */
  goChapter(n: number): boolean {
    const c = this._ch()
    if (c.unlocked.includes(n)) { c.cur = n; return true }
    return false
  }

  /** Finish the current chapter: unlock the next and step into it. Call from a
   *  trigger when the chapter's goal is met — `if (sim.trigger('won', all)) sim.completeChapter()`. */
  completeChapter(): boolean {
    const c = this._ch(); const nx = c.cur + 1
    if (nx <= this.chapterCount()) { this.unlockChapter(nx); c.cur = nx; return true }
    return false
  }

  // ─── Collision Callbacks ───

  /** Register a collision callback */
  addCollisionCallback(cb: CollisionCallback): void {
    this.collisionCallbacks.set(cb.id, cb)
  }

  /** Remove a collision callback */
  removeCollisionCallback(id: string): boolean {
    return this.collisionCallbacks.delete(id)
  }

  /** Check collision callbacks against current collision state */
  private stepCollisionCallbacks(): void {
    if (this.collisionCallbacks.size === 0) return

    const fieldList = Array.from(this.fields.values())

    for (const [, cb] of this.collisionCallbacks) {
      for (let i = 0; i < fieldList.length; i++) {
        for (let j = i + 1; j < fieldList.length; j++) {
          const a = fieldList[i]
          const b = fieldList[j]

          const aMatchesA = this.matchesCollisionFilter(a, cb.matchA)
          const bMatchesB = this.matchesCollisionFilter(b, cb.matchB)
          const aMatchesB = this.matchesCollisionFilter(a, cb.matchB)
          const bMatchesA = this.matchesCollisionFilter(b, cb.matchA)

          if (!(aMatchesA && bMatchesB) && !(aMatchesB && bMatchesA)) continue

          const isColliding = this.collisionState.get(a.id)?.has(b.id) ?? false
          const wasColliding = (this.worldData[`__cb_${cb.id}_${a.id}_${b.id}`] as boolean) ?? false

          if (isColliding && !wasColliding && cb.onEnter) {
            this.worldData['__collision'] = { a: a.id, b: b.id, type: 'enter', callbackId: cb.id }
            const hook = this.stepHooks.get(cb.onEnter)
            if (hook) try { hook.fn(this, 0) } catch (e) { console.warn(`Collision callback ${cb.id} onEnter failed:`, e) }
          } else if (isColliding && wasColliding && cb.onStay) {
            this.worldData['__collision'] = { a: a.id, b: b.id, type: 'stay', callbackId: cb.id }
            const hook = this.stepHooks.get(cb.onStay)
            if (hook) try { hook.fn(this, 0) } catch (e) { console.warn(`Collision callback ${cb.id} onStay failed:`, e) }
          } else if (!isColliding && wasColliding && cb.onExit) {
            this.worldData['__collision'] = { a: a.id, b: b.id, type: 'exit', callbackId: cb.id }
            const hook = this.stepHooks.get(cb.onExit)
            if (hook) try { hook.fn(this, 0) } catch (e) { console.warn(`Collision callback ${cb.id} onExit failed:`, e) }
          }

          this.worldData[`__cb_${cb.id}_${a.id}_${b.id}`] = isColliding
        }
      }
    }
  }

  /** Check if a field matches a collision filter */
  private matchesCollisionFilter(field: Field, filter: { fieldId?: string; tag?: string }): boolean {
    if (filter.fieldId && filter.fieldId === field.id) return true
    if (filter.tag && field.tags?.includes(filter.tag)) return true
    if (!filter.fieldId && !filter.tag) return true // empty filter matches all
    return false
  }

  // ─── Game State Machine ───

  /** Define a game state */
  defineGameState(name: string, def: GameStateDef): void {
    this.gameStates.set(name, def)
  }

  /** Transition to a new game state */
  setGameState(newState: string): void {
    const oldDef = this.gameState ? this.gameStates.get(this.gameState) : null
    const newDef = this.gameStates.get(newState)

    // Run exit hook of old state
    if (oldDef?.onExit) {
      const hook = this.stepHooks.get(oldDef.onExit)
      if (hook) try { hook.fn(this, 0) } catch (e) { console.warn(`Game state exit hook failed:`, e) }
    }

    this.gameState = newState
    this.worldData['gameState'] = newState

    // Run enter hook of new state
    if (newDef?.onEnter) {
      const hook = this.stepHooks.get(newDef.onEnter)
      if (hook) try { hook.fn(this, 0) } catch (e) { console.warn(`Game state enter hook failed:`, e) }
    }
  }

}
