import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { signChallenge } from '@/lib/passkeys'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/** POST /api/auth/guest — mint a temp user for account-free world brewing.
 *  Sets a signed httpOnly cookie the `guest` provider (and later the claim
 *  route) can trust. One world per guest; sign-up claims it — see
 *  /api/spaces/claim. Rate-limited per IP so this isn't a user-row faucet. */
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'local'
  if (await checkRateLimit('guest-mint', ip)) {
    return NextResponse.json({ error: 'Too many guest sessions from here — slow down' }, { status: 429 })
  }

  // reuse this browser's live guest instead of minting another
  const existing = req.cookies.get('cc_guest')?.value
  if (existing) {
    const { verifyChallengeCookie } = await import('@/lib/passkeys')
    const id = verifyChallengeCookie(existing)
    if (id) {
      const u = await prisma.user.findUnique({ where: { id }, select: { status: true } })
      if (u?.status === 'ACTIVE') return NextResponse.json({ ok: true, reused: true })
    }
  }

  const rand = Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  const user = await prisma.user.create({
    data: {
      email: `${rand}@guest.cartridge.cafe`,
      name: 'guest brewer',
    },
  })
  const res = NextResponse.json({ ok: true })
  // a year: the guest's only proof of ownership until they sign the deed
  res.cookies.set('cc_guest', signChallenge(user.id), { httpOnly: true, sameSite: 'lax', maxAge: 365 * 24 * 3600, path: '/' })
  return res
}
