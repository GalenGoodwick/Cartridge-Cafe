import { describe, it, expect, vi, beforeEach } from 'vitest'

// The route's I/O edges are mocked; everything below them (rooting, ordering,
// card assembly, the two feed shapes) runs REAL. prisma is stubbed so importing
// the route never opens a pool; the TTL cache passes through so each GET sees
// its own fixture rows instead of a 20s-stale neighbor's.
vi.mock('@/lib/prisma', () => {
  const prisma = { playerSpace: { findMany: vi.fn() } }
  return { prisma, default: prisma }
})
vi.mock('@/lib/ttl-cache', () => ({
  cached: (_ns: string, _key: string, _ttl: number, make: () => Promise<unknown>) => make(),
}))

import { prisma } from '@/lib/prisma'
import { GET, feedTabs, feedTab, feedForked, rootRows, OPEN_GROUND, type FeedRow } from '@/app/api/cards/route'

const findMany = prisma.playerSpace.findMany as unknown as { mockResolvedValue: (v: unknown) => void; mock: { calls: unknown[][] } }

// ── fixtures: two bases, a fork chain, open ground (a one-off, a ghost parent, a cycle) ──

const row = (id: string, slug: string, over: Partial<FeedRow> = {}): FeedRow => ({
  id, slug,
  name: slug.toUpperCase(),
  forkOfId: null,
  updatedAt: 0,
  maker: { handle: 'mara', name: 'Mara' },
  counts: { forks: 0, versions: 1 },
  card: null,
  unfinished: false,
  blurb: '',
  vision: '',
  isBase: false,
  iconWgsl: null,
  hue: null,
  isPublic: true,
  forkable: false,
  buildMode: 'owner',
  members: 0,
  kind: 'toy' as const,
  perf: null,
  premium: null,
  hasNodes: false,
  hasContent: true,
  fit: 'desktop' as const,
  ...over,
})

const fixture = (): FeedRow[] => [
  row('b2', 'platformer-2d-base', { isBase: true, updatedAt: 100, card: { type: 'platformer', tags: ['2d'] } }),
  row('f1', 'mossy-run', { forkOfId: 'b2', updatedAt: 500, card: { type: 'platformer', tags: ['2d', 'speedrun'] } }),
  row('f2', 'mossy-run-neo', { forkOfId: 'f1', updatedAt: 300 }),   // roots via a 2-hop chain
  row('b3', 'arena-base', { isBase: true, updatedAt: 900 }),
  row('o1', 'lone-toy', { updatedAt: 50 }),                          // no lineage at all
  row('o2', 'orphan', { forkOfId: 'ghost', updatedAt: 60 }),         // parent left the public set
  row('c1', 'loop-a', { forkOfId: 'c2', updatedAt: 10 }),            // forkOf cycle —
  row('c2', 'loop-b', { forkOfId: 'c1', updatedAt: 20 }),            //   never roots
]

describe('feedForked — the ⑄ FORKS lineage shelf', () => {
  it('keeps only worlds with a forkOf parent, most-recent first, drops non-forks', () => {
    const slugs = feedForked(fixture()).cards.map(c => c.slug)
    // every forkOf-bearing row, updatedAt desc: mossy-run(500), neo(300), orphan(60), loop-b(20), loop-a(10)
    expect(slugs).toEqual(['mossy-run', 'mossy-run-neo', 'orphan', 'loop-b', 'loop-a'])
    // bases and lineage-less toys never appear
    expect(slugs).not.toContain('platformer-2d-base')
    expect(slugs).not.toContain('arena-base')
    expect(slugs).not.toContain('lone-toy')
  })
})

describe('rootRows', () => {
  it('roots forks through multi-hop chains, bases at themselves, strays/cycles at null', () => {
    const roots = rootRows(fixture())
    expect(roots.get('b2')).toBe('b2')
    expect(roots.get('f1')).toBe('b2')
    expect(roots.get('f2')).toBe('b2')     // two hops up
    expect(roots.get('b3')).toBe('b3')
    expect(roots.get('o1')).toBeNull()
    expect(roots.get('o2')).toBeNull()     // ghost parent → open ground
    expect(roots.get('c1')).toBeNull()     // cycle-safe
    expect(roots.get('c2')).toBeNull()
  })
})

describe('feedTabs', () => {
  it('one tab per base (recency order), whole family counted, open ground tallied', () => {
    const out = feedTabs(fixture())
    expect(out.tabs).toEqual([
      { slug: 'arena-base', name: 'ARENA-BASE', count: 1 },              // newer base first
      { slug: 'platformer-2d-base', name: 'PLATFORMER-2D-BASE', count: 3 }, // base + f1 + f2
    ])
    expect(out.openGround).toBe(4)                                       // o1 o2 c1 c2
  })

  it('an empty world set yields empty tabs and zero open ground', () => {
    expect(feedTabs([])).toEqual({ tabs: [], openGround: 0 })
  })
})

describe('feedTab — a base tab', () => {
  it('pins the base card FIRST even when forks are fresher, then family by recency', () => {
    const out = feedTab(fixture(), 'platformer-2d-base')
    expect(out.cards.map(c => c.slug)).toEqual(['platformer-2d-base', 'mossy-run', 'mossy-run-neo'])
    expect(out.base?.slug).toBe('platformer-2d-base')
    expect(out.base?.isBase).toBe(true)
  })

  it('roots every card at the tab base and resolves forkOf to a SLUG', () => {
    const out = feedTab(fixture(), 'platformer-2d-base')
    for (const c of out.cards) expect(c.base).toBe('platformer-2d-base')
    const neo = out.cards.find(c => c.slug === 'mossy-run-neo')!
    expect(neo.forkOf).toBe('mossy-run')       // id f1 → slug, not the raw id
    expect(out.base?.forkOf).toBeNull()
  })

  it('never leaks another family or open ground into a tab', () => {
    const slugs = feedTab(fixture(), 'platformer-2d-base').cards.map(c => c.slug)
    for (const stray of ['arena-base', 'lone-toy', 'orphan', 'loop-a', 'loop-b']) {
      expect(slugs).not.toContain(stray)
    }
  })

  it('unknown tab (or a non-base slug) → { base: null, cards: [] }', () => {
    expect(feedTab(fixture(), 'no-such-base')).toEqual({ base: null, cards: [] })
    expect(feedTab(fixture(), 'mossy-run')).toEqual({ base: null, cards: [] })  // a fork is not a tab
  })
})

describe('feedTab — open ground', () => {
  it('serves the unrooted worlds, no base, recency order, base: null on each card', () => {
    const out = feedTab(fixture(), OPEN_GROUND)
    expect(out.base).toBeNull()
    expect(out.cards.map(c => c.slug)).toEqual(['orphan', 'lone-toy', 'loop-b', 'loop-a'])
    for (const c of out.cards) expect(c.base).toBeNull()
  })
})

describe('card assembly', () => {
  const cardOf = (over: Partial<FeedRow>) =>
    feedTab([row('b', 'the-base', { isBase: true }), row('w', 'my world', { forkOfId: 'b', ...over })], 'the-base')
      .cards.find(c => c.slug === 'my world')!

  it('type/tags come from worldData.card; a typeless legacy world serves type ""', () => {
    expect(cardOf({ card: { type: 'puzzle', tags: ['calm', 'islands'] } })).toMatchObject({ type: 'puzzle', tags: ['calm', 'islands'] })
    expect(cardOf({ card: null })).toMatchObject({ type: '', tags: [] })
    // malformed card facts never crash the feed — they degrade to untyped
    expect(cardOf({ card: { type: 7 as unknown as string, tags: ['ok', 3 as unknown as string] } })).toMatchObject({ type: '', tags: ['ok'] })
  })

  it('desc is the blurb, falling back to the FIRST LINE of vision', () => {
    expect(cardOf({ blurb: 'a tidy blurb', vision: 'ignored' }).desc).toBe('a tidy blurb')
    expect(cardOf({ blurb: '  ', vision: 'first line\nsecond line' }).desc).toBe('first line')
    expect(cardOf({}).desc).toBe('')
  })

  it('icons are referenced by slug only — a URL, never inline pixels', () => {
    expect(cardOf({}).icon).toBe('/api/spaces/icons/my%20world')
  })

  it('carries maker + counts + updatedAt through', () => {
    const c = cardOf({ maker: { handle: 'rook', name: 'Rook' }, counts: { forks: 12, versions: 4 }, updatedAt: 777 })
    expect(c.maker).toEqual({ handle: 'rook', name: 'Rook' })
    expect(c.counts).toEqual({ forks: 12, versions: 4 })
    expect(c.updatedAt).toBe(777)
  })
})

// ── the route itself: prisma rows in → feed JSON out ──

const dbRow = (id: string, slug: string, wd: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  id, slug,
  name: slug.toUpperCase(),
  forkOfId: null,
  updatedAt: new Date(1_000_000),
  owner: { name: 'Mara', email: 'mara.jade+cafe@example.com' },
  _count: { forks: 2, versions: 5 },
  snapshot: { fields: [{ big: 'x'.repeat(64) }], worldData: { secret_key: 'DO-NOT-SHIP', ...wd } },
  ...over,
})

const get = (qs: string) => GET(new Request(`http://cafe.test/api/cards${qs}`))

beforeEach(() => {
  vi.clearAllMocks()
  findMany.mockResolvedValue([
    dbRow('b1', 'cinder-base', { __base: true, card: { type: 'action-dungeon', tags: ['3d'] }, blurb: 'the set face' }),
    dbRow('w1', 'cinder-run', { card: { type: 'action-dungeon' }, vision: 'embers first\nthen ash' }, { forkOfId: 'b1', updatedAt: new Date(2_000_000) }),
    dbRow('g1', 'guest-drift', {}, { owner: { name: null, email: 'anon123@guest.cartridge.cafe' } }),
  ])
})

describe('GET /api/cards', () => {
  it('?tabs=1 → the fixed strip counts (published excludes OPEN worlds; FORKABLE + SHARED retired)', async () => {
    // the GET path runs the real strip — feed it PRISMA-shaped rows
    findMany.mockResolvedValue(fixture().map(r => ({
      id: r.id, slug: r.slug, name: r.name, forkOfId: r.forkOfId, isPublic: true,
      updatedAt: new Date(r.updatedAt),
      owner: { name: r.maker.name, email: r.maker.handle ? `${r.maker.handle}@example.com` : null },
      _count: r.counts,
      snapshot: { worldData: { card: r.card, blurb: r.blurb, vision: r.vision, __base: r.isBase ? true : undefined } },
    })))
    const res = await GET(new Request('http://cafe.test/api/cards?tabs=1'))
    const d = await res.json()
    // PUBLISHED = FINISHED (Galen, Aug 27): open (build:anyone) worlds are an
    // indefinite expansion — they live on LIVE only, never in published.
    expect(d.published).toBe(fixture().filter((r: FeedRow) => r.buildMode !== 'anyone').length)
    expect('forkable' in d).toBe(false)  // tab retired (Galen, Aug 27): bases live in /create's FORMAT picker
    expect(d.mine).toBeNull()    // no session in tests = signed out
    expect('shared' in d).toBe(false)   // tab retired (Galen, Aug 27): member worlds live in MINE
  })

  it('?tab=<base> → { base, cards } with the base pinned first', async () => {
    const res = await get('?tab=cinder-base')
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out.base.slug).toBe('cinder-base')
    expect(out.cards.map((c: { slug: string }) => c.slug)).toEqual(['cinder-base', 'cinder-run'])
    expect(out.cards[1]).toMatchObject({
      type: 'action-dungeon',
      desc: 'embers first',                       // blurb absent → first vision line
      forkOf: 'cinder-base',
      base: 'cinder-base',
      maker: { handle: 'marajadecafe', name: 'Mara' },  // handleOf strips dot/plus
      counts: { forks: 2, versions: 5 },
      isBase: false,
    })
  })

  it('?tab=open-ground → base: null + the unrooted; a guest world wears no handle', async () => {
    const out = await (await get('?tab=open-ground')).json()
    expect(out.base).toBeNull()
    expect(out.cards.map((c: { slug: string }) => c.slug)).toEqual(['guest-drift'])
    expect(out.cards[0].maker).toEqual({ handle: null, name: null })
  })

  it('unknown tab → 404', async () => {
    const res = await get('?tab=never-was')
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ base: null, cards: [] })
  })

  it('queries public worlds ONCE and never ships snapshots, raw emails, or stray worldData', async () => {
    const body = JSON.stringify(await (await get('?tab=cinder-base')).json())
    expect(findMany.mock.calls).toHaveLength(1)
    expect((findMany.mock.calls[0][0] as { where: unknown }).where).toEqual({ isPublic: true })
    expect(body).not.toContain('DO-NOT-SHIP')            // only card/blurb/vision/__base survive
    expect(body).not.toContain('xxxx')                   // no snapshot fields
    expect(body).not.toContain('@')                      // no email anywhere — handles only
  })
})
