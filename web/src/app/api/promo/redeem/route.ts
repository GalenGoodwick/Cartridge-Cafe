import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redeemPromoCode } from '@/lib/promo'

export const dynamic = 'force-dynamic'

/** POST /api/promo/redeem {code} — one redemption per account: build credits
 *  land permanently, membership runs for the code's day count. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  const body = (await req.json().catch(() => ({}))) as { code?: string }
  if (!body.code || typeof body.code !== 'string') return NextResponse.json({ error: 'no code given' }, { status: 400 })
  const out = await redeemPromoCode(user.id, body.code)
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: 400 })
  return NextResponse.json(out)
}
