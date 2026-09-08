import { describe, it as vit, expect, beforeAll } from 'vitest'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { addGenCredits, readGenCredits, spendGenCredit } from '@/lib/stripe'
import { createWorldIdempotent } from '@/lib/create-world-service'

// Gated (hits the dev DB, creates worlds): RUN_CREATE_IT=1 npx vitest run \
//   src/__tests__/integration/create-world-idempotent.test.ts
// Proves item-2's money-critical properties: a retry with the same idempotency key
// neither double-charges nor double-creates, and a broke request creates nothing
// and leaves the key free.
const it = vit.skipIf(!process.env.RUN_CREATE_IT)

const birthOpts = (name: string) => ({ ownerId: '', name, baseSlug: 'it-' + name, isPublic: false })

describe('createWorldIdempotent — idempotency + credit safety', () => {
  let userId = ''
  const made: string[] = []
  const keys: string[] = []

  beforeAll(async () => {
    const u = await prisma.user.findFirst({ select: { id: true } })
    userId = u!.id
    await addGenCredits(userId, 20, 'it-grant-' + crypto.randomUUID())
  })

  it('same idempotency key → ONE world, charged ONCE; retry replays', async () => {
    const key = 'it-' + crypto.randomUUID()
    keys.push(key)
    const before = await readGenCredits(userId)
    const slug = 'itworld' + Date.now().toString(36)
    const r1 = await createWorldIdempotent({ ownerId: userId, idempotencyKey: key, isKeeper: false, birth: { ...birthOpts(slug), ownerId: userId } })
    expect(r1.ok).toBe(true)
    if (r1.ok) made.push(r1.space.id)
    const afterFirst = await readGenCredits(userId)
    expect(afterFirst).toBe(before - 1)                       // charged once

    const r2 = await createWorldIdempotent({ ownerId: userId, idempotencyKey: key, isKeeper: false, birth: { ...birthOpts(slug + 'x'), ownerId: userId } })
    expect(r2.ok).toBe(true)
    if (r1.ok && r2.ok) {
      expect(r2.replayed).toBe(true)
      expect(r2.space.id).toBe(r1.space.id)                  // SAME world, not a new one
      expect(r2.token).toBeTruthy()                          // replay still returns a usable key
    }
    const afterReplay = await readGenCredits(userId)
    expect(afterReplay).toBe(before - 1)                     // NOT charged again
  }, 60000)

  it('different keys → different worlds, each charged', async () => {
    const before = await readGenCredits(userId)
    const kA = 'it-' + crypto.randomUUID(), kB = 'it-' + crypto.randomUUID()
    keys.push(kA, kB)
    const a = await createWorldIdempotent({ ownerId: userId, idempotencyKey: kA, isKeeper: false, birth: { ...birthOpts('ita' + Date.now().toString(36)), ownerId: userId } })
    const b = await createWorldIdempotent({ ownerId: userId, idempotencyKey: kB, isKeeper: false, birth: { ...birthOpts('itb' + Date.now().toString(36)), ownerId: userId } })
    expect(a.ok && b.ok).toBe(true)
    if (a.ok) made.push(a.space.id)
    if (b.ok) made.push(b.space.id)
    if (a.ok && b.ok) expect(a.space.id).not.toBe(b.space.id)
    expect(await readGenCredits(userId)).toBe(before - 2)
  }, 60000)

  it('no credit → needPayment, no world created, key left free', async () => {
    // drain to zero
    for (let i = 0; i < 30; i++) { if ((await spendGenCredit(userId)) === null) break }
    expect(await readGenCredits(userId)).toBe(0)
    const key = 'it-' + crypto.randomUUID()
    keys.push(key)
    const r = await createWorldIdempotent({ ownerId: userId, idempotencyKey: key, isKeeper: false, birth: { ...birthOpts('itbroke' + Date.now().toString(36)), ownerId: userId } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('needPayment')
    // key not consumed: after buying, the same key can create
    await addGenCredits(userId, 1, 'it-grant-' + crypto.randomUUID())
    const r2 = await createWorldIdempotent({ ownerId: userId, idempotencyKey: key, isKeeper: false, birth: { ...birthOpts('itbroke2' + Date.now().toString(36)), ownerId: userId } })
    expect(r2.ok).toBe(true)
    if (r2.ok) made.push(r2.space.id)
  }, 60000)

  // best-effort cleanup of the worlds this suite created
  it('cleanup', async () => {
    for (const id of made) { await prisma.playerSpace.delete({ where: { id } }).catch(() => {}) }
    for (const k of keys) { await prisma.$executeRawUnsafe('DELETE FROM cc_world_create WHERE idem_key = $1', k).catch(() => {}) }
    expect(true).toBe(true)
  }, 60000)
})
