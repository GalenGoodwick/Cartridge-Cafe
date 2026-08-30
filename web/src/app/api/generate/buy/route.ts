import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createWorldgenCheckout } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

/** POST /api/generate/buy {qty?} — start the ad-hoc checkout for qty build
 *  credits at $5 each (Galen, Aug 24 "generate a world costs $5"; Aug 30
 *  "ability to buy more than one"). The webhook credits the gencredits
 *  ledger; the buyer returns to /create?paid=worldgen to spend them. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as { qty?: number }
  const qty = Number.isFinite(Number(body.qty)) ? Number(body.qty) : 1
  const out = await createWorldgenCheckout(user.id, req.nextUrl.origin, qty)
  if ('error' in out) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json({ url: out.url })
}
