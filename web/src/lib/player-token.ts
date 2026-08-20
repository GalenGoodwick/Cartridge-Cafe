import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

// Player keys — a signed-in player's OWN personal credential (uc_pt_). Connect an
// AI or a terminal to the cafe with it: chat the commons + create/tend YOUR OWN
// worlds. The key is ALWAYS RETRIEVABLE by its signed-in owner (Galen's law,
// Aug 20: "I always want to be able to use my existing connection key"): the raw
// key is stored encrypted at rest (AES-256-GCM under a key derived from
// NEXTAUTH_SECRET) alongside its SHA-256 auth hash — a DB leak alone exposes
// nothing, and COPY MY CURRENT KEY works from any signed-in browser. Auth
// lookups still go through the hash only. Keys minted before this ship have no
// stored raw — restoreRawKey() backfills one from a paste, verified against the
// hash. Self-creating table (raw SQL) so no Prisma migration is needed.

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
  await prisma.$executeRawUnsafe(`ALTER TABLE "CafePlayerToken" ADD COLUMN IF NOT EXISTS "rawEnc" TEXT`)
  ensured = true
}

// ── encrypted-at-rest raw key (pure, secret injectable for tests) ──
function encKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret + '|cafe-player-key-enc').digest()
}

/** AES-256-GCM encrypt a raw key → base64(iv | tag | ciphertext). */
export function encryptRawKey(raw: string, secret = process.env.NEXTAUTH_SECRET || ''): string | null {
  if (!secret) return null   // no secret configured → store nothing, never a weak cipher
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(secret), iv)
  const ct = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')
}

/** Decrypt a stored rawEnc; null on any mismatch (wrong secret, corrupt blob). */
export function decryptRawKey(enc: string, secret = process.env.NEXTAUTH_SECRET || ''): string | null {
  if (!secret || !enc) return null
  try {
    const buf = Buffer.from(enc, 'base64')
    const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(secret), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

/** Mint a fresh player key. By default revokes the caller's existing keys
 *  first — one live key per player keeps "shown once, revocable" simple and
 *  safe. Pairing-minted keys pass { revokeExisting: false }: each registered
 *  AI holds its own labeled key, and revoke-all still kills every one of them.
 *  Returns the raw key (show ONCE) + its display prefix. */
export async function mintPlayerToken(userId: string, label?: string, opts?: { revokeExisting?: boolean }): Promise<{ raw: string; prefix: string }> {
  await ensure()
  if (opts?.revokeExisting !== false) {
    await prisma.$executeRaw`UPDATE "CafePlayerToken" SET "revokedAt" = CURRENT_TIMESTAMP WHERE "userId" = ${userId} AND "revokedAt" IS NULL`
  }
  const raw = `uc_pt_${crypto.randomBytes(20).toString('hex')}`
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  const prefix = raw.slice(0, 12) + '…'
  const rawEnc = encryptRawKey(raw)
  await prisma.$executeRaw`INSERT INTO "CafePlayerToken" ("tokenHash","userId","prefix","label","rawEnc") VALUES (${hash},${userId},${prefix},${label ?? null},${rawEnc})`
  return { raw, prefix }
}

/** The owner's current (newest active) key, decrypted — the ALWAYS-COPYABLE
 *  path. null when there is no active key, or it predates retrievable storage
 *  (restoreRawKey backfills those). */
export async function getActiveRawKey(userId: string): Promise<{ raw: string; prefix: string } | null> {
  await ensure()
  const rows = await prisma.$queryRaw<Array<{ rawEnc: string | null; prefix: string }>>`
    SELECT "rawEnc","prefix" FROM "CafePlayerToken"
    WHERE "userId" = ${userId} AND "revokedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`
  const row = rows[0]
  if (!row?.rawEnc) return null
  const raw = decryptRawKey(row.rawEnc)
  return raw ? { raw, prefix: row.prefix } : null
}

/** Backfill a pre-retrievable key from a paste: only stored if the pasted raw
 *  HASHES to one of the owner's active rows — a wrong or foreign key changes
 *  nothing. Returns the prefix on success. */
export async function restoreRawKey(userId: string, raw: string): Promise<{ prefix: string } | null> {
  if (!raw?.startsWith('uc_pt_')) return null
  await ensure()
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  const rawEnc = encryptRawKey(raw)
  if (!rawEnc) return null
  const rows = await prisma.$queryRaw<Array<{ prefix: string }>>`
    SELECT "prefix" FROM "CafePlayerToken"
    WHERE "tokenHash" = ${hash} AND "userId" = ${userId} AND "revokedAt" IS NULL LIMIT 1`
  if (!rows[0]) return null
  await prisma.$executeRaw`UPDATE "CafePlayerToken" SET "rawEnc" = ${rawEnc} WHERE "tokenHash" = ${hash}`
  return { prefix: rows[0].prefix }
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

/** Revoke ONE key by its raw value — the undo for a mint whose delivery failed.
 *  The stored raw is dropped with it: a revoked key is never retrievable. */
export async function revokePlayerTokenByRaw(raw: string): Promise<void> {
  await ensure()
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  await prisma.$executeRaw`UPDATE "CafePlayerToken" SET "revokedAt" = CURRENT_TIMESTAMP, "rawEnc" = NULL WHERE "tokenHash" = ${hash} AND "revokedAt" IS NULL`
}

/** Revoke ALL of the player's keys at once (the "kill my key" button). */
export async function revokePlayerTokens(userId: string): Promise<number> {
  await ensure()
  const r = await prisma.$executeRaw`UPDATE "CafePlayerToken" SET "revokedAt" = CURRENT_TIMESTAMP, "rawEnc" = NULL WHERE "userId" = ${userId} AND "revokedAt" IS NULL`
  return Number(r)
}
