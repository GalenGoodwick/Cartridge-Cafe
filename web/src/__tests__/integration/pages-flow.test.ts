// End-to-end of the pages durable layer against the dev database (cool-pond).
// Exercises the real slot store — create → edit → token mint/verify → publish →
// load-published → delete — the same calls the API routes make.
//
// Needs DATABASE_URL (run via `npm run test:integration` with .env.local loaded).
import { describe, it, expect, afterAll } from 'vitest'
import {
  createPage, loadPageDoc, savePageDoc, deletePage,
  mintPageToken, verifyPageToken, revokePageToken,
  slugAvailable, publishPage, loadPublished, finalizePagePublish, reserveSlug,
  sanitizeBlocks, type PageDoc,
} from '@/lib/pages'

const OWNER = 'test-user-pages-flow'
const SLUG = 'itest-pages-flow-' + Math.floor(Math.random() * 1e6)

let doc: PageDoc

describe.sequential('pages flow (dev DB)', () => {
  afterAll(async () => {
    if (doc) await deletePage(doc).catch(() => {})
  })

  it('creates a page with sanitized blocks', async () => {
    doc = await createPage(OWNER, {
      title: 'Integration Test Page',
      // ids omitted on purpose — sanitizeBlocks mints them (the API route feeds
      // raw client JSON through the same path), hence the cast
      blocks: [
        { kind: 'heading', text: 'Hello', level: 1 },
        { kind: 'text', text: 'Body copy.' },
        { kind: 'link', text: 'bad', href: 'javascript:alert(1)' },
        { kind: 'shader', wgsl: 'fn fieldEffect(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f { return vec4f(0.5); }' },
      ] as unknown as PageDoc['blocks'],
    })
    expect(doc.id).toMatch(/^pg_/)
    expect(doc.blocks.length).toBe(4)
    const link = doc.blocks.find((b) => b.kind === 'link')
    expect(link && 'href' in link && link.href).toBe('#')   // scheme neutralized
  })

  it('round-trips a save', async () => {
    doc.blocks = sanitizeBlocks([...doc.blocks, { kind: 'text', text: 'appended' }])
    await savePageDoc(doc)
    const back = await loadPageDoc(doc.id)
    expect(back?.blocks.length).toBe(5)
  })

  it('mints and verifies a page token; wrong token fails', async () => {
    const raw = await mintPageToken(doc.id, OWNER, 'itest AI')
    expect(raw.startsWith('uc_page_')).toBe(true)
    const rec = await verifyPageToken(raw)
    expect(rec?.pageId).toBe(doc.id)
    expect(await verifyPageToken('uc_page_' + '0'.repeat(40))).toBeNull()
    await revokePageToken(raw)
    expect(await verifyPageToken(raw)).toBeNull()
  })

  it('slug availability + publish + public load', async () => {
    expect((await slugAvailable(SLUG, doc.id)).ok).toBe(true)
    await publishPage(doc, SLUG)
    // taken for another page now
    expect((await slugAvailable(SLUG, 'pg_other')).ok).toBe(false)
    // still "available" (re-publish) for the same page
    expect((await slugAvailable(SLUG, doc.id)).ok).toBe(true)
    const pub = await loadPublished(SLUG)
    expect(pub?.title).toBe('Integration Test Page')
    expect(pub?.blocks.length).toBe(5)
  })

  it('finalizePagePublish (webhook path) republishes from a reservation', async () => {
    doc.title = 'After Purchase'
    await savePageDoc(doc)
    expect(await reserveSlug(SLUG, doc.id, OWNER)).toBe(true)
    expect(await finalizePagePublish(SLUG, doc.id)).toBe('published')
    const pub = await loadPublished(SLUG)
    expect(pub?.title).toBe('After Purchase')
  })

  it('reservation for a LIVE slug is refused for another page; paid conflict refuses to clobber', async () => {
    // SLUG is published by doc now (permanent claim, no reservedAt)
    expect(await reserveSlug(SLUG, 'pg_intruder', 'someone-else')).toBe(false)
    // a phantom payment for another page against this live slug → conflict, page untouched
    expect(await finalizePagePublish(SLUG, 'pg_intruder')).toBe('conflict')
    const pub = await loadPublished(SLUG)
    expect(pub?.title).toBe('After Purchase')
  })

  it('finalize verifies the PAID pageId even when a later reservation overwrote the index', async () => {
    // fresh unpublished slug reserved by the buyer's page
    const raceSlug = SLUG + '-race'
    expect(await reserveSlug(raceSlug, doc.id, OWNER)).toBe(true)
    // buyer's webhook lands with their pageId → publishes THEIR page
    expect(await finalizePagePublish(raceSlug, doc.id)).toBe('published')
    const pub = await loadPublished(raceSlug)
    expect(pub?.title).toBe('After Purchase')
    // cleanup the extra slug
    const { deleteGameSlot } = await import('@/app/api/engine/store')
    await deleteGameSlot('page:pub:' + raceSlug)
    await deleteGameSlot('page:slug:' + raceSlug)
    // restore doc's canonical slug for the delete test
    doc.slug = SLUG
    await savePageDoc(doc)
  })

  it('delete removes draft, published copy, and slug', async () => {
    const id = doc.id
    await deletePage(doc)
    expect(await loadPageDoc(id)).toBeNull()
    expect(await loadPublished(SLUG)).toBeNull()
    expect((await slugAvailable(SLUG, 'pg_other')).ok).toBe(true)
    doc = undefined as unknown as PageDoc   // afterAll: nothing to clean
  })
})
