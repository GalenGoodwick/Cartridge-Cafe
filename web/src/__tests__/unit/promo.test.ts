import { beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory KV so promo/credit/entitlement logic runs for real with no DB.
const kv = new Map<string, Record<string, unknown>>()
vi.mock('@/app/api/engine/store', () => ({
  loadGameSlot: async (k: string) => kv.get(k),
  saveGameSlot: async (k: string, v: Record<string, unknown>) => { kv.set(k, v) },
  saveGameSlotStrict: async (k: string, v: Record<string, unknown>) => { kv.set(k, v) },
}))
vi.mock('@/lib/adminAuth', () => ({ isAdminUserId: async () => false }))
import { makeFakeCreditDb } from './fake-credit-db'
const fakeDb = makeFakeCreditDb()
vi.mock('@/lib/prisma', () => ({ prisma: fakeDb.prisma }))

import { createPromoCode, listPromoCodes, redeemPromoCode } from '@/lib/promo'
import { hasEditingMembership, membershipUntil, readGenCredits, grantEntitlement, spendGenCredit } from '@/lib/stripe'

const DAY = 86400_000

describe('promo codes', () => {
  beforeEach(() => { kv.clear(); fakeDb.credits.clear(); fakeDb.grants.clear() })

  it('mints the default gift: 2 credits + 30 days, unlimited redeemers', async () => {
    const c = await createPromoCode({ createdBy: 'galen' })
    expect(c.code).toMatch(/^CAFE-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(c.credits).toBe(2)
    expect(c.memberDays).toBe(30)
    expect(c.maxUses).toBeNull()
    expect((await listPromoCodes())[0].code).toBe(c.code)
  })

  it('redeems: credits land permanently, membership runs ~30 days', async () => {
    const c = await createPromoCode({ createdBy: 'galen' })
    const r = await redeemPromoCode('u1', c.code)
    expect(r.ok).toBe(true)
    expect(await readGenCredits('u1')).toBe(2)
    expect(await hasEditingMembership('u1')).toBe(true)
    const until = await membershipUntil('u1')
    expect(until).toBeGreaterThan(Date.now() + 29 * DAY)
    expect(until).toBeLessThan(Date.now() + 31 * DAY)
  })

  it('credits survive membership expiry (Galen: credits dont vanish after the month)', async () => {
    const c = await createPromoCode({ createdBy: 'galen' })
    await redeemPromoCode('u1', c.code)
    // hand-expire the seat
    const slot = kv.get('entitlements:u1') as { ents: Array<{ until?: number }> }
    slot.ents[0].until = Date.now() - 1000
    expect(await hasEditingMembership('u1')).toBe(false)
    expect(await readGenCredits('u1')).toBe(2)
    expect(await spendGenCredit('u1')).toBe(1)
  })

  it('one redemption per account; many accounts on one code', async () => {
    const c = await createPromoCode({ createdBy: 'galen' })
    expect((await redeemPromoCode('u1', c.code)).ok).toBe(true)
    const again = await redeemPromoCode('u1', c.code)
    expect(again.ok).toBe(false)
    expect(await readGenCredits('u1')).toBe(2)   // no double grant
    expect((await redeemPromoCode('u2', c.code)).ok).toBe(true)
    expect((await redeemPromoCode('u3', c.code)).ok).toBe(true)
    expect(await readGenCredits('u3')).toBe(2)
  })

  it('respects maxUses', async () => {
    const c = await createPromoCode({ createdBy: 'galen', maxUses: 2 })
    expect((await redeemPromoCode('u1', c.code)).ok).toBe(true)
    expect((await redeemPromoCode('u2', c.code)).ok).toBe(true)
    const r3 = await redeemPromoCode('u3', c.code)
    expect(r3.ok).toBe(false)
    if (!r3.ok) expect(r3.error).toMatch(/fully used/)
  })

  it('rejects garbage and unknown codes without touching grants', async () => {
    expect((await redeemPromoCode('u1', 'HELLO')).ok).toBe(false)
    expect((await redeemPromoCode('u1', 'CAFE-AAAA-AAAA')).ok).toBe(false)
    expect(await readGenCredits('u1')).toBe(0)
  })

  it('normalizes case and whitespace', async () => {
    const c = await createPromoCode({ createdBy: 'galen' })
    const r = await redeemPromoCode('u1', `  ${c.code.toLowerCase()}  `)
    expect(r.ok).toBe(true)
  })

  it('a second code EXTENDS a running promo seat instead of resetting it', async () => {
    const a = await createPromoCode({ createdBy: 'galen' })
    const b = await createPromoCode({ createdBy: 'galen' })
    await redeemPromoCode('u1', a.code)
    await redeemPromoCode('u1', b.code)
    const until = await membershipUntil('u1')
    expect(until).toBeGreaterThan(Date.now() + 59 * DAY)
    expect(await readGenCredits('u1')).toBe(4)
  })

  it('never puts a timer on a paying member seat; credits still land', async () => {
    await grantEntitlement('payer', { product: 'editor', sessionId: 'sub_123' })   // untimed = paid
    const c = await createPromoCode({ createdBy: 'galen' })
    const r = await redeemPromoCode('payer', c.code)
    expect(r.ok).toBe(true)
    expect(await membershipUntil('payer')).toBeNull()          // seat stays untimed
    expect(await hasEditingMembership('payer')).toBe(true)
    expect(await readGenCredits('payer')).toBe(2)
  })
})
