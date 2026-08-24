import { describe, it, expect } from 'vitest'
import {
  SEED_CARD_TYPES,
  normalizeTypeId,
  normalizeTags,
  validateCard,
  proposeType,
  rootBaseOf,
  orderGrid,
  cardFromRow, handleOf,
} from '@/lib/cards'

/** Guards the PURE card core (SPEC.cards.md / DESIGN-card-main.md §1-3): the
 *  seed vocabulary, normalization, validation, registry growth, lineage
 *  rooting, grid order, and the Card assembly the feed serves. Every export. */

describe('SEED_CARD_TYPES', () => {
  it('every seed id is its own normalization (stable, URL-safe)', () => {
    for (const t of SEED_CARD_TYPES) {
      expect(t.id).toBe(normalizeTypeId(t.label))
    }
  })

  it('has no duplicate ids', () => {
    const ids = SEED_CARD_TYPES.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('carries the multi-word + hyphenated archetypes', () => {
    const ids = SEED_CARD_TYPES.map(t => t.id)
    expect(ids).toContain('action-dungeon')
    expect(ids).toContain('tower-defense')
    expect(ids).toContain('co-op')
  })
})

describe('normalizeTypeId', () => {
  it('lowercases, trims, and hyphenates spaces', () => {
    expect(normalizeTypeId('  Action Dungeon ')).toBe('action-dungeon')
    expect(normalizeTypeId('Tower   Defense')).toBe('tower-defense')
  })

  it('strips punctuation but keeps hyphens', () => {
    expect(normalizeTypeId('co-op!')).toBe('co-op')
    expect(normalizeTypeId('rogue_like?')).toBe('roguelike')
  })

  it('empties out garbage and caps at 32 chars', () => {
    expect(normalizeTypeId('!!!')).toBe('')
    expect(normalizeTypeId('')).toBe('')
    expect(normalizeTypeId('x'.repeat(50))).toHaveLength(32)
  })
})

describe('normalizeTags', () => {
  it('returns [] for anything that is not an array', () => {
    expect(normalizeTags(undefined)).toEqual([])
    expect(normalizeTags('2d')).toEqual([])
    expect(normalizeTags({ 0: '2d' })).toEqual([])
  })

  it('lowercases, strips junk, skips non-strings and empties, dedupes', () => {
    expect(normalizeTags(['2D', 'Multiplayer!', 42, '', 'multiplayer', '  '])).toEqual(['2d', 'multiplayer'])
  })

  it('caps at 8 tags of ≤24 chars each', () => {
    const many = Array.from({ length: 12 }, (_, i) => `tag${i}`)
    expect(normalizeTags(many)).toHaveLength(8)
    const [long] = normalizeTags(['x'.repeat(40)])
    expect(long).toHaveLength(24)
  })
})

describe('validateCard', () => {
  it('refuses a missing/blank/non-string type with the pick-one message', () => {
    for (const type of [undefined, '', '   ', 7]) {
      const r = validateCard({ type }, SEED_CARD_TYPES)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toContain('card.type is required')
    }
  })

  it('refuses a type outside the registry, naming the normalized id', () => {
    const r = validateCard({ type: 'MOBA!' }, SEED_CARD_TYPES)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('"moba"')
  })

  it('accepts a registry type through normalization + normalizes the tags', () => {
    const r = validateCard({ type: '  Action Dungeon ', tags: ['2D', '2d', 'Hard!'] }, SEED_CARD_TYPES)
    expect(r).toEqual({ ok: true, card: { type: 'action-dungeon', tags: ['2d', 'hard'] } })
  })

  it('validates against the LIVE registry, not just the seed', () => {
    const grown = proposeType(SEED_CARD_TYPES, 'metroidvania').registry
    expect(validateCard({ type: 'metroidvania' }, SEED_CARD_TYPES).ok).toBe(false)
    expect(validateCard({ type: 'metroidvania' }, grown).ok).toBe(true)
  })
})

describe('proposeType', () => {
  it('appends a new type without mutating the input registry', () => {
    const before = SEED_CARD_TYPES.length
    const r = proposeType(SEED_CARD_TYPES, ' Metroidvania ', 'explore, unlock, return')
    expect(r.added).toBe(true)
    expect(r.id).toBe('metroidvania')
    expect(r.registry).toHaveLength(before + 1)
    expect(r.registry.at(-1)).toEqual({ id: 'metroidvania', label: 'metroidvania', desc: 'explore, unlock, return' })
    expect(SEED_CARD_TYPES).toHaveLength(before)   // pure — seed untouched
  })

  it('dedupes by normalized id (label variants collapse)', () => {
    const r = proposeType(SEED_CARD_TYPES, 'Tower  Defense!')
    expect(r).toEqual({ registry: SEED_CARD_TYPES, added: false, id: 'tower-defense' })
  })

  it('rejects empty or too-short ids (<3 chars)', () => {
    expect(proposeType(SEED_CARD_TYPES, '!!').added).toBe(false)
    expect(proposeType(SEED_CARD_TYPES, 'ab').added).toBe(false)
    expect(proposeType(SEED_CARD_TYPES, '').added).toBe(false)
  })

  it('caps label at 32 and desc at 140', () => {
    const r = proposeType([], 'z'.repeat(50), 'd'.repeat(200))
    expect(r.registry[0].label).toHaveLength(32)
    expect(r.registry[0].desc).toHaveLength(140)
  })
})

describe('rootBaseOf', () => {
  const parents = (pairs: [string, string | null][]) => new Map(pairs)

  it('a base roots at itself', () => {
    expect(rootBaseOf('b1', parents([['b1', null]]), new Set(['b1']))).toBe('b1')
  })

  it('walks a fork chain up to the rooting base', () => {
    const p = parents([['w3', 'w2'], ['w2', 'w1'], ['w1', 'b1'], ['b1', null]])
    expect(rootBaseOf('w3', p, new Set(['b1']))).toBe('b1')
  })

  it('stops at the NEAREST base in the chain', () => {
    const p = parents([['w1', 'b2'], ['b2', 'b1'], ['b1', null]])
    expect(rootBaseOf('w1', p, new Set(['b1', 'b2']))).toBe('b2')
  })

  it('open ground: no base in the ancestry → null', () => {
    const p = parents([['w2', 'w1'], ['w1', null]])
    expect(rootBaseOf('w2', p, new Set(['b1']))).toBeNull()
    expect(rootBaseOf('orphan', parents([]), new Set(['b1']))).toBeNull()
  })

  it('survives a forkOf cycle (returns null, never hangs)', () => {
    const p = parents([['a', 'b'], ['b', 'c'], ['c', 'a']])
    expect(rootBaseOf('a', p, new Set(['base']))).toBeNull()
  })

  it('caps the walk at 8 hops: a base 8 up is found, 9 up is not', () => {
    const chain: [string, string | null][] = []
    for (let i = 0; i < 9; i++) chain.push([`w${i}`, i === 8 ? 'base' : `w${i + 1}`])
    chain.push(['base', null])
    const p = parents(chain)
    expect(rootBaseOf('w1', p, new Set(['base']))).toBe('base')   // 8 hops
    expect(rootBaseOf('w0', p, new Set(['base']))).toBeNull()     // 9 hops
  })
})

describe('orderGrid', () => {
  const row = (id: string, updatedAt: number, isBase = false) => ({ id, slug: id, updatedAt, isBase })

  it('pins the base first even when the family is newer', () => {
    const base = row('b1', 100, true)
    const out = orderGrid(base, [row('w1', 500), row('w2', 900), base])
    expect(out.map(w => w.id)).toEqual(['b1', 'w2', 'w1'])
  })

  it('never doubles the base when it appears in the family list', () => {
    const base = row('b1', 100, true)
    expect(orderGrid(base, [base, row('w1', 50)]).filter(w => w.id === 'b1')).toHaveLength(1)
  })

  it('open ground (null base): pure updatedAt desc', () => {
    const out = orderGrid(null, [row('w1', 1), row('w3', 3), row('w2', 2)])
    expect(out.map(w => w.id)).toEqual(['w3', 'w2', 'w1'])
  })

  it('empty family: just the base, or nothing', () => {
    const base = row('b1', 1, true)
    expect(orderGrid(base, [])).toEqual([base])
    expect(orderGrid(null, [])).toEqual([])
  })
})

describe('cardFromRow', () => {
  // the canonical signature (the route's battle-grown one): maker/lineage
  // arrive PRE-resolved on the row; handleOf keeps its own law test below
  const row = {
    slug: 'ember-run',
    name: 'EMBER RUN',
    updatedAt: 1_755_000_000_000,
    maker: { handle: 'marajanealt', name: 'Mara' },
    forkOf: 'cinderfell' as string | null,
    base: 'cinderfell' as string | null,
    counts: { forks: 3, versions: 7 },
  }

  it('assembles the full Card shape from row + worldData slice', () => {
    const wd = { card: { type: 'Action Dungeon', tags: ['2D', 'hard'] }, blurb: 'Run the ember.', __base: false }
    expect(cardFromRow(row, wd, true)).toEqual({
      slug: 'ember-run',
      name: 'EMBER RUN',
      type: 'action-dungeon',
      tags: ['2d', 'hard'],
      desc: 'Run the ember.',
      icon: '/api/spaces/icons/ember-run',
      iconWgsl: null,
      hue: null,
      maker: { handle: 'marajanealt', name: 'Mara' },
      base: 'cinderfell',
      forkOf: 'cinderfell',
      counts: { forks: 3, versions: 7 },
      isBase: false,
      kind: 'toy',
      perf: null,
      premium: null,
      mobileReady: false,
      playable: true,
      edit: { mode: 'static', editors: 1 },
      updatedAt: 1_755_000_000_000,
    })
  })

  it('handleOf: the one handle rule — email local-part, sanitized', () => {
    expect(handleOf('mara.jane+alt@example.com')).toBe('marajanealt')
    expect(handleOf('')).toBe(null)
    expect(handleOf(undefined)).toBe(null)
  })

  it('desc falls back: blurb → first non-empty vision line → empty', () => {
    expect(cardFromRow(row, { blurb: '  A   spaced\nblurb ' }, false).desc).toBe('A spaced blurb')
    expect(cardFromRow(row, { vision: '\n\n  The first real line.  \ndetail' }, false).desc).toBe('The first real line.')
    expect(cardFromRow(row, { blurb: '', vision: 'RAW: fallback works' }, false).desc).toBe('RAW: fallback works')
    expect(cardFromRow(row, {}, false).desc).toBe('')
    expect(cardFromRow(row, {}, false).desc).toBe('')
  })

  it('caps desc at 180 chars', () => {
    expect(cardFromRow(row, { blurb: 'x'.repeat(400) }, false).desc).toHaveLength(180)
  })

  it('isBase reads __base truthiness', () => {
    expect(cardFromRow(row, { __base: true }, false).isBase).toBe(true)
    expect(cardFromRow(row, { __base: 1 as unknown as boolean }, false).isBase).toBe(true)
    expect(cardFromRow(row, { __base: undefined }, false).isBase).toBe(false)
    expect(cardFromRow(row, {}, false).isBase).toBe(false)
  })

  it('icon: null when absent, the slug-addressed icons path when present', () => {
    expect(cardFromRow(row, {}, false).icon).toBeNull()
    expect(cardFromRow(row, {}, true).icon).toBe('/api/spaces/icons/ember-run')
  })

  it('untyped legacy world → type "" and empty tags (the backfill fills these)', () => {
    const c = cardFromRow(row, { blurb: 'old world' }, false)
    expect(c.type).toBe('')
    expect(c.tags).toEqual([])
  })

  it('maker nulls pass through; name falls back to slug', () => {
    const c = cardFromRow({ slug: 'lone', name: '', updatedAt: 5, maker: { handle: null, name: null }, forkOf: null, base: null, counts: { forks: 0, versions: 0 } }, {}, false)
    expect(c.maker).toEqual({ handle: null, name: null })
    expect(c.name).toBe('lone')
    expect(c.counts).toEqual({ forks: 0, versions: 0 })
  })

  it('passes epoch-ms updatedAt through', () => {
    expect(cardFromRow({ ...row, updatedAt: 99 }, {}, false).updatedAt).toBe(99)
  })

  it('base/forkOf pass through untouched (rootBaseOf owns resolution)', () => {
    const c = cardFromRow({ ...row, base: 'ember-run', forkOf: null }, { __base: true }, false)
    expect(c.base).toBe('ember-run')
    expect(c.forkOf).toBeNull()
  })
})
