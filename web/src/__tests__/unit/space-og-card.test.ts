import { describe, it, expect } from 'vitest'
import { spaceOgState, spaceOgSlotKey, spaceLookHash, type SpaceOgRecord } from '@/lib/og-card'

const HASH = 'abc123'
const rec = (over: Partial<SpaceOgRecord> = {}): SpaceOgRecord => ({ at: 1, hash: HASH, png_b64: 'aGk=', ...over })

describe('spaceOgState — serve / re-bake / template verdict per world', () => {
  it('baked card matching the current look serves as-is', () => {
    expect(spaceOgState(rec(), HASH)).toBe('ok')
  })

  it('no record → template now, bake in background', () => {
    expect(spaceOgState(null, HASH)).toBe('missing')
    expect(spaceOgState(undefined, HASH)).toBe('missing')
  })

  it('the world CHANGED → stale: still serves, asks for a re-bake', () => {
    expect(spaceOgState(rec({ hash: 'other' }), HASH)).toBe('stale')
  })

  it('a failure on THIS content is settled — template forever, no re-hammering the eye', () => {
    expect(spaceOgState(rec({ png_b64: undefined, failed: true }), HASH)).toBe('failed')
  })

  it('a failure from OLD content re-bakes once the world changes', () => {
    expect(spaceOgState(rec({ hash: 'old', png_b64: undefined, failed: true }), HASH)).toBe('stale')
  })

  it('record with neither bytes nor failure = missing', () => {
    expect(spaceOgState(rec({ png_b64: undefined }), HASH)).toBe('missing')
  })

  it('slot key + look-hash are the stable contracts', () => {
    expect(spaceOgSlotKey('tideglass')).toBe('og_card:space:tideglass')
    const snap = { fields: [{ visualTypeName: 'x', w: 1, h: 1 }], visualTypes: [], modules: [], stepHooks: [] }
    expect(spaceLookHash(snap)).toBe(spaceLookHash({ ...snap }))            // deterministic
    expect(spaceLookHash(snap)).not.toBe(spaceLookHash({ ...snap, fields: [] }))  // look-sensitive
  })
})
