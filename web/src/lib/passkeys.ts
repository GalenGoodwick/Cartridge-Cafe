import { createHmac } from 'crypto'
import { NextRequest } from 'next/server'
import { prisma } from './prisma'

/** Device-bound human auth (WebAuthn passkeys) — shared plumbing.
 *  The relying party is derived from the request host so dev (localhost)
 *  and prod (cartridge.cafe) both verify against their own origin. */

export function rpFrom(req: NextRequest): { rpID: string; origin: string; rpName: string } {
  const host = req.headers.get('host') || 'localhost:3000'
  const rpID = host.split(':')[0]
  const proto = rpID === 'localhost' ? 'http' : 'https'
  return { rpID, origin: `${proto}://${host}`, rpName: 'cartridge.cafe' }
}

/** Challenges ride in an HMAC-signed, httpOnly cookie — stateless across
 *  lambdas, tamper-evident, 5-minute life. */
const SECRET = () => process.env.NEXTAUTH_SECRET || 'cafe-dev'

export function signChallenge(challenge: string): string {
  const mac = createHmac('sha256', SECRET()).update(challenge).digest('base64url')
  return `${challenge}.${mac}`
}

export function verifyChallengeCookie(cookie: string | undefined): string | null {
  if (!cookie) return null
  const dot = cookie.lastIndexOf('.')
  if (dot < 0) return null
  const challenge = cookie.slice(0, dot)
  return signChallenge(challenge) === cookie ? challenge : null
}

export const CHALLENGE_COOKIE = 'cc_pk_challenge'

/** The Passkey table creates itself on first use — prod deploys need no
 *  migration step (the EngineSlot pattern). */
let tableReady = false
export async function ensurePasskeyTable(): Promise<void> {
  if (tableReady) return
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Passkey" (
    "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "credentialId" TEXT NOT NULL UNIQUE,
    "publicKey" TEXT NOT NULL, "counter" INTEGER NOT NULL DEFAULT 0, "transports" TEXT,
    "deviceName" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastUsedAt" TIMESTAMP(3))`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Passkey_userId_idx" ON "Passkey"("userId")`)
  tableReady = true
}
