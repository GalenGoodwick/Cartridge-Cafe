import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EDITOR_PRICE_USD, EDITOR_PRO_PRICE_USD, FREE_WORLD_CAP, createEditorCheckout, membershipTier, stripeConfigured } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

/** THE EDITING MEMBERSHIP (Galen, Aug 24). Two tiers, monthly, platform-wide:
 *    basic   $10/mo — edit live games + 10 worlds
 *    premium $100/mo — edit live games + 100 worlds
 *    (no membership — a 3-world try-it floor)
 *  GET = my tier + quota + usage. POST {tier} = start that tier's subscription. */

const quotaOf = (t: 'pro' | 'basic' | null) => (t === 'pro' ? 100 : t === 'basic' ? 10 : FREE_WORLD_CAP)

export async function GET() {
  const session = await getServerSession(authOptions)
  const user = session?.user?.email
    ? await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
    : null
  const tier = user ? await membershipTier(user.id) : null
  const owned = user ? await prisma.playerSpace.count({ where: { ownerId: user.id } }) : 0
  return NextResponse.json({
    tier,                               // 'pro' | 'basic' | null
    member: tier !== null,
    quota: quotaOf(tier),
    worldsOwned: owned,
    basicUsd: EDITOR_PRICE_USD,
    proUsd: EDITOR_PRO_PRICE_USD,
    buyable: stripeConfigured(),
    signedIn: !!user,
  })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const tier = body?.tier === 'pro' ? 'pro' : 'basic'
  const current = await membershipTier(user.id)
  if (current === tier) return NextResponse.json({ error: `you are already on the ${tier} plan`, already: true }, { status: 400 })
  if (current === 'pro' && tier === 'basic') return NextResponse.json({ error: 'you are on premium — downgrade from the billing portal', already: true }, { status: 400 })

  const out = await createEditorCheckout(user.id, req.nextUrl.origin, tier)
  if ('error' in out) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json({ url: out.url })
}
