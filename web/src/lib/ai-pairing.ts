import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

// AI ↔ account pairing — the device-code handshake behind /pair. An AI (MCP)
// inits a code, the human opens /pair?code=…, signs in (or up), and clicks
// REGISTER: the AI gets its own labeled uc_pt_ key and every world its guest
// brewed transfers to the account. Durable (self-creating table, like
// CafePlayerToken) because init and poll can land on different serverless
// instances — the in-memory Map of /api/spaces/connect loses approvals on
// cold starts. Rows are short-lived: 10-min TTL, deleted on delivery; the raw
// key rests in the row only for the approved→polled window.

const TTL_MS = 10 * 60 * 1000

let ensured = false
async function ensure(): Promise<void> {
  if (ensured) return
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "CafeAiPairing" (
    "code" TEXT PRIMARY KEY,
    "secretHash" TEXT NOT NULL,
    "aiName" TEXT NOT NULL,
    "guestUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "token" TEXT,
    "handle" TEXT,
    "claimedWorlds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL)`)
  ensured = true
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

export type Pairing = {
  code: string
  aiName: string
  guestUserId: string | null
  status: 'pending' | 'approved'
  token: string | null
  handle: string | null
  claimedWorlds: number
  expiresAt: Date
}

/** Start a pairing. guestUserId ties the AI's guest-brewed worlds into the
 *  eventual claim (null when the AI has no guest session yet). */
export async function createPairing(aiName: string, guestUserId: string | null): Promise<{ code: string; secret: string; expiresIn: number }> {
  await ensure()
  await prisma.$executeRaw`DELETE FROM "CafeAiPairing" WHERE "expiresAt" < CURRENT_TIMESTAMP`
  const code = crypto.randomBytes(4).toString('hex').toUpperCase()
  const secret = crypto.randomBytes(16).toString('hex')
  const expiresAt = new Date(Date.now() + TTL_MS)
  await prisma.$executeRaw`INSERT INTO "CafeAiPairing" ("code","secretHash","aiName","guestUserId","expiresAt")
    VALUES (${code},${sha(secret)},${aiName},${guestUserId},${expiresAt})`
  return { code, secret, expiresIn: TTL_MS / 1000 }
}

/** Read a live pairing by code (no secret — safe fields only for the /pair page). */
export async function readPairing(code: string): Promise<Pairing | null> {
  await ensure()
  const rows = await prisma.$queryRaw<Pairing[]>`
    SELECT "code","aiName","guestUserId","status","token","handle","claimedWorlds","expiresAt"
    FROM "CafeAiPairing" WHERE "code" = ${code} AND "expiresAt" > CURRENT_TIMESTAMP LIMIT 1`
  return rows[0] ?? null
}

/** The human's click: attach the minted key + claim results to a pending code. */
export async function approvePairing(code: string, data: { token: string; handle: string | null; claimedWorlds: number }): Promise<boolean> {
  await ensure()
  const r = await prisma.$executeRaw`UPDATE "CafeAiPairing"
    SET "status" = 'approved', "token" = ${data.token}, "handle" = ${data.handle}, "claimedWorlds" = ${data.claimedWorlds}
    WHERE "code" = ${code} AND "status" = 'pending' AND "expiresAt" > CURRENT_TIMESTAMP`
  return Number(r) === 1
}

/** The AI's poll. Requires the init secret. Approved rows are delivered ONCE
 *  and deleted — the raw key never rests in the DB past this call. */
export async function pollPairing(code: string, secret: string):
  Promise<{ status: 'pending' } | { status: 'completed'; token: string; handle: string | null; claimedWorlds: number } | { status: 'gone' }> {
  await ensure()
  const rows = await prisma.$queryRaw<Array<Pairing & { secretHash: string }>>`
    SELECT "code","secretHash","aiName","guestUserId","status","token","handle","claimedWorlds","expiresAt"
    FROM "CafeAiPairing" WHERE "code" = ${code} AND "expiresAt" > CURRENT_TIMESTAMP LIMIT 1`
  const row = rows[0]
  if (!row || row.secretHash !== sha(secret)) return { status: 'gone' }
  if (row.status !== 'approved' || !row.token) return { status: 'pending' }
  await prisma.$executeRaw`DELETE FROM "CafeAiPairing" WHERE "code" = ${code}`
  return { status: 'completed', token: row.token, handle: row.handle, claimedWorlds: row.claimedWorlds }
}
