import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

// Player keys — a signed-in player's OWN personal credential (uc_pt_). Connect an
// AI or a terminal to the cafe with it: chat the commons + create/tend YOUR OWN
// worlds. Raw key is shown ONCE; only its SHA-256 is stored, and it's revocable.
// Self-creating table (raw SQL) so no Prisma migration is needed — the cafe's
// community layer is intentionally unmodeled.

let ensured = false
async function ensure(): Promise<void> {
  if (ensured) return
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "CafePlayerToken" (
    "tokenHash" TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3))`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CafePlayerToken_user_idx" ON "CafePlayerToken"("userId")`)
  ensured = true
}

/** Mint a fresh player key. Revokes the caller's existing keys first — one live
 *  key per player keeps "shown once, revocable" simple and safe. Returns the raw
 *  key (show ONCE) + its display prefix. */
export async function mintPlayerToken(userId: string, label?: string): Promise<{ raw: string; prefix: string }> {
  await ensure()
  await prisma.$executeRaw`UPDATE "CafePlayerToken" SET "revokedAt" = CURRENT_TIMESTAMP WHERE "userId" = ${userId} AND "revokedAt" IS NULL`
  const raw = `uc_pt_${crypto.randomBytes(20).toString('hex')}`
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  const prefix = raw.slice(0, 12) + '…'
  await prisma.$executeRaw`INSERT INTO "CafePlayerToken" ("tokenHash","userId","prefix","label") VALUES (${hash},${userId},${prefix},${label ?? null})`
  return { raw, prefix }
}

/** Resolve a raw uc_pt_ key → the owning userId, or null if unknown/revoked. */
export async function validatePlayerToken(raw: string): Promise<{ userId: string } | null> {
  if (!raw || !raw.startsWith('uc_pt_')) return null
  await ensure()
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  const rows = await prisma.$queryRaw<Array<{ userId: string }>>`
    SELECT "userId" FROM "CafePlayerToken" WHERE "tokenHash" = ${hash} AND "revokedAt" IS NULL LIMIT 1`
  return rows[0] ? { userId: rows[0].userId } : null
}

/** The player's live (non-revoked) keys, for the account-tools list. */
export async function listPlayerTokens(userId: string): Promise<Array<{ prefix: string; label: string | null; createdAt: Date }>> {
  await ensure()
  return prisma.$queryRaw<Array<{ prefix: string; label: string | null; createdAt: Date }>>`
    SELECT "prefix","label","createdAt" FROM "CafePlayerToken"
    WHERE "userId" = ${userId} AND "revokedAt" IS NULL ORDER BY "createdAt" DESC`
}

/** Revoke ALL of the player's keys at once (the "kill my key" button). */
export async function revokePlayerTokens(userId: string): Promise<number> {
  await ensure()
  const r = await prisma.$executeRaw`UPDATE "CafePlayerToken" SET "revokedAt" = CURRENT_TIMESTAMP WHERE "userId" = ${userId} AND "revokedAt" IS NULL`
  return Number(r)
}
