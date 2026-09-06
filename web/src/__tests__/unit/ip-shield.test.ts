import { describe, expect, it, vi, beforeEach } from 'vitest'

// THE LIFETIME SHIELD (Galen, Sep 5: "no. it doesnt fall to open source") —
// the revenue promise, unit-tested: protection reads EVER-HELD; perks read
// ACTIVE; the $100 contains the $10 (the swap can never cost the seat).
// The entitlement slot is the only mock; every predicate under test is real.

const slots = new Map<string, unknown>()
vi.mock('@/app/api/engine/store', () => ({
  loadGameSlot: async (k: string) => slots.get(k),
  saveGameSlot: async (k: string, v: unknown) => { slots.set(k, v) },
  saveGameSlotStrict: async (k: string, v: unknown) => { slots.set(k, v) },
}))
vi.mock('@/lib/adminAuth', () => ({ isAdminUserId: async (id: string) => id === 'keeper' }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { hasIpControl, hasIpShield, hasEditingMembership, grantEntitlement, revokeEntitlement } from '@/lib/stripe'
import { effectiveBuild } from '@/lib/world-policy'

const U = 'user-1'
beforeEach(() => slots.clear())

describe('the lifetime IP shield', () => {
  it('no entitlements → no control, no shield, no seat', async () => {
    expect(await hasIpControl(U)).toBe(false)
    expect(await hasIpShield(U)).toBe(false)
    expect(await hasEditingMembership(U)).toBe(false)
  })

  it('active ip → control + shield + the editing seat (the $100 contains the $10)', async () => {
    await grantEntitlement(U, { product: 'ip', sessionId: 'cs_1' })
    expect(await hasIpControl(U)).toBe(true)
    expect(await hasIpShield(U)).toBe(true)
    expect(await hasEditingMembership(U)).toBe(true)
  })

  it('REVOKED ip → perks lapse, the shield holds for life', async () => {
    await grantEntitlement(U, { product: 'ip', sessionId: 'cs_1' })
    await revokeEntitlement(U, 'ip')
    expect(await hasIpControl(U)).toBe(false)       // storefront closes
    expect(await hasEditingMembership(U)).toBe(false)
    expect(await hasIpShield(U)).toBe(true)         // the work NEVER opens
  })

  it('revocation survives later unrelated grants (the row is durable)', async () => {
    await grantEntitlement(U, { product: 'ip', sessionId: 'cs_1' })
    await revokeEntitlement(U, 'ip')
    await grantEntitlement(U, { product: 'editor', sessionId: 'cs_2' })
    expect(await hasIpShield(U)).toBe(true)
    expect(await hasEditingMembership(U)).toBe(true)   // via the editor seat
    expect(await hasIpControl(U)).toBe(false)
  })

  it('a TIMED editor grant expires; ip never carries a clock', async () => {
    await grantEntitlement(U, { product: 'editor', sessionId: 'first-pair-month', until: Date.now() - 1000 })
    expect(await hasEditingMembership(U)).toBe(false)  // month over
    await grantEntitlement(U, { product: 'ip', sessionId: 'cs_1' })
    expect(await hasEditingMembership(U)).toBe(true)
  })

  it('the sandbox law: normal worlds FORCED open; shielded/premium worlds run their DECLARED policy', () => {
    // normal world: open-buildable no matter what policy says — the one deal
    expect(effectiveBuild({}, false)).toBe('anyone')
    expect(effectiveBuild({ policy: { build: 'owner', play: 'everyone' } }, false)).toBe('anyone')
    // shielded owner, no declared policy → the DEFAULT policy: owner builds
    expect(effectiveBuild({}, true)).toBe('owner')
    // premium contract, undeclared → owner builds
    expect(effectiveBuild({ premium: { usd: 5 } }, false)).toBe('owner')
    // but a shielded owner may still CHOOSE openness — OG creator governs
    expect(effectiveBuild({ policy: { build: 'anyone', play: 'everyone' } }, true)).toBe('anyone')
  })

  it('the keeper always holds the seat, never needs the products', async () => {
    expect(await hasEditingMembership('keeper')).toBe(true)
  })
})
