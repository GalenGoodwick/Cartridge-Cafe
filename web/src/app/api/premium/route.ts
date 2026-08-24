import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createExperienceCheckout, readEntitlements, stripeConfigured } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

/** PAID EXPERIENCES (Galen, Aug 24: "these experiences are worth paying for…
 *  purchase gives you access to co-program the world"). A world declares its
 *  price in worldData.premium { usd, demoSeconds?, coProgram? }. Buying grants
 *  a slug-scoped `experience` entitlement AND a member:<handle> co-program key
 *  (the webhook). Every paid experience is announced LIVE · EXPERIMENTAL.
 *
 *  GET  ?slug — the gate's server truth (price, demo, whether the viewer's in).
 *  POST {slug} — start an ad-hoc Stripe checkout at the world's OWN price
 *               (read here, server-side — the client never sends the amount). */

async function priceOf(slug: string) {
  const space = await prisma.playerSpace.findUnique({
    where: { slug },
    select: { id: true, name: true, ownerId: true, snapshot: true },
  })
  if (!space) return null
  const wd = (space.snapshot as { worldData?: { premium?: { usd?: unknown; demoSeconds?: unknown; coProgram?: unknown } } } | null)?.worldData
  const p = wd?.premium
  const usd = typeof p?.usd === 'number' && p.usd > 0 ? p.usd : null
  return {
    space,
    usd,
    demoSeconds: typeof p?.demoSeconds === 'number' && p.demoSeconds >= 0 ? p.demoSeconds : 60,
    coProgram: p?.coProgram !== false,   // default TRUE — Galen's ruling
  }
}

/** Owner, or holds an active `experience` entitlement for this world. */
async function ownsExperience(userId: string, ownerId: string, slug: string): Promise<boolean> {
  if (userId === ownerId) return true
  const ents = await readEntitlements(userId)
  return ents.some(e => e.active && e.product === 'experience' && e.slug === slug)
}

export async function GET(req: NextRequest) {
  const slug = (req.nextUrl.searchParams.get('slug') || '').trim().toLowerCase()
  if (!slug || slug.length > 80) return NextResponse.json({ error: 'bad slug' }, { status: 400 })

  const info = await priceOf(slug)
  if (!info) return NextResponse.json({ error: 'no such world' }, { status: 404 })
  if (!info.usd) return NextResponse.json({ premium: null, owned: true })   // free — play on

  const session = await getServerSession(authOptions)
  const user = session?.user?.email
    ? await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, email: true } })
    : null
  let owned = false
  if (user) {
    owned = await ownsExperience(user.id, info.space.ownerId, slug)
    if (!owned) {
      // a live member row (bought earlier, or invited) is co-program access too
      const handle = (user.email || '').split('@')[0].replace(/[^a-z0-9_-]/gi, '')
      if (handle) {
        const member = await prisma.spaceToken.findFirst({
          where: { spaceId: info.space.id, revokedAt: null, name: `member:${handle}` }, select: { id: true },
        })
        owned = !!member
      }
    }
  }

  return NextResponse.json({
    premium: { usd: info.usd, demoSeconds: info.demoSeconds, coProgram: info.coProgram, live: true, experimental: true },
    owned,
    signedIn: !!user,
    buyable: stripeConfigured(),
  })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const slug = String(body?.slug ?? '').trim().toLowerCase()
  const info = slug ? await priceOf(slug) : null
  if (!info || !info.usd) return NextResponse.json({ error: 'not a paid experience' }, { status: 400 })
  if (user.id === info.space.ownerId) return NextResponse.json({ error: 'you already own this world' }, { status: 400 })

  const out = await createExperienceCheckout({
    slug, worldName: info.space.name, usd: info.usd, userId: user.id, origin: req.nextUrl.origin,
  })
  if ('error' in out) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json({ url: out.url })
}
