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
  return NextResponse.json({
    member,
    usd: EDITOR_PRICE_USD,
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
