import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isProductConfigured, readEntitlements, stripeConfigured } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

/** GET /api/premium?slug=<world> — the demo gate's one question: is this world
 *  premium, and does the viewer own it? (PREMIUM GAMES — Galen, Aug 24:
 *  Tideglass Act 1, $5 pay-once, 1-minute demo.)
 *
 *  A world declares itself premium via worldData.premium
 *  { usd: 5, demoSeconds: 60 } — set by its owner over the bridge. Ownership =
 *  world owner, or an active slug-scoped `premium5` entitlement (granted by the
 *  pay webhook). The gate itself lives client-side (PremiumGate); this endpoint
 *  is its server truth. */
export async function GET(req: NextRequest) {
  const slug = (req.nextUrl.searchParams.get('slug') || '').trim().toLowerCase()
  if (!slug || slug.length > 80) return NextResponse.json({ error: 'bad slug' }, { status: 400 })

  const space = await prisma.playerSpace.findUnique({
    where: { slug },
    select: { ownerId: true, snapshot: true },
  })
  if (!space) return NextResponse.json({ error: 'no such world' }, { status: 404 })

  const wd = (space.snapshot as { worldData?: { premium?: { usd?: unknown; demoSeconds?: unknown } } } | null)?.worldData
  const p = wd?.premium
  const usd = typeof p?.usd === 'number' && p.usd > 0 ? p.usd : null
  if (!usd) return NextResponse.json({ premium: null, owned: true })   // not premium — play freely

  const session = await getServerSession(authOptions)
  const user = session?.user?.email
    ? await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
    : null
  const owned = !!user && (
    user.id === space.ownerId ||
    (await readEntitlements(user.id)).some(e => e.active && e.product === 'premium5' && e.slug === slug)
  )

  return NextResponse.json({
    premium: {
      usd,
      demoSeconds: typeof p?.demoSeconds === 'number' && p.demoSeconds >= 0 ? p.demoSeconds : 60,
    },
    owned,
    signedIn: !!user,
    buyable: stripeConfigured() && isProductConfigured('premium5'),
  })
}
