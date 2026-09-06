import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { findActiveSubscriptions, cancelSubscriptionAtPeriodEnd, stripeConfigured } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

/** POST /api/account/cancel — the DIRECT cancel button (click-to-cancel:
 *  canceling must be as easy as subscribing — one click here, no portal
 *  navigation required). Cancels at PERIOD END: billing stops, the paid-for
 *  seat runs out its month. The webhook revokes the entitlement when Stripe
 *  reports the subscription deleted. */
export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (!stripeConfigured()) return NextResponse.json({ error: 'payments not configured yet' }, { status: 501 })

  // the one-click cancel is the EDITING seat's button (audit: it used to end
  // EVERY subscription — ads, ip control — in one click)
  const subs = (await findActiveSubscriptions(user.id)).filter((s) => s.product === 'editor' || s.product === 'editor_pro')
  if (subs.length === 0) return NextResponse.json({ error: 'no active editing membership to cancel — other subscriptions live in MANAGE SUBSCRIPTION' }, { status: 404 })
  const alreadyEnding = subs.every((s) => s.cancelAtPeriodEnd)
  if (alreadyEnding) return NextResponse.json({ ok: true, already: true, endsAt: subs[0].currentPeriodEnd })

  for (const s of subs) {
    if (!s.cancelAtPeriodEnd && !(await cancelSubscriptionAtPeriodEnd(s.id))) {
      return NextResponse.json({ error: 'stripe refused the cancellation — try MANAGE SUBSCRIPTION' }, { status: 502 })
    }
  }
  return NextResponse.json({ ok: true, endsAt: subs[0].currentPeriodEnd })
}
