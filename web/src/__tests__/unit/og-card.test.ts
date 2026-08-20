import { describe, it, expect } from 'vitest'
import { ogCardState, OG_CARD_MAX_AGE_MS, OG_CARD_SLOT, type OgCardRecord } from '@/lib/og-card'

const NOW = 1_700_000_000_000

const fresh = (over: Partial<OgCardRecord> = {}): OgCardRecord => ({
  at: NOW - 1000,
  png_b64: 'aGVsbG8=',
  ...over,
})

describe('ogCardState — the serve/re-bake/fallback verdict', () => {
  it('a current baked card serves as-is', () => {
    expect(ogCardState(fresh(), NOW)).toBe('ok')
  })

  it('no record at all falls back', () => {
    expect(ogCardState(null, NOW)).toBe('missing')
    expect(ogCardState(undefined, NOW)).toBe('missing')
  })

  it('a record without image bytes is missing, not stale — never serve empty bytes', () => {
    expect(ogCardState(fresh({ png_b64: '' }), NOW)).toBe('missing')
    expect(ogCardState({ at: NOW } as OgCardRecord, NOW)).toBe('missing')
  })

  it('an aged card is stale — still SERVES, only asks for a background re-bake', () => {
    expect(ogCardState(fresh({ at: NOW - OG_CARD_MAX_AGE_MS - 1 }), NOW)).toBe('stale')
  })

  it('exactly at the age boundary still serves as ok', () => {
    expect(ogCardState(fresh({ at: NOW - OG_CARD_MAX_AGE_MS }), NOW)).toBe('ok')
  })

  it('a record with a broken timestamp is stale (re-bake), not trusted forever', () => {
    expect(ogCardState({ at: NaN, png_b64: 'aGVsbG8=' } as OgCardRecord, NOW)).toBe('stale')
    expect(ogCardState({ png_b64: 'aGVsbG8=' } as OgCardRecord, NOW)).toBe('stale')
  })

  it('slot key is the stable storage contract', () => {
    expect(OG_CARD_SLOT).toBe('og_card:site')
  })
})
