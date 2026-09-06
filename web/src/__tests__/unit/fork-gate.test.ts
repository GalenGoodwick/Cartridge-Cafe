import { beforeEach, describe, expect, it, vi } from 'vitest'

const kv = new Map<string, Record<string, unknown>>()
import { makeFakeCreditDb } from './fake-credit-db'
const fakeDb = makeFakeCreditDb()
vi.mock('@/lib/prisma', () => ({ prisma: fakeDb.prisma }))
vi.mock('@/app/api/engine/store', () => ({
  loadGameSlot: async (k: string) => kv.get(k),
  saveGameSlot: async (k: string, v: Record<string, unknown>) => { kv.set(k, v) },
  saveGameSlotStrict: async (k: string, v: Record<string, unknown>) => { kv.set(k, v) },
}))

import { canForkWorld } from '@/lib/world-policy'
import { grantGenCredits, readGenCredits, worldgenPriceUsd, GEN_BUNDLES } from '@/lib/stripe'

describe('canForkWorld — FORK OFF BY DEFAULT (Galen, Aug 30)', () => {
  it('a base forks, even an open-building base', () => {
    expect(canForkWorld({ __base: true }).ok).toBe(true)
    expect(canForkWorld({ __base: true, policy: { build: 'anyone', play: 'everyone' } }).ok).toBe(true)
  })

  it('an UNMARKED world now forks (the default flipped from opt-in to on)', () => {
    expect(canForkWorld({}).ok).toBe(true)
    expect(canForkWorld(undefined).ok).toBe(true)
    expect(canForkWorld({ policy: { build: 'owner', play: 'everyone' } }).ok).toBe(true)
  })

  it('a live-edit world (build: anyone) does NOT fork — even flagged forkable', () => {
    const r = canForkWorld({ forkable: true, policy: { build: 'anyone', play: 'everyone' } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/live-edit/)
  })

  it('a premium world does NOT fork', () => {
    const r = canForkWorld({ premium: { usd: 5 } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/premium/)
  })

  it('a proprietary world (owner holds IP control) does NOT fork', () => {
    const r = canForkWorld({}, true)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/proprietary/)
  })

  it('a maker who opted out (forkable: false) does NOT fork', () => {
    const r = canForkWorld({ forkable: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/turned forking off/)
  })
})

describe('grantGenCredits with quantity (buy more than one)', () => {
  beforeEach(() => { kv.clear(); fakeDb.credits.clear(); fakeDb.grants.clear() })

  it('grants qty credits in one purchase', async () => {
    expect(await grantGenCredits('u1', 'cs_1', 5)).toBe(5)
    expect(await readGenCredits('u1')).toBe(5)
  })

  it('webhook retry with the same session grants nothing extra', async () => {
    await grantGenCredits('u1', 'cs_1', 3)
    expect(await grantGenCredits('u1', 'cs_1', 3)).toBe(3)
    expect(await readGenCredits('u1')).toBe(3)
  })

  it('clamps absurd quantities and floors fractions', async () => {
    expect(await grantGenCredits('u1', 'cs_big', 500)).toBe(20)
    expect(await grantGenCredits('u1', 'cs_frac', 2.9)).toBe(22)
  })

  it('defaults to one credit when qty is absent (legacy sessions)', async () => {
    expect(await grantGenCredits('u1', 'cs_old')).toBe(1)
  })
})

describe('bundle discount pricing (buy more, pay less)', () => {
  it('charges the bundle rate at listed tiers', () => {
    expect(worldgenPriceUsd(1)).toBe(5)
    expect(worldgenPriceUsd(3)).toBe(12)
    expect(worldgenPriceUsd(5)).toBe(18)
    expect(worldgenPriceUsd(10)).toBe(30)
  })

  it('every bundle beats the linear rate, and deeper is cheaper per credit', () => {
    for (const q of Object.keys(GEN_BUNDLES).map(Number)) {
      expect(worldgenPriceUsd(q)).toBeLessThanOrEqual(q * 5)
    }
    expect(worldgenPriceUsd(10) / 10).toBeLessThan(worldgenPriceUsd(5) / 5)
    expect(worldgenPriceUsd(5) / 5).toBeLessThan(worldgenPriceUsd(3) / 3)
  })

  it('unlisted quantities fall back to the linear $5 rate', () => {
    expect(worldgenPriceUsd(2)).toBe(10)
    expect(worldgenPriceUsd(4)).toBe(20)
    expect(worldgenPriceUsd(7)).toBe(35)
  })

  it('clamps to [1,20] and floors fractions', () => {
    expect(worldgenPriceUsd(0)).toBe(5)
    expect(worldgenPriceUsd(-3)).toBe(5)
    expect(worldgenPriceUsd(999)).toBe(100)
    expect(worldgenPriceUsd(3.9)).toBe(12)
  })
})
