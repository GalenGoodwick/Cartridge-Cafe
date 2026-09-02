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
    amount_total?: number
    metadata?: { userId?: string; product?: string; slug?: string; pageId?: string; qty?: string }
  }
  const meta = obj.metadata ?? {}

  if (event.type === 'checkout.session.completed' && meta.userId && meta.product) {
    await grantEntitlement(meta.userId, { product: meta.product, sessionId: obj.id, slug: meta.slug })
    // worldgen buys a COUNTER, not a boolean — credit the generation ledger
    // (idempotent per sessionId; Stripe retries must not double-credit)
    if (meta.product === 'worldgen') {
      const { grantGenCredits } = await import('@/lib/stripe')
      const qty = Number(meta.qty)
      await grantGenCredits(meta.userId, obj.id, Number.isFinite(qty) && qty >= 1 ? qty : 1)
    }
    // THE MEMBERSHIP INCLUDES ONE BUILD CREDIT (Galen, Sep 1: "selecting
    // membership gives 1") — so a new member can build a world the moment they
    // join instead of paying again. Idempotent per checkout session: signup
    // grants exactly one; monthly renewals arrive as invoice/subscription events
    // (NOT checkout.session.completed), so they never re-grant.
    if (meta.product === 'editor') {
      const { grantGenCredits } = await import('@/lib/stripe')
      await grantGenCredits(meta.userId, obj.id, 1)
    }
    // a PAID EXPERIENCE grants a seat at the workbench — mint the buyer a
    // co-program membership in the world they bought (idempotent)
    if (meta.product === 'experience' && meta.slug) {
      const { grantCoProgramMembership } = await import('@/lib/stripe')
      try { await grantCoProgramMembership(meta.userId, meta.slug) }
      catch { return NextResponse.json({ error: 'membership mint failed, retry' }, { status: 500 }) }
    }
    // THE LEDGER (DESIGN-creator-ledger.md): every completed charge is BOOKED,
    // idempotently, the moment it happens — perfect bookkeeping starts at the
    // first dollar. Experiences split to the world's owner (authors join the
    // split when the engagement meter lands — rung 2); everything else is house
    // revenue. Booking failure = non-2xx so Stripe retries (idempotent refs
    // make the retry safe).
    if (obj.id && typeof obj.amount_total === 'number' && obj.amount_total > 0) {
      try {
        if (meta.product === 'experience' && meta.slug) {
          const { prisma } = await import('@/lib/prisma')
          const { bookAttributedCharge } = await import('@/lib/ledger')
          const space = await prisma.playerSpace.findUnique({ where: { slug: meta.slug }, select: { ownerId: true } })
          if (space) {
            await bookAttributedCharge({
              eventId: obj.id, slug: meta.slug, cents: obj.amount_total,
              ownerUserId: space.ownerId, authors: [],   // rung 2 wires engagement weights
              note: 'paid experience',
            })
          }
        } else {
          const { bookHouseCharge } = await import('@/lib/ledger')
          await bookHouseCharge(obj.id, obj.amount_total, meta.product || 'unattributed')
        }
      } catch {
        return NextResponse.json({ error: 'ledger booking failed, retry' }, { status: 500 })
      }
    }
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
