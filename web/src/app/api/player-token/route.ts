import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { mintPlayerToken, listPlayerTokens, revokePlayerTokens } from '@/lib/player-token'

export const dynamic = 'force-dynamic'

async function meId(): Promise<string | null> {
  const session = await getServerSession(authOptions).catch(() => null)
  const email = session?.user?.email
  if (!email) return null
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  return u?.id ?? null
}

/** GET — your live keys (prefixes only; the raw key is never re-shown). */
export async function GET() {
  const me = await meId()
  if (!me) return NextResponse.json({ signedIn: false, keys: [] })
  try {
    return NextResponse.json({ signedIn: true, keys: await listPlayerTokens(me) })
  } catch {
    return NextResponse.json({ signedIn: true, keys: [] })
  }
}

/** POST — mint a fresh key (shown ONCE). Revokes any previous key. */
export async function POST(req: NextRequest) {
  const me = await meId()
  if (!me) return NextResponse.json({ error: 'sign in to mint a key' }, { status: 401 })
  const label = (await req.json().catch(() => ({})))?.label
  try {
    const { raw, prefix } = await mintPlayerToken(me, typeof label === 'string' ? label.slice(0, 40) : undefined)
    return NextResponse.json({ ok: true, token: raw, prefix })   // raw shown once
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
