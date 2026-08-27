import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createCheckoutSession, isProductConfigured, hasIpControl } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

/** GET /suite/buy — the ◆ JOIN THE SUITE hop: creates the IP-control checkout
 *  server-side and redirects into Stripe (a plain link, no client JS). */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.redirect(new URL(`/auth/signin?callbackUrl=${encodeURIComponent('/suite')}`, req.url))
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  if (!user) return NextResponse.redirect(new URL('/auth/signin', req.url))
  if (!isProductConfigured('ip')) return NextResponse.redirect(new URL('/suite', req.url))
  if (await hasIpControl(user.id)) return NextResponse.redirect(new URL('/suite', req.url))
  const out = await createCheckoutSession('ip', user.id, req.nextUrl.origin)
  if ('error' in out) return NextResponse.redirect(new URL('/suite', req.url))
  return NextResponse.redirect(out.url)
}
