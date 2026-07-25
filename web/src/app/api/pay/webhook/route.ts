import { NextRequest, NextResponse } from 'next/server'
import { verifyStripeSignature, grantEntitlement, revokeEntitlement } from '@/lib/stripe'
import { commonsBus } from '@/lib/commons-bus'

export const dynamic = 'force-dynamic'

/** POST /api/pay/webhook — Stripe's callback. Signature-verified (HMAC v1,
 *  timing-safe); unverifiable payloads are dropped with 400 and grant nothing.
 *  checkout.session.completed → grant; subscription deleted/refund → revoke. */
export async function POST(req: NextRequest) {
  const payload = await req.text()
  if (!verifyStripeSignature(payload, req.headers.get('stripe-signature'))) {
    return NextResponse.json({ error: 'bad signature' }, { status: 400 })
  }

  let event: { type?: string; data?: { object?: Record<string, unknown> } }
  try { event = JSON.parse(payload) } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const obj = (event.data?.object ?? {}) as {
    id?: string
    metadata?: { userId?: string; product?: string; slug?: string; pageId?: string }
  }
  const meta = obj.metadata ?? {}

  if (event.type === 'checkout.session.completed' && meta.userId && meta.product) {
    await grantEntitlement(meta.userId, { product: meta.product, sessionId: obj.id, slug: meta.slug })
    // A page purchase buys permanent hosting for one slug — take it live the
    // instant Stripe confirms, so the buyer's redirect lands on a live page.
    // finalizePagePublish verifies the reservation matches the PAID pageId
    // (two buyers can race one slug) and uses strict durable writes.
    if (meta.product === 'page' && meta.slug) {
      const { finalizePagePublish } = await import('@/lib/pages')
      try {
        const out = await finalizePagePublish(meta.slug, meta.pageId)
        if (out === 'conflict') {
          // someone else's PAID page already holds the slug — never clobber it;
          // flag loudly for manual care (refund/re-slug the loser).
          void commonsBus({ kind: 'system', who: 'cafe', text: `⚠ page purchase CONFLICT: slug "${meta.slug}" was published by another page before session ${obj.id} settled — buyer ${meta.userId} needs manual care` })
        }
      } catch {
        // durable write failed — non-2xx so Stripe retries the whole event
        // (grantEntitlement above is idempotent per product+slug).
        return NextResponse.json({ error: 'publish write failed, retry' }, { status: 500 })
      }
    }
    // the nervous system hears the till ring — platform news, no personal data
    void commonsBus({ kind: 'system', who: 'cafe', text: `✧ a "${meta.product}" purchase just completed — the cafe is earning` })
  } else if (
    (event.type === 'customer.subscription.deleted' || event.type === 'charge.refunded') &&
    meta.userId && meta.product
  ) {
    await revokeEntitlement(meta.userId, meta.product, meta.slug)
  }

  // 200 everything we understood or deliberately ignored — Stripe retries non-2xx
  return NextResponse.json({ received: true })
}
