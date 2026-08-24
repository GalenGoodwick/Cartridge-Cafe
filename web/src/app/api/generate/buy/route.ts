import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createWorldgenCheckout } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

/** POST /api/generate/buy — start the $5 ad-hoc checkout for one world
 *  generation (Galen, Aug 24: "generate a world costs $5"). The webhook credits
 *  the gencredits ledger; the buyer returns to /cards?paid=worldgen to spend it. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const out = await createWorldgenCheckout(user.id, req.nextUrl.origin)
  if ('error' in out) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json({ url: out.url })
}
