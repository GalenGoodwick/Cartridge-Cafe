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
import { loadGameSlot, saveGameSlot, deleteGameSlot } from '@/app/api/engine/store'
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
  }
  const ids = (await listOwnerPageIds(doc.ownerId)).filter((x) => x !== doc.id)
  await saveGameSlot(ownerSlot(doc.ownerId), { ids })
}

// ─── Slug ownership + publishing ──────────────────────────────────────────────

export type SlugIndex = { pageId: string; ownerId: string; reservedAt?: number }

export async function slugIndex(slug: string): Promise<SlugIndex | null> {
  const d = (await loadGameSlot(slugSlot(slug))) as SlugIndex | undefined
  return d && typeof d === 'object' && d.pageId ? d : null
}

/** Is `slug` free for `pageId`? A slug already owned by the SAME page is "free"
 *  (a re-publish). Reserved-word / syntax failures are surfaced too. */
export async function slugAvailable(slug: string, pageId: string): Promise<{ ok: boolean; reason?: string }> {
  const v = validateSlug(slug)
  if (!v.ok) return { ok: false, reason: v.error }
  const idx = await slugIndex(slug.toLowerCase())
  if (idx && idx.pageId !== pageId) return { ok: false, reason: 'that address is taken' }
  return { ok: true }
}

/** Reserve a slug for a page (used the moment a paid checkout starts, so the
 *  address can't be sniped while the buyer is in Stripe). Idempotent per page. */
export async function reserveSlug(slug: string, pageId: string, ownerId: string): Promise<void> {
  await saveGameSlot(slugSlot(slug.toLowerCase()), { pageId, ownerId, reservedAt: Date.now() })
}

/** The public shape served at /p/<slug> — no owner/internal fields. */
export function publicView(doc: PageDoc): PublicPage {
  return { title: doc.title, blocks: doc.blocks, publishedAt: doc.publishedAt ?? Date.now(), slug: doc.slug ?? '' }
}

/** Copy a draft live: write the public snapshot, claim the slug, mark published.
 *  Returns the saved doc. Assumes authority/entitlement already checked. */
export async function publishPage(doc: PageDoc, slug: string): Promise<PageDoc> {
  const s = slug.toLowerCase()
  doc.slug = s
  doc.published = true
  doc.publishedAt = Date.now()
  await savePageDoc(doc)
  await saveGameSlot(slugSlot(s), { pageId: doc.id, ownerId: doc.ownerId })
  await saveGameSlot(pubSlot(s), publicView(doc))
  return doc
}

/** Called by the Stripe webhook for a completed `page` purchase: look up the
 *  reserved slug, load its draft, and go live. Best-effort, never throws. */
export async function finalizePagePublish(slug: string): Promise<boolean> {
  try {
    const idx = await slugIndex(slug.toLowerCase())
    if (!idx) return false
    const doc = await loadPageDoc(idx.pageId)
    if (!doc) return false
    await publishPage(doc, slug)
    return true
  } catch {
    return false
  }
}

export async function loadPublished(slug: string): Promise<PublicPage | null> {
  const p = (await loadGameSlot(pubSlot(slug.toLowerCase()))) as PublicPage | undefined
  return p && typeof p === 'object' && Array.isArray(p.blocks) ? p : null
}

// ─── Page-author tokens (connect-AI) ──────────────────────────────────────────
// Mirrors the SpaceToken pattern but self-contained in the slot store: the raw
// token is shown once, only its sha256 is stored, scoped to a single page.

export type PageTokenRec = { pageId: string; ownerId: string; name: string; at: number }

const hashTok = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex')

export async function mintPageToken(pageId: string, ownerId: string, name = 'connected AI'): Promise<string> {
  const raw = `uc_page_${crypto.randomBytes(20).toString('hex')}`
  await saveGameSlot(tokSlot(hashTok(raw)), { pageId, ownerId, name: name.slice(0, 60), at: Date.now() } as PageTokenRec)
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
