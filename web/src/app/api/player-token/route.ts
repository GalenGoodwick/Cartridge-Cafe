import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { mintPlayerToken, listPlayerTokens, revokePlayerTokens, getActiveRawKey, restoreRawKey } from '@/lib/player-token'

export const dynamic = 'force-dynamic'

async function meId(): Promise<string | null> {
  const session = await getServerSession(authOptions).catch(() => null)
  const email = session?.user?.email
  if (!email) return null
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  return u?.id ?? null
}

/** GET — your live keys, and (Galen's law: always copyable) the CURRENT key's
 *  raw value, decrypted for its signed-in owner. `raw` is absent only for keys
 *  minted before retrievable storage — POST {restore} backfills those. */
export async function GET() {
  const me = await meId()
  if (!me) return NextResponse.json({ signedIn: false, keys: [] })
  try {
    const [keys, active] = await Promise.all([listPlayerTokens(me), getActiveRawKey(me)])
    return NextResponse.json({ signedIn: true, keys, ...(active ? { raw: active.raw } : {}) })
  } catch {
    // degraded, NOT "no keys" — a DB blip must be distinguishable from an empty
    // answer (degraded-poll law), or the client treats it as key-less truth
    return NextResponse.json({ signedIn: true, keys: [], degraded: true })
  }
}

/** POST — mint a fresh key (revokes any previous), or {restore: "uc_pt_…"}:
 *  backfill a pre-retrievable key's raw from a paste, verified against its hash. */
export async function POST(req: NextRequest) {
  const me = await meId()
  if (!me) return NextResponse.json({ error: 'sign in to mint a key' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  if (typeof body?.restore === 'string') {
    try {
      const r = await restoreRawKey(me, body.restore.trim())
      if (!r) return NextResponse.json({ error: 'that key is not your current one' }, { status: 400 })
      return NextResponse.json({ ok: true, restored: true, prefix: r.prefix })
    } catch {
      return NextResponse.json({ error: 'could not restore' }, { status: 500 })
    }
  }
  const label = body?.label
  try {
    const { raw, prefix } = await mintPlayerToken(me, typeof label === 'string' ? label.slice(0, 40) : undefined)
    return NextResponse.json({ ok: true, token: raw, prefix })
  } catch {
    return NextResponse.json({ error: 'could not mint a key' }, { status: 500 })
  }
}

/** DELETE — revoke all your keys (kill switch). */
export async function DELETE() {
  const me = await meId()
  if (!me) return NextResponse.json({ error: 'sign in' }, { status: 401 })
  try {
    const n = await revokePlayerTokens(me)
    return NextResponse.json({ ok: true, revoked: n })
  } catch {
    return NextResponse.json({ error: 'could not revoke' }, { status: 500 })
  }
}
