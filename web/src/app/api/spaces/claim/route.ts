import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { verifyChallengeCookie } from '@/lib/passkeys'
import { claimGuestEstate } from '@/lib/claim-guest'

export const dynamic = 'force-dynamic'

/** POST /api/spaces/claim — sign the deed. A real (non-temp) signed-in user
 *  whose browser still carries the guest cookie takes ownership of every
 *  world the guest brewed; the temp user is then retired. Idempotent and a
 *  silent no-op without a valid cookie, so the client may call it freely. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.isTemp) return NextResponse.json({ claimed: 0 })

  const raw = req.cookies.get('cc_guest')?.value
  const guestId = raw ? verifyChallengeCookie(raw) : null
  if (!guestId) return NextResponse.json({ claimed: 0 })

  const me = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  if (!me) return NextResponse.json({ claimed: 0 })

  const claimed = await claimGuestEstate(guestId, { id: me.id, email: session.user.email })

  const res = NextResponse.json({ claimed })
  res.cookies.delete('cc_guest')
  return res
}
