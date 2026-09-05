import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EDITOR_PRICE_USD, createEditorCheckout, hasEditingMembership, stripeConfigured } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

/** THE EDITING MEMBERSHIP (Galen, Aug 26 — simplified). ONE tier, monthly,
 *  platform-wide: $10/mo to build on open building worlds. Play is always free.
 *  No dockstars, no quotas, no premium. Admins are members automatically.
 *  GET = my member state. POST = start the subscription. */

export async function GET() {
  const session = await getServerSession(authOptions)
  const user = session?.user?.email
    ? await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
    : null
  const member = user ? await hasEditingMembership(user.id) : false
  // LAPSED = held a seat once (paid or gift), none live now — the front door
  // shows the rejoin offer off this flag (Galen, Sep 5: "do they get a pop up
  // when membership expires? with offer to buy again?").
  let lapsed = false
  if (user && !member) {
    const { readEntitlements } = await import('@/lib/stripe')
    const ents = await readEntitlements(user.id)
    lapsed = ents.some((e) => e.product === 'editor' || e.product === 'editor_pro')
  }
  return NextResponse.json({
    member,
    lapsed,
    usd: EDITOR_PRICE_USD,
    creditsPerMonth: 2,
    buyable: stripeConfigured(),
    signedIn: !!user,
  })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  if (await hasEditingMembership(user.id)) {
    return NextResponse.json({ error: 'you are already a member', already: true }, { status: 400 })
  }
  const out = await createEditorCheckout(user.id, req.nextUrl.origin)
  if ('error' in out) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json({ url: out.url })
}
