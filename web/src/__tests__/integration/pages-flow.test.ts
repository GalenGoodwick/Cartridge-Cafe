// End-to-end of the pages durable layer against the dev database (cool-pond).
// Exercises the real slot store — create (live at birth) → edit → token
// mint/verify → claim → rename → views → delete — the same calls the API
// routes make.
//
// Needs DATABASE_URL (run via `npm run test:integration` with .env.local loaded).
import { describe, it, expect, afterAll } from 'vitest'
import {
  createPage, loadPageDoc, savePageDoc, deletePage,
  mintPageToken, verifyPageToken, revokePageToken,
  slugAvailable, claimPage, renamePage, loadPublished, finalizePagePublish,
  reserveSlug, listPublishedPages, bumpPageViews,
  sanitizeBlocks, syncPublishedSnapshot, type PageDoc,
} from '@/lib/pages'

const OWNER = 'test-user-pages-flow'
const SLUG = 'itest-pages-flow-' + Math.floor(Math.random() * 1e6)

let doc: PageDoc

describe.sequential('pages flow (dev DB)', () => {
  afterAll(async () => {
    if (doc) await deletePage(doc).catch(() => {})
  })

  it('a page is LIVE at birth: auto address, unclaimed, unlisted', async () => {
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
    // live from creation, at an auto slug derived from the title
    expect(doc.published).toBe(true)
    expect(doc.claimed).toBe(false)
    expect(doc.slug).toMatch(/^integration-test-page-[0-9a-f]{4}$/)
    const pub = await loadPublished(doc.slug!)
    expect(pub?.claimed).toBe(false)
    // on the index but flagged unclaimed (hub/sitemap filter these out)
    const entry = (await listPublishedPages()).find((p) => p.slug === doc.slug)
    expect(entry?.claimed).toBe(false)
  })

  it('round-trips a save and the live snapshot follows', async () => {
    doc.blocks = sanitizeBlocks([...doc.blocks, { kind: 'text', text: 'appended' }])
    await savePageDoc(doc)
    await syncPublishedSnapshot(doc)
    const back = await loadPageDoc(doc.id)
    expect(back?.blocks.length).toBe(5)
    expect((await loadPublished(doc.slug!))?.blocks.length).toBe(5)
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

  it('claiming moves the page to its chosen address and releases the auto one', async () => {
    const autoAddr = doc.slug!
    expect((await slugAvailable(SLUG, doc.id)).ok).toBe(true)
    await claimPage(doc, SLUG)
    expect(doc.claimed).toBe(true)
    expect(doc.slug).toBe(SLUG)
    // chosen address live + listed as claimed
    expect((await loadPublished(SLUG))?.claimed).toBe(true)
    expect((await listPublishedPages()).find((p) => p.slug === SLUG)?.claimed).toBe(true)
    // auto address released entirely
    expect(await loadPublished(autoAddr)).toBeNull()
    expect((await listPublishedPages()).find((p) => p.slug === autoAddr)).toBeUndefined()
    // taken for another page, still "free" for a same-page re-publish
    expect((await slugAvailable(SLUG, 'pg_other')).ok).toBe(false)
    expect((await slugAvailable(SLUG, doc.id)).ok).toBe(true)
  })

  it('rename (free, post-claim) carries the audience count', async () => {
    await Promise.all([bumpPageViews(SLUG), bumpPageViews(SLUG)])
    const renamed = SLUG + '-renamed'
    await renamePage(doc, renamed)
    expect((await listPublishedPages()).find((p) => p.slug === renamed)?.views).toBe(2)
    expect(await loadPublished(SLUG)).toBeNull()   // old address released
    await renamePage(doc, SLUG)                     // move back for later tests
    expect((await listPublishedPages()).find((p) => p.slug === SLUG)?.views).toBe(2)
  })

  it('finalizePagePublish (webhook path) claims from a reservation', async () => {
    doc.title = 'After Purchase'
    doc.claimed = false   // simulate a page paying for the claim
    await savePageDoc(doc)
    expect(await reserveSlug(SLUG, doc.id, OWNER)).toBe(true)
    expect(await finalizePagePublish(SLUG, doc.id)).toBe('published')
    const pub = await loadPublished(SLUG)
    expect(pub?.title).toBe('After Purchase')
    expect(pub?.claimed).toBe(true)
    doc = (await loadPageDoc(doc.id))!   // pick up claimed=true
    expect(doc.claimed).toBe(true)
  })

  it('reservation for a LIVE slug is refused for another page; paid conflict refuses to clobber', async () => {
    expect(await reserveSlug(SLUG, 'pg_intruder', 'someone-else')).toBe(false)
    expect(await finalizePagePublish(SLUG, 'pg_intruder')).toBe('conflict')
    expect((await loadPublished(SLUG))?.title).toBe('After Purchase')
  })

  it('finalize verifies the PAID pageId even when a later reservation overwrote the index', async () => {
    const raceSlug = SLUG + '-race'
    expect(await reserveSlug(raceSlug, doc.id, OWNER)).toBe(true)
    expect(await finalizePagePublish(raceSlug, doc.id)).toBe('published')
    expect((await loadPublished(raceSlug))?.title).toBe('After Purchase')
    // move back and confirm the race address fully released (rename releases)
    await renamePage(doc, SLUG)
    expect(await loadPublished(raceSlug)).toBeNull()
    expect((await listPublishedPages()).find((p) => p.slug === raceSlug)).toBeUndefined()
  })

  it('views bump atomically under concurrency', async () => {
    const before = (await listPublishedPages()).find((p) => p.slug === SLUG)?.views ?? 0
    await Promise.all([bumpPageViews(SLUG), bumpPageViews(SLUG), bumpPageViews(SLUG)])
    const after = (await listPublishedPages()).find((p) => p.slug === SLUG)?.views ?? 0
    expect(after).toBe(before + 3)   // concurrent bumps may not lose counts
  })

  it('delete removes draft, live copy, slug, and listing', async () => {
    const id = doc.id
    await deletePage(doc)
    expect(await loadPageDoc(id)).toBeNull()
    expect(await loadPublished(SLUG)).toBeNull()
    expect((await slugAvailable(SLUG, 'pg_other')).ok).toBe(true)
    expect((await listPublishedPages()).find((p) => p.slug === SLUG)).toBeUndefined()
    doc = undefined as unknown as PageDoc   // afterAll: nothing to clean
  })
})
