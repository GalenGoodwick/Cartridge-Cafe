import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/page-auth'
import { slugAvailable, reserveSlug, claimPage, renamePage } from '@/lib/pages'
import {
  readEntitlements, grantEntitlement, revokeEntitlement,
  stripeConfigured, createCheckoutSession, isProductConfigured,
} from '@/lib/stripe'

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

/** POST /api/pages/:id/publish {slug} — CLAIM the page's permanent address.
 *  The page is already live at its auto address; the $10 buys the chosen name,
 *  the permanence promise, and the hub/sitemap listing. Order of resolution:
 *   1. already claimed → free RENAME (the entitlement moves with the page)
 *   2. owner already paid for this slug (entitlement) → claim
 *   3. localhost dev → claim free (testable without Stripe)
 *   4. Stripe configured → reserve slug + return a Checkout URL
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

  // 1. already claimed — renaming is free, the paid entitlement moves along.
  if (a.doc.claimed) {
    const oldSlug = a.doc.slug
    if (oldSlug === slug) return NextResponse.json({ claimed: true, url })
    await renamePage(a.doc, slug)
    if (oldSlug) {
      const ents = await readEntitlements(a.userId)
      if (ents.some((e) => e.active && e.product === PRODUCT && e.slug === oldSlug)) {
        await revokeEntitlement(a.userId, PRODUCT, oldSlug)
        await grantEntitlement(a.userId, { product: PRODUCT, slug })
      }
    }
    return NextResponse.json({ claimed: true, url })
  }

  // 2. already entitled for this slug (paid earlier; webhook may have missed).
  const ents = await readEntitlements(a.userId)
  if (ents.some((e) => e.active && e.product === PRODUCT && e.slug === slug)) {
    await claimPage(a.doc, slug)
    return NextResponse.json({ claimed: true, url })
  }

  // 3. localhost dev convenience — never in production.
  if (process.env.NODE_ENV !== 'production') {
    await claimPage(a.doc, slug)
    return NextResponse.json({ claimed: true, url, dev: true })
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
    { error: 'Claiming opens when payments are switched on — your page stays live at its current address.' },
    { status: 501 },
  )
}
