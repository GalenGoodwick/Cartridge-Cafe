import { createHash, createPublicKey, verify as edVerify } from 'crypto'
import { NextRequest } from 'next/server'
import { prisma } from './prisma'

/** Device-bound AGENT auth: ed25519 request signing.
 *
 *  The companion registers a public key once (bearer-authorized), then may
 *  authenticate any request by signing instead of sending its uc_ck_ bearer.
 *  The private key never travels — a leaked transcript or env dump leaks
 *  nothing reusable.
 *
 *  Headers:
 *    x-agent-key: <AgentKeypair.id>
 *    x-agent-ts:  <unix ms — must be within 5 minutes of server time>
 *    x-agent-sig: base64(ed25519_sign(`${ts}\n${METHOD}\n${path}\n${sha256hex(body)}`))
 */

const WINDOW_MS = 5 * 60 * 1000

export function agentSigningPayload(ts: string, method: string, path: string, bodyText: string): string {
  const bodyHash = createHash('sha256').update(bodyText).digest('hex')
  return `${ts}\n${method.toUpperCase()}\n${path}\n${bodyHash}`
}

export type SignedAgent = { companionId: string; handle: string; name: string; worldsPerDay: number; ownerId: string }

/** Verify a signed agent request. Returns the companion identity or null.
 *  Callers pass the raw body text (they must read it once, before json()). */
export async function verifySignedAgentRequest(req: NextRequest, bodyText: string): Promise<SignedAgent | null> {
  const keyId = req.headers.get('x-agent-key')
  const ts = req.headers.get('x-agent-ts')
  const sig = req.headers.get('x-agent-sig')
  if (!keyId || !ts || !sig) return null
  const tsN = Number(ts)
  if (!Number.isFinite(tsN) || Math.abs(Date.now() - tsN) > WINDOW_MS) return null

  const kp = await prisma.agentKeypair.findUnique({
    where: { id: keyId },
    include: { companion: true },
  })
  if (!kp || kp.revokedAt || kp.companion.revokedAt) return null

  try {
    // raw 32-byte ed25519 public key → DER SPKI for node crypto
    const rawKey = Buffer.from(kp.publicKey, 'base64')
    if (rawKey.length !== 32) return null
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawKey])
    const keyObj = createPublicKey({ key: spki, format: 'der', type: 'spki' })
    const path = new URL(req.url).pathname
    const payload = agentSigningPayload(ts, req.method, path, bodyText)
    const ok = edVerify(null, Buffer.from(payload), keyObj, Buffer.from(sig, 'base64'))
    if (!ok) return null
  } catch {
    return null
  }

  void prisma.agentKeypair.update({ where: { id: kp.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
  const c = kp.companion
  return { companionId: c.id, handle: c.handle, name: c.name, worldsPerDay: c.worldsPerDay, ownerId: c.ownerId }
}

/** Self-creating table — the EngineSlot pattern, no prod migration step. */
let kpTableReady = false
export async function ensureAgentKeypairTable(): Promise<void> {
  if (kpTableReady) return
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AgentKeypair" (
    "id" TEXT PRIMARY KEY, "companionId" TEXT NOT NULL, "publicKey" TEXT NOT NULL UNIQUE,
    "deviceName" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3))`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AgentKeypair_companionId_idx" ON "AgentKeypair"("companionId")`)
  kpTableReady = true
}
