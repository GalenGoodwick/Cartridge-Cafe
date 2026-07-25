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
      blocks: [
        { kind: 'heading', text: 'Hello', level: 1 },
        { kind: 'text', text: 'Body copy.' },
        { kind: 'link', text: 'bad', href: 'javascript:alert(1)' },
        { kind: 'shader', wgsl: 'fn fieldEffect(cellPos: vec2f, regionMin: vec2f, regionMax: vec2f, time: f32, params: vec4f) -> vec4f { return vec4f(0.5); }' },
      ],
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
    await reserveSlug(SLUG, doc.id, OWNER)
    expect(await finalizePagePublish(SLUG)).toBe(true)
    const pub = await loadPublished(SLUG)
    expect(pub?.title).toBe('After Purchase')
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
