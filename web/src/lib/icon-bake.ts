/** THE UNIFIED ICON PIPELINE.
 *
 *  Every world — however it was built (scene cartridge, bridge, node-runtime,
 *  site brew) — gets its shelf icon the SAME way: boot the real world in the eye
 *  (render-service), run its real step-hooks for a moment, photograph a
 *  representative frame, and store that PNG. This replaces the old "compose the
 *  dominant visual as a standalone shader" path, which silently failed for any
 *  world whose look lives in running state (feedback sims, multi-node worlds,
 *  raymarched games) → rendered black in isolation → fell back to the hue emblem
 *  with no way to tell and no way to heal.
 *
 *  This module is the PURE half: the look-signature hash, the health verdict, and
 *  the bake (render-fn injected so it unit-tests offline). The queue/endpoints in
 *  icon-bake-queue.ts and /api/spaces/icons wire it to storage and the shelf. */

import type { RenderSnapshot, RenderOpts } from './render-service'

// how the eye is driven for an icon: a short run to build up state, hands on the
// controls so interactive worlds animate into something worth photographing, and
// a small frame (the atlas cell is 64² — 96 gives a crisp antialiased source).
export const ICON_TICKS = 72
export const ICON_SIZE = 96
export const ICON_INPUT = 'auto'

export type IconStruct = {
  maxLum?: number
  meanLum?: number
  coveragePct?: number
  visible?: boolean
  dominantColors?: unknown
  visual?: string
}

/** What we persist per world in slot `world_icon:<slug>`. Either a real baked PNG
 *  (png_b64 set) or a recorded FAILURE (failed:true) so we don't re-bake a world
 *  that genuinely renders black on every browse — only when its content changes. */
export type IconRecord = {
  hash: string          // look-signature of the snapshot this was baked from
  at: number            // when baked (ms)
  png_b64?: string      // the photographed frame — base64 PNG (the canonical icon)
  struct?: IconStruct   // pixel-stats from the eye (health signal + palette)
  failed?: boolean      // the eye ran but the world rendered black / gave no image
  reason?: string       // why it failed ('invisible' | 'no-image')
}

export type IconHealth = 'ok' | 'missing' | 'black' | 'stale'

type LookSlice = {
  fields?: unknown[]
  visualTypes?: Array<{ name?: string; wgsl?: string } | unknown>
  modules?: Array<{ name?: string; wgsl?: string } | unknown>
  stepHooks?: unknown[]
  worldData?: Record<string, unknown> | null
}

// FNV-1a → base36. Small, stable, dependency-free. Content hash, NOT a security
// hash: it only needs to change when the world's LOOK changes.
function fnv36(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** A stable signature of everything that determines a world's LOOK — its
 *  geometry, shaders, modules, step-hooks, and any bespoke MAKE-ICON shader.
 *  Deliberately EXCLUDES volatile worldData (player positions, saves, __vf state)
 *  so an ordinary play/save does not invalidate the icon; only a real change to
 *  how the world looks does. Same snapshot → same hash, order-preserving (draw
 *  order and hook order matter). */
export function iconSnapshotHash(snap: LookSlice | null | undefined): string {
  const s = snap || {}
  const fieldKey = (f: unknown): string => {
    const o = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>
    const t = o.transform as Record<string, unknown> | undefined
    return [o.visualTypeName, JSON.stringify(o.color ?? null), o.w, o.h, o.radius, t?.x, t?.y].join(',')
  }
  const namedWgsl = (a: unknown): string =>
    (Array.isArray(a) ? a : []).map(m => {
      const o = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>
      return `${o.name ?? ''}=${o.wgsl ?? ''}`
    }).join('')
  const hooks = (Array.isArray(s.stepHooks) ? s.stepHooks : []).map(h => {
    const o = (h && typeof h === 'object' ? h : {}) as Record<string, unknown>
    return String(o.code ?? o.fn ?? o.body ?? JSON.stringify(o))
  }).join('')
  const bespoke = typeof s.worldData?.icon_wgsl === 'string' ? s.worldData.icon_wgsl : ''
  const payload = [
    (Array.isArray(s.fields) ? s.fields : []).map(fieldKey).join(''),
    namedWgsl(s.visualTypes),
    namedWgsl(s.modules),
    hooks,
    bespoke,
  ].join('')
  return fnv36(payload)
}

/** Is the stored icon record still good for a world whose CURRENT look hashes to
 *  `currentHash`?  This is the self-heal discriminator that did not exist before
 *  (icon realness used to be knowable only by attempting the render).
 *   - missing : no record, or a record with no image and no failure verdict
 *   - stale   : baked from different content than the world now has → re-bake
 *   - black   : the eye ran on THIS exact content and it rendered black → leave
 *               the placeholder, do NOT re-bake until the world changes
 *   - ok      : a real baked PNG matching the current content */
export function iconHealth(record: IconRecord | null | undefined, currentHash: string): IconHealth {
  if (!record) return 'missing'
  if (record.hash !== currentHash) return 'stale'
  if (record.failed) return 'black'
  if (!record.png_b64) return 'missing'
  return 'ok'
}

/** Only missing/stale worlds get (re)queued. 'black' is a settled verdict for the
 *  current content; 'ok' needs nothing. */
export function needsBake(health: IconHealth): boolean {
  return health === 'missing' || health === 'stale'
}

type BakeResult =
  | { ok: true; record: IconRecord }
  | { ok: false; transient: true; error?: string }

type RenderFn = (snap: RenderSnapshot, opts: RenderOpts) => Promise<Record<string, unknown>>

/** Photograph a world with the eye and turn the result into an IconRecord. The
 *  render fn is injected so this unit-tests without a live render-service.
 *  A transient failure (eye down/unreachable) returns {ok:false, transient} and
 *  is NOT persisted, so it retries next sweep. A successful render that is black
 *  or image-less is persisted as a FAILURE record so we stop hammering it. */
export async function bakeIconRecord(
  snap: RenderSnapshot,
  hash: string,
  render: RenderFn,
  now: number,
): Promise<BakeResult> {
  const out = await render(snap, { ticks: ICON_TICKS, size: ICON_SIZE, input: ICON_INPUT })
  if (!out || out.ok !== true) {
    return { ok: false, transient: true, error: typeof out?.error === 'string' ? out.error : 'render failed' }
  }
  const struct: IconStruct = {
    maxLum: num(out.maxLum), meanLum: num(out.meanLum), coveragePct: num(out.coveragePct),
    visible: out.visible === true,
    dominantColors: Array.isArray(out.dominantColors) ? (out.dominantColors as unknown[]).slice(0, 4) : undefined,
    visual: typeof out.visual === 'string' ? out.visual : undefined,
  }
  const img = typeof out.image === 'string' ? out.image : (typeof out.png === 'string' ? out.png : '')
  if (struct.visible && img.length > 0) {
    return { ok: true, record: { hash, at: now, png_b64: img, struct } }
  }
  return { ok: true, record: { hash, at: now, failed: true, reason: img ? 'invisible' : 'no-image', struct } }
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** The slot key a world's icon record lives under. */
export function iconSlotKey(slug: string): string {
  return 'world_icon:' + slug
}
