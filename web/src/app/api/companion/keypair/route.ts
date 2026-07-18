import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validateCompanionKey, bearer } from '@/lib/companion'
import { ensureAgentKeypairTable } from '@/lib/agent-sign'

export const dynamic = 'force-dynamic'

// Device-binding for companions: register an ed25519 public key under your
// identity (bearer-authorized, once per device), then sign requests instead of
// sending the bearer — see lib/agent-sign.ts for the header contract.

/** GET — list this companion's registered device keys */
export async function GET(req: NextRequest) {
  await ensureAgentKeypairTable()
  const raw = bearer(req)
  const auth = raw ? await validateCompanionKey(raw) : null
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const keys = await prisma.agentKeypair.findMany({
    where: { companionId: auth.companionId, revokedAt: null },
    select: { id: true, deviceName: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ companion: auth.handle, keys })
}

/** POST — register a device key: { publicKey: base64(32-byte ed25519), deviceName? }
 *  DELETE-ish: pass { revoke: '<keyId>' } to revoke one instead. */
export async function POST(req: NextRequest) {
  await ensureAgentKeypairTable()
  const raw = bearer(req)
  const auth = raw ? await validateCompanionKey(raw) : null
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))

  if (body.revoke) {
    const kp = await prisma.agentKeypair.findUnique({ where: { id: String(body.revoke) } })
    if (!kp || kp.companionId !== auth.companionId) return NextResponse.json({ error: 'Not yours' }, { status: 404 })
    await prisma.agentKeypair.update({ where: { id: kp.id }, data: { revokedAt: new Date() } })
    return NextResponse.json({ ok: true, revoked: kp.id })
  }

  const pub = String(body.publicKey || '')
  const rawKey = Buffer.from(pub, 'base64')
  if (rawKey.length !== 32) return NextResponse.json({ error: 'publicKey must be base64 of a raw 32-byte ed25519 public key' }, { status: 400 })

  const kp = await prisma.agentKeypair.create({
    data: {
      companionId: auth.companionId,
      publicKey: rawKey.toString('base64'),
      deviceName: String(body.deviceName || '').slice(0, 60) || null,
    },
  })
  return NextResponse.json({
    ok: true,
    keyId: kp.id,
    sign: 'headers: x-agent-key=<keyId> · x-agent-ts=<unix ms> · x-agent-sig=base64(ed25519_sign(`${ts}\\n${METHOD}\\n${path}\\n${sha256hex(body)}`)) — accepted wherever your bearer is',
  })
}
