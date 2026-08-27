import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasEditingMembership, readEntitlements, readGenCredits, findActiveSubscriptions, stripeConfigured, EDITOR_PRICE_USD } from '@/lib/stripe'
import AccountClient from './AccountClient'

export const metadata: Metadata = {
  title: 'Account',
  description: 'Manage your cartridge.cafe membership, data, and account.',
}
export const dynamic = 'force-dynamic'

/** /account — the legal surface under the username: subscription management
 *  (Stripe billing portal — cancel/invoices/payment method), the data rights
 *  (export + delete), and the plain facts of the account. */
export default async function AccountPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) redirect(`/auth/signin?callbackUrl=${encodeURIComponent('/account')}`)
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true, name: true, createdAt: true },
  })
  if (!user) redirect('/auth/signin')

  const [member, ents, credits, subs, worlds] = await Promise.all([
    hasEditingMembership(user.id),
    readEntitlements(user.id),
    readGenCredits(user.id),
    stripeConfigured() ? findActiveSubscriptions(user.id) : Promise.resolve([]),
    prisma.playerSpace.count({ where: { ownerId: user.id } }),
  ])

  return (
    <AccountClient
      email={user.email}
      name={user.name}
      memberSince={user.createdAt.toISOString()}
      member={member}
      hasSubscription={subs.length > 0}
      renewsAt={subs[0]?.cancelAtPeriodEnd ? null : subs[0]?.currentPeriodEnd ?? null}
      endsAt={subs[0]?.cancelAtPeriodEnd ? subs[0]?.currentPeriodEnd ?? null : null}
      priceUsd={EDITOR_PRICE_USD}
      buyable={stripeConfigured()}
      genCredits={credits}
      entitlements={ents.filter(e => e.active).map(e => e.product)}
      worldCount={worlds}
    />
  )
}
