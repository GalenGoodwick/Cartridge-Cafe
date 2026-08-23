import { describe, it, expect } from 'vitest'
import { normalizePolicy, policyOf, mayWritePolicy, canBuild, canPlay, DEFAULT_POLICY, POLICY_PRESETS } from '@/lib/world-policy'
import { applyCommandToSnapshotObject } from '@/app/api/engine/space-store'
import type { SceneSnapshot } from '@/app/engine/types'

/** Guards the SOCIAL CONTRACT (DESIGN-multiplayer-worldbuilding §2-3 + Galen's
 *  rulings): set once at fork, IMMUTABLE forever — enforced at the real
 *  command switch; policy decides who builds and who plays. */
describe('normalizePolicy / presets', () => {
  it('accepts valid shapes and preset names', () => {
    expect(normalizePolicy({ build: 'anyone', play: 'everyone' })).toEqual({ build: 'anyone', play: 'everyone' })
    expect(normalizePolicy('open-ground')).toEqual(POLICY_PRESETS['open-ground'])
    expect(normalizePolicy('Private Table')).toEqual({ build: 'invited', play: 'invited' })
  })

  it('rejects malformed candidates', () => {
    expect(normalizePolicy({ build: 'everyone', play: 'everyone' })).toBeNull()   // wrong axis word
    expect(normalizePolicy({ build: 'anyone' })).toBeNull()
    expect(normalizePolicy('free-for-all')).toBeNull()
    expect(normalizePolicy(null)).toBeNull()
  })

  it('policyOf: absent/malformed = the platform default (owner builds, everyone plays)', () => {
    expect(policyOf({})).toEqual(DEFAULT_POLICY)
    expect(policyOf({ policy: 'garbage' })).toEqual(DEFAULT_POLICY)
    expect(policyOf(undefined)).toEqual(DEFAULT_POLICY)
  })
})

describe('the immutability law', () => {
  it('first set lands; every later write is refused — even a valid one', () => {
    const first = mayWritePolicy({}, 'crew-world')
    expect(first.ok).toBe(true)
    const again = mayWritePolicy({ policy: { build: 'invited', play: 'everyone' } }, 'solo')
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error).toMatch(/IMMUTABLE/)
  })

  it('holds at the REAL command switch: set_world_data cannot rewrite a contract', () => {
    const snap = { name: 'w', fields: [], worldParams: {}, worldData: {}, stepHooks: [], interactionRules: [], interactionEffects: [], visualTypes: [], modules: [], timestamp: 0 } as unknown as SceneSnapshot
    const r1 = applyCommandToSnapshotObject(snap, { type: 'set_world_data', data: { policy: 'open-ground' } }) as Record<string, unknown>
    expect((snap.worldData as { policy?: unknown }).policy).toEqual(POLICY_PRESETS['open-ground'])
    expect(r1.warnings).toBeUndefined()
    const r2 = applyCommandToSnapshotObject(snap, { type: 'set_world_data', data: { policy: 'solo', blurb: 'still lands' } }) as Record<string, unknown>
    expect((snap.worldData as { policy?: unknown }).policy).toEqual(POLICY_PRESETS['open-ground'])   // unchanged
    expect((snap.worldData as { blurb?: unknown }).blurb).toBe('still lands')                        // the rest of the write survives
    expect(String(r2.warnings)).toMatch(/IMMUTABLE/)
  })

  it('a malformed first set is refused, leaving the world contract-less (default applies)', () => {
    const snap = { name: 'w', fields: [], worldParams: {}, worldData: {}, stepHooks: [], interactionRules: [], interactionEffects: [], visualTypes: [], modules: [], timestamp: 0 } as unknown as SceneSnapshot
    const r = applyCommandToSnapshotObject(snap, { type: 'set_world_data', data: { policy: { build: 'hackers' } } }) as Record<string, unknown>
    expect((snap.worldData as { policy?: unknown }).policy).toBeUndefined()
    expect(String(r.warnings)).toMatch(/malformed/)
  })
})

describe('who builds, who plays', () => {
  const who = (isOwner: boolean, isMember: boolean) => ({ isOwner, isMember })
  it('build: anyone opens the site; invited needs the roster; owner is always in', () => {
    expect(canBuild(POLICY_PRESETS['open-ground'], who(false, false))).toBe(true)
    expect(canBuild(POLICY_PRESETS['crew-world'], who(false, false))).toBe(false)
    expect(canBuild(POLICY_PRESETS['crew-world'], who(false, true))).toBe(true)
    expect(canBuild(POLICY_PRESETS['solo'], who(false, true))).toBe(false)
    expect(canBuild(POLICY_PRESETS['solo'], who(true, false))).toBe(true)
  })
  it('play: everyone is the open door; invited/builders resolve to the roster', () => {
    expect(canPlay(POLICY_PRESETS['crew-world'], who(false, false))).toBe(true)
    expect(canPlay(POLICY_PRESETS['private-table'], who(false, false))).toBe(false)
    expect(canPlay(POLICY_PRESETS['private-table'], who(false, true))).toBe(true)
  })
})
