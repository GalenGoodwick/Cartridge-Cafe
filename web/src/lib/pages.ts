// CAFE PAGES — server library: durable CRUD, publishing, and page-author tokens
// for the AI-authored, sellable website builder.
//
// A "page" is a document (blocks of shader frames + content) stored in the
// Neon-backed slot store (same substrate as game saves — no Prisma migration).
// It has two lives:
//   - a private DRAFT the owner and a connected AI edit    (slot `page:doc:<id>`)
//   - a PUBLISHED snapshot served forever at /p/<slug>      (slot `page:pub:<slug>`)
//
// Publishing is the paywall: $10 one-time (Stripe product `page`, scoped to the
// slug) flips a draft live permanently. See `@/lib/stripe` + the pay webhook.
//
// The pure model (types, caps, validateSlug/sanitizeBlock/screenWgslHazard) lives
// in `@/lib/page-types` so it stays importable from client components.
import crypto from 'crypto'
import { loadGameSlot, saveGameSlot, saveGameSlotStrict, deleteGameSlot, invalidateSlotCache } from '@/app/api/engine/store'
import {
  type PageDoc, type PublicPage, MAX_TITLE, sanitizeBlocks, validateSlug,
} from '@/lib/page-types'

export * from '@/lib/page-types'

const clampTitle = (s: unknown) => String(s ?? '').slice(0, MAX_TITLE)

// ─── IDs ─────────────────────────────────────────────────────────────────────

let idCounter = 0
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}${(idCounter++).toString(36)}`
}

// ─── Slot keys ────────────────────────────────────────────────────────────────

const docSlot = (id: string) => `page:doc:${id}`
const pubSlot = (slug: string) => `page:pub:${slug}`
const slugSlot = (slug: string) => `page:slug:${slug}`
const ownerSlot = (userId: string) => `pages:owner:${userId}`
const tokSlot = (hash: string) => `page:tok:${hash}`
const INDEX_SLOT = 'pages:index'   // one row: every published page, for the hub + sitemap

// ─── Document CRUD ────────────────────────────────────────────────────────────

export function newPageDoc(ownerId: string, seed?: Partial<PageDoc>): PageDoc {
  const now = Date.now()
  return {
    id: newId('pg'),
    ownerId,
    title: clampTitle(seed?.title ?? 'Untitled page') || 'Untitled page',
    slug: null,
    blocks: sanitizeBlocks(seed?.blocks ?? []),
    published: false,
    createdAt: now,
    updatedAt: now,
  }
}

export async function loadPageDoc(id: string): Promise<PageDoc | null> {
  const doc = (await loadGameSlot(docSlot(id))) as PageDoc | undefined
  return doc && typeof doc === 'object' && doc.id === id ? doc : null
}

export async function savePageDoc(doc: PageDoc): Promise<void> {
  doc.updatedAt = Date.now()
  await saveGameSlot(docSlot(doc.id), doc)
}

/** Ids of a user's pages (newest last). */
export async function listOwnerPageIds(userId: string): Promise<string[]> {
  const d = (await loadGameSlot(ownerSlot(userId))) as { ids?: string[] } | undefined
  return Array.isArray(d?.ids) ? d.ids : []
}

async function addOwnerPage(userId: string, id: string): Promise<void> {
  const ids = await listOwnerPageIds(userId)
  if (!ids.includes(id)) await saveGameSlot(ownerSlot(userId), { ids: [...ids, id].slice(-100) })
}

export async function createPage(ownerId: string, seed?: Partial<PageDoc>): Promise<PageDoc> {
  const doc = newPageDoc(ownerId, seed)
  await savePageDoc(doc)
  await addOwnerPage(ownerId, doc.id)
  return doc
}

export async function deletePage(doc: PageDoc): Promise<void> {
  await deleteGameSlot(docSlot(doc.id))
  if (doc.slug) {
    await deleteGameSlot(pubSlot(doc.slug))
    await deleteGameSlot(slugSlot(doc.slug))
    await unindexPublishedPage(doc.slug)
  }
  const ids = (await listOwnerPageIds(doc.ownerId)).filter((x) => x !== doc.id)
  await saveGameSlot(ownerSlot(doc.ownerId), { ids })
}

// ─── Slug ownership + publishing ──────────────────────────────────────────────

export type SlugIndex = { pageId: string; ownerId: string; reservedAt?: number }

/** A checkout-time reservation holds the slug this long. Stripe Checkout links
 *  live for 24h, but a squatter can start checkouts for free — so an UNPAID
 *  reservation must lapse. A buyer who pays after the TTL is still safe: the
 *  webhook re-verifies against its own pageId, and if the slug went to someone
 *  else in the meantime the payment is flagged instead of clobbering. */
export const RESERVE_TTL_MS = 30 * 60 * 1000

export async function slugIndex(slug: string): Promise<SlugIndex | null> {
  const d = (await loadGameSlot(slugSlot(slug))) as SlugIndex | undefined
  return d && typeof d === 'object' && d.pageId ? d : null
}

/** Does this index entry currently block another page from the slug?
 *  A permanent claim (no reservedAt — written by publishPage) always does.
 *  An unpaid reservation only within its TTL. */
function indexHolds(idx: SlugIndex): boolean {
  if (!idx.reservedAt) return true
  return Date.now() - idx.reservedAt < RESERVE_TTL_MS
}

/** Is `slug` free for `pageId`? A slug already owned by the SAME page is "free"
 *  (a re-publish); an EXPIRED unpaid reservation is free for anyone. */
export async function slugAvailable(slug: string, pageId: string): Promise<{ ok: boolean; reason?: string }> {
  const v = validateSlug(slug)
  if (!v.ok) return { ok: false, reason: v.error }
  const idx = await slugIndex(slug.toLowerCase())
  if (idx && idx.pageId !== pageId && indexHolds(idx)) return { ok: false, reason: 'that address is taken' }
  return { ok: true }
}

/** Reserve a slug for a page at checkout start, so the address can't be sniped
 *  while the buyer is in Stripe. Re-checks the index at write time (narrowing
 *  the check-then-write race to milliseconds) and refuses to overwrite a live
 *  claim; the webhook's pageId verification is the real settlement — see
 *  finalizePagePublish. Durable (strict write): a reservation that existed only
 *  in one lambda's cache couldn't be honored. Returns false if the slug is
 *  held by someone else. */
export async function reserveSlug(slug: string, pageId: string, ownerId: string): Promise<boolean> {
  const s = slug.toLowerCase()
  const idx = await slugIndex(s)
  if (idx && idx.pageId !== pageId && indexHolds(idx)) return false
  try {
    await saveGameSlotStrict(slugSlot(s), { pageId, ownerId, reservedAt: Date.now() })
    return true
  } catch {
    return false
  }
}

/** The public shape served at /p/<slug> — no owner/internal fields. */
export function publicView(doc: PageDoc): PublicPage {
  return { title: doc.title, blocks: doc.blocks, publishedAt: doc.publishedAt ?? Date.now(), slug: doc.slug ?? '' }
}

/** Copy a draft live: write the public snapshot, claim the slug permanently,
 *  mark published. STRICT writes — this is what the $10 buys; a publish that
 *  exists only in one lambda's cache is data loss, so a DB failure THROWS and
 *  the caller must surface it (the webhook 500s so Stripe retries).
 *  Assumes authority/entitlement already checked. */
export async function publishPage(doc: PageDoc, slug: string): Promise<PageDoc> {
  const s = slug.toLowerCase()
  doc.slug = s
  doc.published = true
  doc.publishedAt = Date.now()
  doc.updatedAt = Date.now()
  // permanent claim first (no reservedAt = never expires), then the content
  await saveGameSlotStrict(slugSlot(s), { pageId: doc.id, ownerId: doc.ownerId })
  await saveGameSlotStrict(pubSlot(s), publicView(doc))
  await saveGameSlotStrict(docSlot(doc.id), doc)
  await indexPublishedPage(doc)   // onto the hub shelf + sitemap (best-effort)
  return doc
}

/** Refresh the live snapshot after an already-published page's draft changed.
 *  The ONLY other writer of `page:pub:` — routes call this instead of
 *  hand-building slot keys. */
export async function syncPublishedSnapshot(doc: PageDoc): Promise<void> {
  if (!doc.published || !doc.slug) return
  await saveGameSlot(pubSlot(doc.slug), publicView(doc))
  await indexPublishedPage(doc)   // title/desc on the shelf follow the edit
}

/** Called by the Stripe webhook for a completed `page` purchase. Verifies the
 *  reservation still belongs to the page the buyer paid for — two buyers can
 *  race checkouts for one slug, and the LAST reservation write wins the index,
 *  so without this check A's money could publish B's page. Resolution:
 *   - index matches the paid pageId → publish (normal case)
 *   - index mismatch, slug NOT yet published → the PAYER wins: re-claim + publish
 *   - index mismatch, slug already published by another page → refuse (returns
 *     'conflict' so the webhook can flag it for manual care — never clobber a
 *     live paid page)
 *  Throws on DB failure so the webhook can 500 and Stripe retries. */
export async function finalizePagePublish(
  slug: string, paidPageId?: string,
): Promise<'published' | 'conflict' | 'missing'> {
  const s = slug.toLowerCase()
  const idx = await slugIndex(s)
  const pageId = paidPageId || idx?.pageId
  if (!pageId) return 'missing'
  if (idx && idx.pageId !== pageId) {
    const alreadyLive = await loadPublished(s)
    if (alreadyLive) return 'conflict'
  }
  const doc = await loadPageDoc(pageId)
  if (!doc) return 'missing'
  await publishPage(doc, s)
  return 'published'
}

export async function loadPublished(slug: string): Promise<PublicPage | null> {
  const p = (await loadGameSlot(pubSlot(slug.toLowerCase()))) as PublicPage | undefined
  return p && typeof p === 'object' && Array.isArray(p.blocks) ? p : null
}

// ─── The published-pages index — the hub's shelf and the sitemap's source ────
// One slot row holds every published page's card data. Small on purpose: no
// block content here (the hub loads hero shaders per shown card), just what a
// listing needs. Views are bumped ATOMICALLY in SQL — a read-modify-write from
// N lambdas would eat counts.

export type PageIndexEntry = { title: string; publishedAt: number; views?: number; desc?: string }
export type PagesIndex = { pages: Record<string, PageIndexEntry> }

export async function listPublishedPages(): Promise<Array<{ slug: string } & PageIndexEntry>> {
  const idx = (await loadGameSlot(INDEX_SLOT)) as PagesIndex | undefined
  const pages = idx?.pages && typeof idx.pages === 'object' ? idx.pages : {}
  return Object.entries(pages).map(([slug, e]) => ({ slug, ...e }))
}

/** First indexable line of a page — for the hub card + meta description. */
function pageDesc(doc: PageDoc): string {
  const t = doc.blocks.find((b) => (b.kind === 'text' || b.kind === 'heading') && b.text)
  return (t && 'text' in t ? t.text : '').slice(0, 160)
}

async function indexPublishedPage(doc: PageDoc): Promise<void> {
  if (!doc.slug) return
  const idx = ((await loadGameSlot(INDEX_SLOT)) as PagesIndex | undefined) ?? { pages: {} }
  if (!idx.pages || typeof idx.pages !== 'object') idx.pages = {}
  const prev = idx.pages[doc.slug]
  idx.pages[doc.slug] = {
    title: doc.title,
    publishedAt: prev?.publishedAt ?? doc.publishedAt ?? Date.now(),
    views: prev?.views ?? 0,     // a re-publish keeps its audience count
    desc: pageDesc(doc),
  }
  await saveGameSlot(INDEX_SLOT, idx)
}

export async function unindexPublishedPage(slug: string): Promise<void> {
  const idx = (await loadGameSlot(INDEX_SLOT)) as PagesIndex | undefined
  if (!idx?.pages?.[slug]) return
  delete idx.pages[slug]
  await saveGameSlot(INDEX_SLOT, idx)
}

/** Count a visit. Atomic jsonb increment in Postgres — concurrent lambdas
 *  can't lose each other's counts. Fire-and-forget; never throws. */
export async function bumpPageViews(slug: string): Promise<void> {
  try {
    const s = slug.toLowerCase()
    if (!SAFE_SLUG_FOR_PATH.test(s)) return
    const { prisma } = await import('@/lib/prisma')
    await prisma.$executeRaw`
      UPDATE "EngineSlot"
      SET data = jsonb_set(data, ARRAY['pages', ${s}, 'views'],
        to_jsonb(COALESCE((data->'pages'->${s}->>'views')::int, 0) + 1), true)
      WHERE slot = ${INDEX_SLOT} AND data->'pages' ? ${s}`
    // the SQL mutated the row behind the slot cache — drop the stale copy
    invalidateSlotCache(INDEX_SLOT)
  } catch { /* a lost view count must never break a page render */ }
}
const SAFE_SLUG_FOR_PATH = /^[a-z0-9][a-z0-9-]{1,48}$/

// ─── Page-author tokens (connect-AI) ──────────────────────────────────────────
// Mirrors the SpaceToken pattern but self-contained in the slot store: the raw
// token is shown once, only its sha256 is stored, scoped to a single page.

export type PageTokenRec = { pageId: string; ownerId: string; name: string; at: number }

const hashTok = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex')

export async function mintPageToken(pageId: string, ownerId: string, name = 'connected AI'): Promise<string> {
  const raw = `uc_page_${crypto.randomBytes(20).toString('hex')}`
  // STRICT: a token whose hash never reached the DB would 403 on every other
  // lambda — the owner pasted it into their AI and it "randomly" doesn't work.
  await saveGameSlotStrict(tokSlot(hashTok(raw)), { pageId, ownerId, name: name.slice(0, 60), at: Date.now() } as PageTokenRec)
  return raw
}

/** Resolve a raw `uc_page_…` bearer token to its record, or null. */
export async function verifyPageToken(raw: string | null | undefined): Promise<PageTokenRec | null> {
  if (!raw || typeof raw !== 'string' || !raw.startsWith('uc_page_')) return null
  const rec = (await loadGameSlot(tokSlot(hashTok(raw)))) as PageTokenRec | undefined
  return rec && rec.pageId ? rec : null
}

export async function revokePageToken(raw: string): Promise<void> {
  await deleteGameSlot(tokSlot(hashTok(raw)))
}
