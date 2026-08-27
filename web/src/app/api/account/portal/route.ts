import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { findActiveSubscriptions, createPortalSession, stripeConfigured } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

/** POST /api/account/portal — open the Stripe billing portal for the signed-in
 *  member: invoices, payment method, and CANCELLATION live there (the
 *  click-to-cancel-compliant self-serve surface — Stripe hosts it). */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (!stripeConfigured()) return NextResponse.json({ error: 'payments not configured yet' }, { status: 501 })

  const subs = await findActiveSubscriptions(user.id)
  if (subs.length === 0) {
    return NextResponse.json({ error: 'no active subscription on this account — nothing to manage' }, { status: 404 })
  }
  const out = await createPortalSession(subs[0].customer, `${req.nextUrl.origin}/account`)
  if ('error' in out) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json({ url: out.url })
}
