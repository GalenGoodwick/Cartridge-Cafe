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
  // one-time $10 to publish a cafe page to permanent hosting at /p/<slug>.
  // Scoped to the slug (Entitlement.slug) so a purchase buys exactly one address.
  page: { env: 'STRIPE_PRICE_PAGE', mode: 'payment', label: 'publish a page — permanent hosting ($10)' },
  // a plain optional tip — the price itself has custom_unit_amount enabled,
  // so the donor picks the amount on Stripe's own checkout page.
  donate: { env: 'STRIPE_PRICE_DONATE', mode: 'payment', label: 'donate to cartridge.cafe' },
  // IP CONTROL (Galen, Aug 27): the premium tier over the platform's
  // open-source-within-the-cafe deal — the holder's worlds are CLOSED SOURCE
  // (playable, never readable: the library refuses their code) + a custom
  // company page. Inert until STRIPE_PRICE_IP lands (the key-drop law).
  ip: { env: 'STRIPE_PRICE_IP', mode: 'subscription', label: 'IP control — closed-source worlds + company page' },
}
// PAID EXPERIENCES and WORLD GENERATION are NOT in this env-mapped table on
// purpose (Galen, Aug 24: "I need a product pricing mechanism"). Their prices
// are AD-HOC via Stripe price_data (server-side, never trusted from the client),
// so the only key needed is STRIPE_SECRET_KEY — no per-product price id to
// pre-create. Experiences read each world's own worldData.premium.usd;
// generation is a flat GEN_PRICE_USD. See createExperienceCheckout /
// createWorldgenCheckout below.

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}

/** Is a single product wired (its price id present)? */
export function isProductConfigured(key: string): boolean {
  const p = PRODUCTS[key]
  return !!p && !!process.env[p.env]
}

/** Products that are actually sellable right now (key + price id present). */
export function availableProducts(): Array<{ key: string; mode: string; label: string }> {
  if (!stripeConfigured()) return []
  return Object.entries(PRODUCTS)
    .filter(([, p]) => !!process.env[p.env])
    .map(([key, p]) => ({ key, mode: p.mode, label: p.label }))
}

/** Create a Stripe Checkout session for one product. Returns the redirect URL.
 *  `pageId` rides along in metadata for the `page` product so the webhook can
 *  verify the reservation it settles belongs to the page the buyer paid for. */
export async function createCheckoutSession(
  productKey: string, userId: string, origin: string, slug?: string, pageId?: string,
): Promise<{ url: string } | { error: string; status: number }> {
  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) return { error: 'payments not configured yet', status: 501 }
  const product = PRODUCTS[productKey]
  const price = product ? process.env[product.env] : undefined
  if (!product || !price) return { error: `unknown or unconfigured product "${productKey}"`, status: 400 }

  // A page purchase returns to the composer, which polls until the webhook has
  // flipped it live; other products land on the front door. (Paid EXPERIENCES
  // don't come through here — they use createExperienceCheckout, ad-hoc priced.)
  const success = productKey === 'page'
    ? `${origin}/pages?paid=page`
    : `${origin}/?paid=${productKey}`
  const cancel = productKey === 'page'
    ? `${origin}/pages?paycancel=page`
    : `${origin}/?paycancel=${productKey}`
  const form = new URLSearchParams({
    mode: product.mode,
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    success_url: success,
    cancel_url: cancel,
    'metadata[userId]': userId,
    'metadata[product]': productKey,
    ...(slug ? { 'metadata[slug]': slug } : {}),
    ...(pageId ? { 'metadata[pageId]': pageId } : {}),
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

/** PAID EXPERIENCE checkout — owner-set price, AD-HOC (no pre-created Stripe
 *  price id). `usd` is read SERVER-side from the world (never the client), so a
 *  buyer can't underpay. The buy returns INTO the world it bought; the gate
 *  there polls the entitlement + the freshly-minted co-program membership. */
export async function createExperienceCheckout(
  opts: { slug: string; worldName: string; usd: number; userId: string; origin: string },
): Promise<{ url: string } | { error: string; status: number }> {
  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) return { error: 'payments not configured yet', status: 501 }
  const cents = Math.round(opts.usd * 100)
  if (!Number.isFinite(cents) || cents < 100) return { error: 'a paid experience is at least $1', status: 400 }
  const back = `${opts.origin}/space/${encodeURIComponent(opts.slug)}`
  const form = new URLSearchParams({
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(cents),
    'line_items[0][price_data][product_data][name]': (opts.worldName || 'a cartridge.cafe experience').slice(0, 120),
    'line_items[0][price_data][product_data][description]': 'Buy once — this game is yours on your cartridge.cafe account.',
    success_url: `${back}?paid=experience`,
    cancel_url: `${back}?paycancel=experience`,
    'metadata[userId]': opts.userId,
    'metadata[product]': 'experience',
    'metadata[slug]': opts.slug,
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

/** WORLD GENERATION checkout — flat $5 (GEN_PRICE_USD), one generation, AD-HOC
 *  (no pre-created price id; only STRIPE_SECRET_KEY). The webhook credits the
 *  gencredits ledger; the buyer lands back on /cards to spend it on a brief. */
export async function createWorldgenCheckout(
  userId: string, origin: string, qty = 1,
): Promise<{ url: string } | { error: string; status: number }> {
  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) return { error: 'payments not configured yet', status: 501 }
  const n = Math.max(1, Math.min(20, Math.floor(qty)))
  // ONE line charged at the BUNDLE total (quantity 1) so the discount is real;
  // the credit COUNT rides metadata[qty], which the webhook grants from — the
  // Stripe line quantity is deliberately decoupled from the credits.
  const totalCents = worldgenPriceUsd(n) * 100
  const form = new URLSearchParams({
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(totalCents),
    'line_items[0][price_data][product_data][name]': n === 1 ? 'generate a world' : `${n} world builds`,
    'line_items[0][price_data][product_data][description]': 'world build credits — each births a world from your brief (forking a world spends one too); credits never expire',
    success_url: `${origin}/create?paid=worldgen`,   // the generate flow lives at /create now
    cancel_url: `${origin}/create?paycancel=worldgen`,
    'metadata[userId]': userId,
    'metadata[product]': 'worldgen',
    'metadata[qty]': String(n),
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

/** Purchase grants a SEAT AT THE WORKBENCH (Galen, Aug 24: "purchase gives you
 *  access to co-program the world"): mint the buyer a member:<handle> build key
 *  for the world — the same key the co-build dock honors. Idempotent: one live
 *  member row per handle, so buying twice never duplicates. */
export async function grantCoProgramMembership(userId: string, slug: string): Promise<void> {
  const { prisma } = await import('@/lib/prisma')
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
  const email = user?.email
  if (!email) return
  const handle = email.split('@')[0].replace(/[^a-z0-9_-]/gi, '') || 'member'
  const space = await prisma.playerSpace.findUnique({ where: { slug }, select: { id: true } })
  if (!space) return
  const existing = await prisma.spaceToken.findFirst({
    where: { spaceId: space.id, revokedAt: null, name: `member:${handle}` }, select: { id: true },
  })
  if (existing) return
  const raw = `uc_st_${crypto.randomBytes(16).toString('hex')}`
  await prisma.spaceToken.create({
    data: {
      name: `member:${handle}`,
      tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
      tokenPrefix: raw.slice(0, 12) + '...',
      spaceId: space.id,
    },
  })
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
  until?: number          // timed grant (promo codes) — absent = lasts until revoked
  active: boolean
}

/** Is a grant good RIGHT NOW — active and, if timed, unexpired. */
export function entitlementLive(e: Entitlement): boolean {
  return e.active && (!e.until || e.until > Date.now())
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

// ---- EDITING MEMBERSHIP — ONE simple tier (Galen, Aug 26: "remove dockstar
// code and limit. just easy $10 to build on open building worlds. remove
// premium"). Playing/testing is always free; the $10/mo membership is the seat
// to BUILD on open building worlds. No dockstars, no quotas, no premium tier.
// The pay webhook revokes the moment Stripe reports the subscription deleted.
// Lapse costs the build seat ONLY — your worlds and node lineage stay forever.
export const EDITOR_PRICE_USD = 10        // the ONE membership

/** IP CONTROL (the premium tier): the holder's worlds are closed source —
 *  the platform's open-source-within-the-cafe deal does not apply to them.
 *  Read by the library before serving any world's code. */
export async function hasIpControl(userId: string): Promise<boolean> {
  const ents = await readEntitlements(userId)
  return ents.some((e) => e.active && e.product === 'ip')
}

/** Does this account hold the editing membership? The build gate.
 *  ADMINS are members by virtue of being admin (Galen: free demos; no payment,
 *  no DB row to get wiped — the keeper of the cafe always has the seat; the
 *  chair authored this rule on branchfork, Aug 25). Legacy editor_pro
 *  subscribers stay members — never strand a payer. */
export async function hasEditingMembership(userId: string): Promise<boolean> {
  const { isAdminUserId } = await import('@/lib/adminAuth')
  if (await isAdminUserId(userId)) return true
  const ents = await readEntitlements(userId)
  return ents.some((e) => entitlementLive(e) && (e.product === 'editor' || e.product === 'editor_pro'))
}

/** When a TIMED membership (promo grant) runs out, or null if the seat is
 *  untimed (paid subscription / granted). For the account page's date line. */
export async function membershipUntil(userId: string): Promise<number | null> {
  const ents = await readEntitlements(userId)
  const e = ents.find((e) => entitlementLive(e) && (e.product === 'editor' || e.product === 'editor_pro'))
  return e?.until ?? null
}

/** Start the monthly editing-membership subscription — AD-HOC recurring price
 *  (no pre-created Stripe price; only STRIPE_SECRET_KEY). One tier, $10/mo. */
export async function createEditorCheckout(
  userId: string, origin: string,
): Promise<{ url: string } | { error: string; status: number }> {
  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) return { error: 'payments not configured yet', status: 501 }
  const product = 'editor'
  const form = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(EDITOR_PRICE_USD * 100),
    'line_items[0][price_data][recurring][interval]': 'month',
    'line_items[0][price_data][product_data][name]': 'editing membership — build on open building worlds',
    success_url: `${origin}/cards?paid=editor`,
    cancel_url: `${origin}/cards?paycancel=editor`,
    'metadata[userId]': userId,
    'metadata[product]': product,
    // renewals + cancellation carry the metadata on the subscription too, so the
    // webhook maps a future subscription.deleted back to this account/product
    'subscription_data[metadata][userId]': userId,
    'subscription_data[metadata][product]': product,
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

// ---- subscription management (the ACCOUNT page's legal surface) -------------
// SDK-free like everything above. The billing portal is the sanctioned
// cancel/update/invoices surface (click-to-cancel compliant — Stripe hosts it);
// we resolve the customer by searching subscriptions on our own metadata.

export interface ActiveSub { id: string; customer: string; product: string; currentPeriodEnd: number; cancelAtPeriodEnd: boolean }

/** Every ACTIVE subscription carrying our metadata[userId]. */
export async function findActiveSubscriptions(userId: string): Promise<ActiveSub[]> {
  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) return []
  const q = encodeURIComponent(`metadata['userId']:'${userId}' AND status:'active'`)
  const r = await fetch(`https://api.stripe.com/v1/subscriptions/search?query=${q}&limit=20`, {
    headers: { Authorization: 'Bearer ' + secret },
  })
  if (!r.ok) return []
  const j = (await r.json()) as { data?: Array<{ id: string; customer: string; metadata?: Record<string, string>; current_period_end?: number; cancel_at_period_end?: boolean }> }
  return (j.data ?? []).map((s) => ({
    id: s.id, customer: s.customer,
    product: s.metadata?.product || 'unknown',
    currentPeriodEnd: (s.current_period_end || 0) * 1000,
    cancelAtPeriodEnd: !!s.cancel_at_period_end,
  }))
}

/** Open the Stripe BILLING PORTAL for a customer — invoices, payment method,
 *  and cancellation live there (the legally clean self-serve surface). */
export async function createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string } | { error: string; status: number }> {
  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) return { error: 'payments not configured yet', status: 501 }
  const r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ customer: customerId, return_url: returnUrl }).toString(),
  })
  const j = (await r.json()) as { url?: string; error?: { message?: string } }
  if (!r.ok || !j.url) return { error: j.error?.message || 'stripe refused the portal session', status: 502 }
  return { url: j.url }
}

/** Cancel at PERIOD END (the /account CANCEL button): billing stops, the
 *  paid-for seat runs out its month — cancel as easy as signup, nothing
 *  taken away that was paid for. */
export async function cancelSubscriptionAtPeriodEnd(subId: string): Promise<boolean> {
  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) return false
  const r = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subId)}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ cancel_at_period_end: 'true' }).toString(),
  })
  return r.ok
}

/** Cancel a subscription IMMEDIATELY (account deletion path — a deleted
 *  account must never be billed again; the webhook then revokes the seat). */
export async function cancelSubscriptionNow(subId: string): Promise<boolean> {
  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) return false
  const r = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subId)}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + secret },
  })
  return r.ok
}

export async function revokeEntitlement(userId: string, product: string, slug?: string): Promise<void> {
  const ents = await readEntitlements(userId)
  await saveGameSlot(entSlot(userId), {
    ents: ents.map((e) => (e.product === product && e.slug === slug ? { ...e, active: false } : e)),
  })
}

// ---- generation credits — the worldgen counter ------------------------------
// Entitlements are booleans (own it or don't); worldgen is a COUNTER (a purchase
// buys N briefs, each generation spends one). Separate slot, sessionId-deduped
// grants because Stripe retries webhooks and a retry must not double-credit.
// Galen (Aug 24): "generate a world costs $5" — one purchase = one generation.
export const GEN_PRICE_USD = 5
export const GEN_CREDITS_PER_PURCHASE = 1

// BUNDLE DISCOUNT (Galen, Aug 30): buy more, pay less per credit. This table
// is THE one truth — the checkout amount and every buy button read it, so a
// price only ever lives in one place. Anything not listed falls back to the
// linear $5/credit rate (rounded up), so odd quantities still charge fairly.
//   1 → $5    ($5.00/ea)
//   3 → $12   ($4.00/ea · save $3)
//   5 → $18   ($3.60/ea · save $7)
//  10 → $30   ($3.00/ea · save $20)
export const GEN_BUNDLES: Record<number, number> = { 1: 5, 3: 12, 5: 18, 10: 30 }

/** Total price in whole USD for `qty` build credits (bundle rate if listed). */
export function worldgenPriceUsd(qty: number): number {
  const n = Math.max(1, Math.min(20, Math.floor(qty)))
  return GEN_BUNDLES[n] ?? n * GEN_PRICE_USD
}

const genSlot = (userId: string) => 'gencredits:' + userId

export async function readGenCredits(userId: string): Promise<number> {
  const doc = (await loadGameSlot(genSlot(userId))) as { n?: number } | undefined
  return typeof doc?.n === 'number' && doc.n > 0 ? Math.floor(doc.n) : 0
}

/** Webhook-side: +qty credits, idempotent per checkout sessionId. */
export async function grantGenCredits(userId: string, sessionId: string | undefined, qty = GEN_CREDITS_PER_PURCHASE): Promise<number> {
  const doc = ((await loadGameSlot(genSlot(userId))) ?? {}) as { n?: number; grants?: string[] }
  const grants = Array.isArray(doc.grants) ? doc.grants : []
  const n = typeof doc.n === 'number' && doc.n > 0 ? Math.floor(doc.n) : 0
  if (sessionId && grants.includes(sessionId)) return n   // webhook retry — already granted
  const next = n + Math.max(1, Math.min(20, Math.floor(qty)))
  await saveGameSlot(genSlot(userId), { n: next, grants: [...grants, ...(sessionId ? [sessionId] : [])].slice(-50) })
  return next
}

/** Grant N credits under an idempotency id (promo redemptions, comps). The
 *  credits are ordinary build credits — they never expire. */
export async function addGenCredits(userId: string, n: number, grantId: string): Promise<number> {
  const doc = ((await loadGameSlot(genSlot(userId))) ?? {}) as { n?: number; grants?: string[] }
  const grants = Array.isArray(doc.grants) ? doc.grants : []
  const cur = typeof doc.n === 'number' && doc.n > 0 ? Math.floor(doc.n) : 0
  if (grants.includes(grantId)) return cur
  const next = cur + Math.max(0, Math.floor(n))
  await saveGameSlot(genSlot(userId), { n: next, grants: [...grants, grantId].slice(-50) })
  return next
}

/** Generate-side: put ONE credit back (world creation failed after the spend). */
export async function refundGenCredit(userId: string): Promise<void> {
  const doc = ((await loadGameSlot(genSlot(userId))) ?? {}) as { n?: number; grants?: string[] }
  const n = typeof doc.n === 'number' && doc.n > 0 ? Math.floor(doc.n) : 0
  await saveGameSlot(genSlot(userId), { ...doc, n: n + 1 })
}

/** Generate-side: spend one credit. Returns the remaining count, or null if broke. */
export async function spendGenCredit(userId: string): Promise<number | null> {
  const doc = ((await loadGameSlot(genSlot(userId))) ?? {}) as { n?: number; grants?: string[] }
  const n = typeof doc.n === 'number' && doc.n > 0 ? Math.floor(doc.n) : 0
  if (n < 1) return null
  await saveGameSlot(genSlot(userId), { ...doc, n: n - 1 })
  return n - 1
}
