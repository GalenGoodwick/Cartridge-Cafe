import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/page-auth'
import { slugAvailable, reserveSlug, publishPage } from '@/lib/pages'
import { readEntitlements, stripeConfigured, createCheckoutSession, isProductConfigured } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

const PRODUCT = 'page'

/** GET /api/pages/:id/publish?slug=foo — is this address available for this page? */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const a = await requireOwner(id)
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status })
  const slug = (req.nextUrl.searchParams.get('slug') || '').toLowerCase().trim()
  const avail = await slugAvailable(slug, id)
  return NextResponse.json(avail)
}

/** POST /api/pages/:id/publish {slug} — go live. Order of resolution:
 *   1. re-publish of a slug this page already owns → free
 *   2. owner already paid for this slug (entitlement) → publish
 *   3. localhost dev → publish free (so it's testable without Stripe)
 *   4. Stripe configured for the `page` product → return a checkout URL
 *   5. otherwise → 501 (payments not switched on yet) */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const a = await requireOwner(id)
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status })

  const body = await req.json().catch(() => ({}))
  const slug = String(body?.slug ?? '').toLowerCase().trim()
  const avail = await slugAvailable(slug, id)
  if (!avail.ok) return NextResponse.json({ error: avail.reason }, { status: 400 })

  const url = `${req.nextUrl.origin}/p/${slug}`

  // 1. re-publishing the page's own current slug — no charge.
  if (a.doc.slug === slug && a.doc.published) {
    await publishPage(a.doc, slug)
    return NextResponse.json({ published: true, url })
  }

  // 2. already entitled for this slug (paid earlier, or webhook granted it).
  const ents = await readEntitlements(a.userId)
  const paid = ents.some((e) => e.active && e.product === PRODUCT && e.slug === slug)
  if (paid) {
    await publishPage(a.doc, slug)
    return NextResponse.json({ published: true, url })
  }

  // 3. localhost dev convenience — never in production.
  if (process.env.NODE_ENV !== 'production') {
    await publishPage(a.doc, slug)
    return NextResponse.json({ published: true, url, dev: true })
  }

  // 4. paid path — reserve the address (refused = just lost a race for it),
  //    then hand back a Stripe Checkout URL. The webhook verifies this page's
  //    id against the reservation and finalizes the instant payment completes.
  if (stripeConfigured() && isProductConfigured(PRODUCT)) {
    if (!(await reserveSlug(slug, id, a.userId))) {
      return NextResponse.json({ error: 'that address was just taken — pick another' }, { status: 409 })
    }
    const out = await createCheckoutSession(PRODUCT, a.userId, req.nextUrl.origin, slug, id)
    if ('error' in out) return NextResponse.json({ error: out.error }, { status: out.status })
    return NextResponse.json({ checkout: out.url })
  }

  // 5. rail not switched on.
  return NextResponse.json(
    { error: 'Publishing opens when payments are switched on.' },
    { status: 501 },
  )
}
