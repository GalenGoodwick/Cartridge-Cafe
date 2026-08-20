// The always-copyable player key, end-to-end against the dev DB (needs
// DATABASE_URL + NEXTAUTH_SECRET): mint stores an encrypted raw the owner can
// re-read; restore backfills a legacy row only from the true raw; revoke
// drops the stored raw for good.
import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  mintPlayerToken, getActiveRawKey, restoreRawKey, validatePlayerToken, revokePlayerTokens,
} from '@/lib/player-token'

const USER = 'itest-user-' + Math.floor(Math.random() * 1e6)

describe.sequential('retrievable player key', () => {
  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM "CafePlayerToken" WHERE "userId" = '${USER}'`)
  })

  it('mint → the owner can always re-read the same raw key', async () => {
    const { raw, prefix } = await mintPlayerToken(USER)
    const back = await getActiveRawKey(USER)
    expect(back?.raw).toBe(raw)
    expect(back?.prefix).toBe(prefix)
    expect((await validatePlayerToken(raw))?.userId).toBe(USER)
  })

  it('legacy row (no rawEnc): restore accepts only the TRUE raw', async () => {
    const { raw } = await mintPlayerToken(USER)   // revokes previous, mints fresh
    await prisma.$executeRawUnsafe(`UPDATE "CafePlayerToken" SET "rawEnc" = NULL WHERE "userId" = '${USER}' AND "revokedAt" IS NULL`)
    expect(await getActiveRawKey(USER)).toBeNull()                      // legacy: not retrievable
    expect(await restoreRawKey(USER, 'uc_pt_' + '0'.repeat(40))).toBeNull()   // wrong key → rejected
    const r = await restoreRawKey(USER, raw)                            // true key → restored
    expect(r?.prefix).toBe(raw.slice(0, 12) + '…')
    expect((await getActiveRawKey(USER))?.raw).toBe(raw)                // retrievable forever after
  })

  it('revoke kills retrieval AND auth', async () => {
    const { raw } = await mintPlayerToken(USER)
    await revokePlayerTokens(USER)
    expect(await getActiveRawKey(USER)).toBeNull()
    expect(await validatePlayerToken(raw)).toBeNull()
  })
})
