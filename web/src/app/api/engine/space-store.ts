import { prisma } from '@/lib/prisma'
import crypto from 'crypto'
import type { SceneSnapshot, InteractionRule } from '@/app/engine/types'

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

export async function getSpaceSnapshot(spaceId: string): Promise<SceneSnapshot | null> {
  // Check cache first
  const cached = cache.get(spaceId)
  if (cached && Date.now() - cached.lastLoaded < CACHE_TTL) {
    return cached.snapshot
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
  // Update cache immediately
  cache.set(spaceId, { snapshot, lastLoaded: Date.now() })

  // Debounced persist to DB (2s)
  const existing = persistTimers.get(spaceId)
  if (existing) clearTimeout(existing)

  persistTimers.set(spaceId, setTimeout(async () => {
    persistTimers.delete(spaceId)
    try {
      await prisma.playerSpace.update({
        where: { id: spaceId },
        data: {
          snapshot: snapshot as unknown as Parameters<typeof prisma.playerSpace.update>[0]['data']['snapshot'],
          updatedAt: new Date(),
        },
      })
    } catch (err) {
      console.error(`Failed to persist space ${spaceId}:`, err)
    }
  }, 2000))
}

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
export async function applyCommandToSnapshot(
  spaceId: string,
  cmd: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const snap = (await getSpaceSnapshot(spaceId)) ?? emptySnapshot()
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
      const shape = (cmd.shape as string) ?? 'circle'
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
      break
    }

    case 'set_position': {
      const f = snap.fields.find(f => f.id === cmd.fieldId)
      if (f) {
        if (cmd.x != null) f.transform.x = cmd.x as number
        if (cmd.y != null) f.transform.y = cmd.y as number
      }
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

    case 'set_world_params': {
      if (cmd.params) {
        snap.worldParams = { ...snap.worldParams, ...(cmd.params as Record<string, unknown>) } as SceneSnapshot['worldParams']
      }
      break
    }

    case 'set_world_data': {
      if (cmd.data) {
        snap.worldData = { ...snap.worldData, ...(cmd.data as Record<string, unknown>) }
      }
      break
    }

    case 'add_step_hook': {
      snap.stepHooks.push({
        id: (cmd.hookId as string) ?? `hook_${Date.now()}`,
        author: (cmd.author as string) ?? 'claude-code',
        description: (cmd.description as string) ?? '',
        code: cmd.code as string,
      })
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

    default:
      // Unknown command — no server-side processing, just pass through to SSE
      return result
  }

  snap.timestamp = Date.now()
  await setSpaceSnapshot(spaceId, snap)
  return result
}
