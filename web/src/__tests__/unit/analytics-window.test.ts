import { describe, it, expect } from 'vitest'
import { clampHours, sceneWorldLabel } from '@/lib/analytics-window'

describe('clampHours (admin analytics ?hours=N → safe SQL interval integer)', () => {
  it('defaults to 12 for missing / junk / non-positive input', () => {
    expect(clampHours(null)).toBe(12)
    expect(clampHours(undefined)).toBe(12)
    expect(clampHours('')).toBe(12)
    expect(clampHours('abc')).toBe(12)
    expect(clampHours('0')).toBe(12)
    expect(clampHours('-5')).toBe(12)
  })

  it('passes through a valid window as a floored integer', () => {
    expect(clampHours('12')).toBe(12)
    expect(clampHours('1')).toBe(1)
    expect(clampHours('36.9')).toBe(36)   // floored — never a fractional interval
  })

  it('caps the lookback at 168h (7d)', () => {
    expect(clampHours('168')).toBe(168)
    expect(clampHours('99999')).toBe(168)
  })

  it('never yields a value that would break the SQL interval', () => {
    for (const raw of [null, '', 'DROP TABLE', '1;2', '3.3', '1e9', '-1']) {
      const h = clampHours(raw)
      expect(Number.isInteger(h)).toBe(true)
      expect(h).toBeGreaterThanOrEqual(1)
      expect(h).toBeLessThanOrEqual(168)
    }
  })
})

describe('sceneWorldLabel (presence scene → readable world for playtime report)', () => {
  it('takes the segment after the last colon', () => {
    expect(sceneWorldLabel('main/players/space:tideglass')).toBe('tideglass')
    expect(sceneWorldLabel('main/world:QUANTIC DOJO')).toBe('QUANTIC DOJO')
    expect(sceneWorldLabel('space:veilfire-3d')).toBe('veilfire-3d')
  })
  it('passes through a bare scene name unchanged', () => {
    expect(sceneWorldLabel('CAFE')).toBe('CAFE')
    expect(sceneWorldLabel('SUB-MAIN')).toBe('SUB-MAIN')
  })
  it('never returns empty on odd input', () => {
    expect(sceneWorldLabel('trailing:')).toBe('trailing:')   // empty tail → keep the raw
    expect(sceneWorldLabel('')).toBe('')
  })
})
