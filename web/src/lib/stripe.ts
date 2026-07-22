// STRIPE WIRING — key-drop-ready monetization, SDK-free.
//
// INERT until the keys exist: with no STRIPE_SECRET_KEY in the environment,
// checkout returns 501 and the product list is empty — nothing can be charged,
// nothing renders. Drop STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET (+ one
// STRIPE_PRICE_* per product) into Vercel and the same deploy starts selling.
//
// No stripe npm dependency on purpose: Checkout-session create is one
// form-encoded POST and webhook verification is one HMAC — a whole SDK is not
// worth the supply-chain surface for that.
//
// Products are env-mapped, never hardcoded: a product exists exactly when its
// STRIPE_PRICE_<KEY> env var holds a Stripe price id. Planned first wave
// (see memory/monetization notes): ads ($10/mo, system already built), protect
// (pay-to-protect a world), slots (pro world-slots tier).
import crypto from 'crypto'
import { loadGameSlot, saveGameSlot } from '@/app/api/engine/store'

const PRODUCTS: Record<string, { env: string; mode: 'subscription' | 'payment'; label: string }> = {
  ads: { env: 'STRIPE_PRICE_ADS', mode: 'subscription', label: 'contained ad slot ($/mo)' },
  protect: { env: 'STRIPE_PRICE_PROTECT', mode: 'payment', label: 'pay-to-protect a world' },
  slots: { env: 'STRIPE_PRICE_SLOTS', mode: 'subscription', label: 'pro world slots' },
}

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}

/** Products that are actually sellable right now (key + price id present). */
export function availableProducts(): Array<{ key: string; mode: string; label: string }> {
  if (!stripeConfigured()) return []
  return Object.entries(PRODUCTS)
    .filter(([, p]) => !!process.env[p.env])
    .map(([key, p]) => ({ key, mode: p.mode, label: p.label }))
}

/** Create a Stripe Checkout session for one product. Returns the redirect URL. */
export async function createCheckoutSession(
  productKey: string, userId: string, origin: string, slug?: string,
): Promise<{ url: string } | { error: string; status: number }> {
  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) return { error: 'payments not configured yet', status: 501 }
  const product = PRODUCTS[productKey]
  const price = product ? process.env[product.env] : undefined
  if (!product || !price) return { error: `unknown or unconfigured product "${productKey}"`, status: 400 }

  const form = new URLSearchParams({
    mode: product.mode,
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    success_url: origin + '/?paid=' + productKey,
    cancel_url: origin + '/?paycancel=' + productKey,
    'metadata[userId]': userId,
    'metadata[product]': productKey,
    ...(slug ? { 'metadata[slug]': slug } : {}),
    // subscriptions need the metadata on the subscription too, so renewals map back
    ...(product.mode === 'subscription'
      ? { 'subscription_data[metadata][userId]': userId, 'subscription_data[metadata][product]': productKey }
      : {}),
  })
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  const j = (await r.json()) as { url?: string; error?: { message?: string } }
  if (!r.ok || !j.url) return { error: j.error?.message || 'stripe refused the session', status: 502 }
  return { url: j.url }
}

/** Verify a Stripe webhook signature (v1 scheme, timing-safe, 5-min tolerance). */
export function verifyStripeSignature(payload: string, sigHeader: string | null): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret || !sigHeader) return false
  const parts = Object.fromEntries(
    sigHeader.split(',').map((kv) => kv.split('=') as [string, string]),
  ) as Record<string, string>
  const t = parts.t
  const v1 = parts.v1
  if (!t || !v1) return false
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false   // stale replay
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'))
  } catch {
    return false
  }
}

// ---- entitlements — what a player has paid for -----------------------------
// KV slot per user (the EngineSlot pattern: no migration, works on prod at
// first touch). Read by gating code and by the checkout GET for buy buttons.
export interface Entitlement {
  product: string
  at: number
  sessionId?: string
  slug?: string           // product scoped to one world (protect)
  active: boolean
}

const entSlot = (userId: string) => 'entitlements:' + userId

export async function readEntitlements(userId: string): Promise<Entitlement[]> {
  const doc = (await loadGameSlot(entSlot(userId))) as { ents?: Entitlement[] } | undefined
  return Array.isArray(doc?.ents) ? doc.ents : []
}

export async function grantEntitlement(userId: string, ent: Omit<Entitlement, 'at' | 'active'>): Promise<void> {
  const ents = await readEntitlements(userId)
  // one active grant per product+slug — a renewal refreshes, not duplicates
  const rest = ents.filter((e) => !(e.product === ent.product && e.slug === ent.slug))
  await saveGameSlot(entSlot(userId), { ents: [...rest, { ...ent, at: Date.now(), active: true }].slice(-50) })
}

export async function revokeEntitlement(userId: string, product: string, slug?: string): Promise<void> {
  const ents = await readEntitlements(userId)
  await saveGameSlot(entSlot(userId), {
    ents: ents.map((e) => (e.product === product && e.slug === slug ? { ...e, active: false } : e)),
  })
}
