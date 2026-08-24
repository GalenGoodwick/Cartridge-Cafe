import { getServerSession } from 'next-auth'
import { cardFromRow, deriveKind, type Card, type CardKind } from '@/lib/cards'
export type { Card } from '@/lib/cards'
import { authOptions } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { handleOf } from '@/lib/notify'
import { composeIcon, dominantHue, type IconField, type IconVisual } from '@/lib/icon-compose'
import { rootBaseOf, orderGrid } from '@/lib/cards'
import { cached } from '@/lib/ttl-cache'

export const dynamic = 'force-dynamic'

// GET /api/cards — the CARD MAIN feed (SPEC.cards.md):
//   ?tabs=1            → { tabs: [{ slug, name, count }...], openGround: count }
//   ?tab=<baseSlug>    → { base: Card, cards: Card[] }   // base pinned FIRST
//   ?tab=open-ground   → { base: null, cards: Card[] }
// ONE playerSpace query over public worlds; snapshots are opened server-side
// for exactly card/blurb/vision/__base and dropped — a snapshot never ships.

/** The +1 tab: public worlds whose forkOf-chain roots at no base. */
export const OPEN_GROUND = 'open-ground'

// Feeds tolerate staleness (a just-published card surfaces within the window);
// same per-instance collapse as browse/icons, one shared row set for all tabs.
const CARDS_TTL_MS = 20_000

/** A CARD as the feed serves it — the ONLY shape the UI may consume (SPEC). */

/** One world AFTER the server-side snapshot strip — the pure feed core
 *  works over these rows only (tested hard in cards-feed.test.ts). */
export interface FeedRow {
  id: string
  slug: string
  name: string
  forkOfId: string | null
  updatedAt: number
  maker: { handle: string | null; name: string | null }
  counts: { forks: number; versions: number }
  // the ONLY worldData facts the feed may know (extracted, never the snapshot)
  card: { type?: unknown; tags?: unknown } | null
  blurb: string
  vision: string
  isBase: boolean
  // the LIVE art: the world's composed icon shader + dominant hue (cards-live-art)
  iconWgsl: string | null
  hue: number | null
  isPublic: boolean
  forkable: boolean
  buildMode: 'anyone' | 'invited' | 'owner'
  members: number                    // live member:<handle> keys (distinct handles)
  kind: CardKind                     // toy · world · game (Galen's taxonomy)
}

/** 48 cards a page (clean 2/3/4-column multiples). Pagination is SERVER-side
 *  so page counts and search stay truthful over the whole catalog — no silent
 *  cap (Galen: pages 1, 2, 3…, not a 500 ceiling). */
const PAGE_SIZE = 48

function paginate(cards: Card[], page: number): { cards: Card[]; page: number; pages: number; total: number } {
  const total = cards.length
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const p = Math.min(Math.max(1, page), pages)
  return { cards: cards.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE), page: p, pages, total }
}

/** The ONE search predicate — server-side so a match on page 9 is findable. */
function cardHits(c: Card, needle: string): boolean {
  return c.name.toLowerCase().includes(needle) || c.type.includes(needle) ||
    c.tags.some(t => t.includes(needle)) || (c.maker.handle ?? '').includes(needle)
}

/** Search + the mobile capability cut + pagination, in that order. mobile=1
 *  filters to mobile-ready; if NOTHING declares readiness the full set returns
 *  flagged mobileFallback (the catalog's honest banner). */
function serve(cards: Card[], url: URL) {
  const page = parseInt(url.searchParams.get('page') || '1', 10) || 1
  const q = (url.searchParams.get('q') || '').trim().toLowerCase()
  let out = q ? cards.filter(c => cardHits(c, q)) : cards
  let mobileFallback = false
  if (url.searchParams.get('mobile') === '1') {
    const ready = out.filter(c => c.mobileReady || !c.playable)
    if (ready.length > 0) out = ready
    else mobileFallback = out.length > 0
  }
  return { ...paginate(out, page), mobileFallback }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  // ?types=1 → the card-type vocabulary (public read — World Tools' type picker)
  if (url.searchParams.get('types') === '1') {
    const { readTypeRegistry } = await import('../engine/cards-registry')
    const reg = await readTypeRegistry()
    return NextResponse.json({ types: reg.types })
  }
  const tab = url.searchParams.get('tab')
  const rows = await cached('cards', 'public', CARDS_TTL_MS, fetchRows)
  // THE FOUR TABS (Galen's ruling): PUBLISHED · FORKABLE (bases + worlds with
  // forking enabled — the start-here surface) · MY WORLDS (owned) · SHARED
  // WORLDS (member, not owner). Family pages (?tab=<baseSlug>) and open-ground
  // remain as click-through pages.
  if (tab === 'published') return NextResponse.json(serve(feedPublished(rows).cards, url))
  if (tab === 'forkable') return NextResponse.json(serve(feedForkable(rows).cards, url))
  // ALTERABLE (Galen): published worlds anyone may walk in and edit
  // (build:'anyone' — the OPEN EDIT chip); UNALTERABLE = the rest (crew/static)
  if (tab === 'alterable') return NextResponse.json(serve(feedPublished(rows.filter(r => r.buildMode === 'anyone')).cards, url))
  if (tab === 'unalterable') return NextResponse.json(serve(feedPublished(rows.filter(r => r.buildMode !== 'anyone')).cards, url))
  if (tab === 'mine' || tab === 'shared') {
    const own = await fetchMineRows(tab)
    if (own === null) return NextResponse.json({ cards: [], page: 1, pages: 1, total: 0, signedOut: true })
    return NextResponse.json(serve(feedMine(rows, own).cards, url))
  }
  if (tab) {
    const out = feedTab(rows, tab)
    const known = tab === OPEN_GROUND || out.base !== null
    if (!known) return NextResponse.json({ ...out, error: `no base "${tab}"` }, { status: 404 })
    return NextResponse.json({ base: out.base, ...serve(out.cards, url) })
  }
  // ?tabs=1 (and the bare GET) → the fixed strip counts (mine/shared need a session)
  const [mine, shared] = await Promise.all([fetchMineRows('mine'), fetchMineRows('shared')])
  return NextResponse.json({
    published: rows.length,
    forkable: rows.filter(r => r.isBase || r.forkable).length,
    alterable: rows.filter(r => r.buildMode === 'anyone').length,
    mine: mine === null ? null : mine.length,
    shared: shared === null ? null : shared.length,
  })
}

/** MY/OUR: the signed-in maker's worlds — OWNED plus MEMBER (a live
 *  member:<handle> key on the world). Includes UNPUBLISHED (drafts); never
 *  cached (per-user truth). Null = signed out. */
async function fetchMineRows(kind: 'mine' | 'shared'): Promise<FeedRow[] | null> {
  let email: string | null | undefined
  try {
    const session = await getServerSession(authOptions)
    email = session?.user?.email
  } catch { return null }   // no request scope (tests/SSG) = signed out
  if (!email) return null
  const me = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (!me) return null
  const handle = email.split('@')[0].replace(/[^a-z0-9_-]/gi, '')
  const spaces = await prisma.playerSpace.findMany({
    where: kind === 'mine'
      ? { ownerId: me.id }
      : { ownerId: { not: me.id }, tokens: { some: { revokedAt: null, name: `member:${handle}` } } },
    select: {
      id: true, slug: true, name: true, forkOfId: true, isPublic: true, updatedAt: true,
      owner: { select: { name: true, email: true } },
      _count: { select: { forks: true, versions: true } },
      tokens: { where: { revokedAt: null, name: { startsWith: 'member:' } }, select: { name: true } },
      snapshot: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  })
  return stripRows(spaces)
}

/** FORKABLE — the start-here surface: bases + every published world whose
 *  maker enabled forking. Bases lead, then by recency. */
export function feedForkable(rows: FeedRow[]): { cards: Card[] } {
  const pool = rows.filter(r => r.isBase || r.forkable)
  const roots = rootRows(rows)
  const slugOf = new Map(rows.map(r => [r.id, r.slug]))
  const toCard = (r: FeedRow) => cardFromRow(
    { ...r, forkOf: r.forkOfId ? slugOf.get(r.forkOfId) ?? null : null, base: roots.get(r.id) ? slugOf.get(roots.get(r.id)!) ?? null : null },
    { card: r.card, blurb: r.blurb, vision: r.vision, __base: r.isBase },
    true,
  )
  const bases = pool.filter(r => r.isBase).sort((a, b) => b.updatedAt - a.updatedAt)
  const rest = pool.filter(r => !r.isBase).sort((a, b) => b.updatedAt - a.updatedAt)
  return { cards: [...bases, ...rest].map(toCard) }
}

/** PUBLISHED: every playable card, one grid, recency order. */
export function feedPublished(rows: FeedRow[]): { cards: Card[] } {
  const roots = rootRows(rows)
  const slugOf = new Map(rows.map(r => [r.id, r.slug]))
  const idToSlug = (r: FeedRow) => r.forkOfId ? slugOf.get(r.forkOfId) ?? null : null
  const toCard = (r: FeedRow) => cardFromRow(
    { ...r, forkOf: idToSlug(r), base: roots.get(r.id) ? slugOf.get(roots.get(r.id)!) ?? null : null },
    { card: r.card, blurb: r.blurb, vision: r.vision, __base: r.isBase },
    true,
  )
  return { cards: [...rows].sort((a, b) => b.updatedAt - a.updatedAt).map(toCard) }
}

/** MY/OUR: mine (drafts included) in recency order; rooting resolves against
 *  the public rows too (a draft fork of a public base still knows its base). */
export function feedMine(publicRows: FeedRow[], mine: FeedRow[]): { cards: Card[] } {
  const all = [...mine, ...publicRows.filter(p => !mine.some(m => m.id === p.id))]
  const roots = rootRows(all)
  const slugOf = new Map(all.map(r => [r.id, r.slug]))
  const toCard = (r: FeedRow) => cardFromRow(
    { ...r, forkOf: r.forkOfId ? slugOf.get(r.forkOfId) ?? null : null, base: roots.get(r.id) ? slugOf.get(roots.get(r.id)!) ?? null : null },
    { card: r.card, blurb: r.blurb, vision: r.vision, __base: r.isBase },
    true,
  )
  return { cards: mine.sort((a, b) => b.updatedAt - a.updatedAt).map(toCard) }
}

// ── the one query (+ per-instance TTL collapse, browse-style) ──

async function fetchRows(): Promise<FeedRow[]> {
  const spaces = await prisma.playerSpace.findMany({
    where: { isPublic: true },
    select: {
      id: true,
      slug: true,
      name: true,
      forkOfId: true,
      isPublic: true,
      updatedAt: true,
      owner: { select: { name: true, email: true } },
      _count: { select: { forks: true, versions: true } },
      tokens: { where: { revokedAt: null, name: { startsWith: 'member:' } }, select: { name: true } },
      snapshot: true,
    },
    orderBy: { updatedAt: 'desc' },
    // a SAFETY NET, not a product cap (pagination serves the pages). If this
    // ever fills, the jsonb-light query is the scale fix — say so, never drop
    // silently.
    take: 2000,
  })
  if (spaces.length === 2000) console.warn('[cards] fetch net FULL (2000) — time for the jsonb-light query')
  return stripRows(spaces)
}

// strip each snapshot IMMEDIATELY — only the card facts survive, so the
// cache never holds (and the wire never sees) whole world snapshots.
function stripRows(spaces: Array<{ snapshot: unknown; owner: { name: string | null; email: string | null } | null; _count: { forks: number; versions: number }; tokens?: Array<{ name: string | null }>; updatedAt: Date; id: string; slug: string; name: string; forkOfId: string | null; isPublic: boolean }>): FeedRow[] {
  return spaces.map(({ snapshot, owner, _count, tokens, updatedAt, ...rest }) => {
    const sn = snapshot as { worldData?: Record<string, unknown>; fields?: IconField[]; visualTypes?: IconVisual[]; modules?: IconVisual[]; stepHooks?: Array<{ id?: string; code?: string }>; worldParams?: { gridSize?: number; gridW?: number; gridH?: number } } | null
    const wd = sn?.worldData || {}
    // THE KIND (toy·world·game): the anatomy tells us — see lib/cards.deriveKind
    const rulesHook = (sn?.stepHooks || []).find(h => h?.id === 'rules')
    const rulesBuilt = !!rulesHook?.code && rulesHook.code.length > 40 && !/blank slot/.test(rulesHook.code)
    const wpK = sn?.worldParams || {}
    const kind = deriveKind({
      declared: (wd.card as { kind?: unknown } | undefined)?.kind,
      rulesBuilt,
      multiplayer: !!wd.mpManifest,
      gridBeyond: (wpK.gridSize ?? 512) > 512 || wpK.gridW !== undefined || wpK.gridH !== undefined,
    })
    // the LIVE art window: compose the world's icon shader (browse's law) —
    // small WGSL strings; the grid compiles them client-side, PNG is the fallback
    let iconWgsl: string | null = null
    let hue: number | null = null
    try {
      iconWgsl = composeIcon(sn?.fields || [], sn?.visualTypes || [], wd.icon_wgsl, sn?.modules || [])
      hue = dominantHue(sn?.fields || [])
    } catch { /* un-iconable world — the PNG/placeholder chain carries it */ }
    // a guest account (@guest.cartridge.cafe) is unclaimed — no maker handle;
    // never leak the raw email (browse's law, kept here)
    const email = owner?.email || ''
    const isGuest = /@guest\.cartridge\.cafe$/i.test(email) || !email
    return {
      ...rest,
      updatedAt: updatedAt.getTime(),
      maker: { handle: isGuest ? null : handleOf(email), name: owner?.name ?? null },
      counts: { forks: _count.forks, versions: _count.versions },
      card: (wd.card && typeof wd.card === 'object') ? wd.card as FeedRow['card'] : null,
      blurb: typeof wd.blurb === 'string' ? wd.blurb : '',
      vision: typeof wd.vision === 'string' ? wd.vision : '',
      isBase: wd.__base === true,
      iconWgsl,
      hue,
      isPublic: (rest as { isPublic?: boolean }).isPublic !== false,
      forkable: wd.forkable === true,
      kind,
      buildMode: (() => { const p = wd.policy as { build?: string } | undefined
        return p?.build === 'anyone' ? 'anyone' : p?.build === 'invited' ? 'invited' : 'owner' })(),
      members: new Set((tokens ?? []).map(t => t.name)).size,
    }
  })
}

// ── the pure feed core (exported for the unit tests; no I/O below this line) ──

/** Root every row: id → base id (null = OPEN GROUND). One parents map + base
 *  set feeds rootBaseOf for the whole row set. */
export function rootRows(rows: FeedRow[]): Map<string, string | null> {
  const parents = new Map<string, string | null>(rows.map(r => [r.id, r.forkOfId]))
  const bases = new Set(rows.filter(r => r.isBase).map(r => r.id))
  return new Map(rows.map(r => [r.id, rootBaseOf(r.id, parents, bases)]))
}

/** ?tabs=1 — one tab per public base (its whole rooted family counted, base
 *  included), most recently updated base first, plus the open-ground count. */
export function feedTabs(rows: FeedRow[]): { tabs: { slug: string; name: string; count: number }[]; openGround: number } {
  const roots = rootRows(rows)
  const countOf = new Map<string | null, number>()
  for (const r of rows) {
    const root = roots.get(r.id) ?? null
    countOf.set(root, (countOf.get(root) || 0) + 1)
  }
  const tabs = rows
    .filter(r => r.isBase)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(r => ({ slug: r.slug, name: r.name, count: countOf.get(r.id) || 0 }))
  return { tabs, openGround: countOf.get(null) || 0 }
}

/** ?tab=<baseSlug|open-ground> — the tab's grid: base card pinned FIRST, then
 *  its family by recency (orderGrid). Unknown tab → { base: null, cards: [] }. */
export function feedTab(rows: FeedRow[], tab: string): { base: Card | null; cards: Card[] } {
  const roots = rootRows(rows)
  const baseRow = tab === OPEN_GROUND ? null : rows.find(r => r.isBase && r.slug === tab) || null
  if (tab !== OPEN_GROUND && !baseRow) return { base: null, cards: [] }
  const rootId = baseRow ? baseRow.id : null
  const family = rows.filter(r => (roots.get(r.id) ?? null) === rootId)
  const slugOf = new Map(rows.map(r => [r.id, r.slug]))
  const baseSlug = baseRow ? baseRow.slug : null
  const toCard = (r: FeedRow) => cardFromRow(
    { ...r, forkOf: r.forkOfId ? slugOf.get(r.forkOfId) ?? null : null, base: baseSlug },
    { card: r.card, blurb: r.blurb, vision: r.vision, __base: r.isBase },
    true,
    { iconWgsl: r.iconWgsl, hue: r.hue },
  )
  const cards = orderGrid(baseRow, family).map(toCard)
  return { base: baseRow ? toCard(baseRow) : null, cards }
}

