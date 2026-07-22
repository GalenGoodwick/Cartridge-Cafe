import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { availableProducts, createCheckoutSession, readEntitlements, stripeConfigured } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

/** GET /api/pay/checkout — what's sellable + what this player already owns.
 *  FRONT DOOR renders buy buttons from this; empty products = render nothing
 *  (payments not switched on yet). */
export async function GET() {
  const session = await getServerSession(authOptions)
  const user = session?.user?.email
    ? await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
    : null
  return NextResponse.json({
    configured: stripeConfigured(),
    products: availableProducts(),
    mine: user ? (await readEntitlements(user.id)).filter((e) => e.active) : [],
  })
}

/** POST /api/pay/checkout {product, slug?} — start a Stripe Checkout for a
 *  signed-in player. 501 until Galen drops the Stripe keys into Vercel. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const product = String(body.product ?? '')
  const slug = typeof body.slug === 'string' ? body.slug.slice(0, 64) : undefined

  const out = await createCheckoutSession(product, user.id, req.nextUrl.origin, slug)
  if ('error' in out) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json({ url: out.url })
}
