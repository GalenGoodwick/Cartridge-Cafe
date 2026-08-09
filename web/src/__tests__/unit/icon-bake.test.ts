import { describe, it, expect } from 'vitest'
import {
  iconSnapshotHash, iconHealth, needsBake, bakeIconRecord,
  ICON_TICKS, ICON_SIZE, ICON_INPUT, iconSlotKey,
  type IconRecord,
} from '@/lib/icon-bake'

const baseSnap = () => ({
  fields: [{ visualTypeName: 'water', color: [0.1, 0.4, 0.9], w: 512, h: 512, transform: { x: 256, y: 256 } }],
  visualTypes: [{ name: 'water', wgsl: 'fn visual_water(){ return 1.0; }' }],
  modules: [{ name: 'mod_a', wgsl: 'fn a(){}' }],
  stepHooks: [{ code: 'sim.worldData.t += dt' }],
  worldData: { icon_wgsl: null, some_player_state: 42 },
})

describe('iconSnapshotHash — look signature', () => {
  it('is stable across identical snapshots', () => {
    expect(iconSnapshotHash(baseSnap())).toBe(iconSnapshotHash(baseSnap()))
  })

  it('ignores volatile non-icon worldData (a play/save must not invalidate the icon)', () => {
    const a = baseSnap()
    const b = baseSnap()
    b.worldData.some_player_state = 999
    ;(b.worldData as Record<string, unknown>).__vf = { hp: 3, x: 12 }
    expect(iconSnapshotHash(a)).toBe(iconSnapshotHash(b))
  })

  it('changes when a shader changes', () => {
    const a = baseSnap()
    const b = baseSnap()
    b.visualTypes[0].wgsl = 'fn visual_water(){ return 2.0; }'
    expect(iconSnapshotHash(a)).not.toBe(iconSnapshotHash(b))
  })

  it('changes when a step-hook changes', () => {
    const a = baseSnap()
    const b = baseSnap()
    b.stepHooks[0].code = 'sim.worldData.t -= dt'
    expect(iconSnapshotHash(a)).not.toBe(iconSnapshotHash(b))
  })

  it('changes when geometry (field transform) changes', () => {
    const a = baseSnap()
    const b = baseSnap()
    b.fields[0].transform.x = 100
    expect(iconSnapshotHash(a)).not.toBe(iconSnapshotHash(b))
  })

  it('changes when a bespoke MAKE-ICON shader is set', () => {
    const a = baseSnap()
    const b = baseSnap()
    ;(b.worldData as Record<string, unknown>).icon_wgsl = 'fn visual_icon(){ return 1.0; }'
    expect(iconSnapshotHash(a)).not.toBe(iconSnapshotHash(b))
  })

  it('does not throw on empty / null input', () => {
    expect(typeof iconSnapshotHash(null)).toBe('string')
    expect(typeof iconSnapshotHash({})).toBe('string')
  })
})

describe('iconHealth — self-heal discriminator', () => {
  const H = 'abc123'
  it('missing when no record', () => {
    expect(iconHealth(null, H)).toBe('missing')
    expect(iconHealth(undefined, H)).toBe('missing')
  })
  it('ok when a real png matches the current content', () => {
    const r: IconRecord = { hash: H, at: 1, png_b64: 'iVBOR...' }
    expect(iconHealth(r, H)).toBe('ok')
  })
  it('stale when content moved on', () => {
    const r: IconRecord = { hash: 'old', at: 1, png_b64: 'iVBOR...' }
    expect(iconHealth(r, H)).toBe('stale')
  })
  it('black when the eye ran on THIS content and it rendered nothing', () => {
    const r: IconRecord = { hash: H, at: 1, failed: true, reason: 'invisible' }
    expect(iconHealth(r, H)).toBe('black')
  })
  it('stale beats black when a black-verdict record is now out of date', () => {
    const r: IconRecord = { hash: 'old', at: 1, failed: true }
    expect(iconHealth(r, H)).toBe('stale')
  })
  it('missing when a record has neither image nor failure verdict', () => {
    const r: IconRecord = { hash: H, at: 1 }
    expect(iconHealth(r, H)).toBe('missing')
  })
})

describe('needsBake — only missing/stale enqueue', () => {
  it('missing and stale enqueue; ok and black do not', () => {
    expect(needsBake('missing')).toBe(true)
    expect(needsBake('stale')).toBe(true)
    expect(needsBake('ok')).toBe(false)
    expect(needsBake('black')).toBe(false)   // settled: never re-bake a genuinely-black world until it changes
  })
})

describe('bakeIconRecord — eye result → record', () => {
  const snap = baseSnap()

  it('drives the eye with the icon presets', async () => {
    let seen: Record<string, unknown> | null = null
    await bakeIconRecord(snap, 'h', async (_s, opts) => { seen = opts as Record<string, unknown>; return { ok: true, visible: true, image: 'PNG', coveragePct: 40 } }, 1000)
    expect(seen!).toMatchObject({ ticks: ICON_TICKS, size: ICON_SIZE, input: ICON_INPUT })
  })

  it('stores a real png when the world is visible', async () => {
    const res = await bakeIconRecord(snap, 'h', async () => ({ ok: true, visible: true, image: 'PNGDATA', coveragePct: 33, maxLum: 0.8, dominantColors: [1, 2, 3, 4, 5] }), 1000)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.record).toMatchObject({ hash: 'h', at: 1000, png_b64: 'PNGDATA' })
      expect(res.record.failed).toBeUndefined()
      expect(res.record.struct?.dominantColors).toHaveLength(4)   // clipped to 4
    }
  })

  it('records a FAILURE (not transient) when the render is black', async () => {
    const res = await bakeIconRecord(snap, 'h', async () => ({ ok: true, visible: false, image: 'PNG', coveragePct: 0.1 }), 1000)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.record).toMatchObject({ hash: 'h', failed: true, reason: 'invisible' })
  })

  it('records a FAILURE when visible but no image came back', async () => {
    const res = await bakeIconRecord(snap, 'h', async () => ({ ok: true, visible: true, coveragePct: 40 }), 1000)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.record).toMatchObject({ failed: true, reason: 'no-image' })
  })

  it('is TRANSIENT (not persisted) when the eye is down/unreachable', async () => {
    const res = await bakeIconRecord(snap, 'h', async () => ({ ok: false, error: 'render service unreachable' }), 1000)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.transient).toBe(true)
  })
})

describe('iconSlotKey', () => {
  it('namespaces per slug', () => {
    expect(iconSlotKey('my-world')).toBe('world_icon:my-world')
  })
})
