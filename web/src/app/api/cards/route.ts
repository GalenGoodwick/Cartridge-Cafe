import { getServerSession } from 'next-auth'
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
export interface Card {
  slug: string
  name: string
  type: string
  tags: string[]
  desc: string
  icon: string | null
  iconWgsl: string | null                 // the LIVE shader (cards-live-art); null = photo/placeholder
  hue: number | null
  maker: { handle: string | null; name: string | null }
  base: string | null
  forkOf: string | null
  counts: { forks: number; versions: number }
  isBase: boolean
  mobileReady: boolean
  playable: boolean                  // isPublic — false = a draft (MY/OUR only)
  updatedAt: number
}

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
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const tab = url.searchParams.get('tab')
  const rows = await cached('cards', 'public', CARDS_TTL_MS, fetchRows)
  // THE TWO TABS (Galen's ruling): PUBLISHED (bases featured on top) and
  // MY/OUR WORLDS (owned ∪ member, drafts included). Family pages
  // (?tab=<baseSlug>) and open-ground remain as click-through pages.
  if (tab === 'published') return NextResponse.json(feedPublished(rows))
  if (tab === 'mine') {
    const mine = await fetchMineRows()
    if (mine === null) return NextResponse.json({ bases: [], cards: [], signedOut: true })
    return NextResponse.json(feedMine(rows, mine))
  }
  if (tab) {
    const out = feedTab(rows, tab)
    const known = tab === OPEN_GROUND || out.base !== null
    return NextResponse.json(known ? out : { ...out, error: `no base "${tab}"` }, known ? undefined : { status: 404 })
  }
  // ?tabs=1 (and the bare GET) → the fixed strip + counts (mine needs a session)
  const mine = await fetchMineRows()
  return NextResponse.json({
    published: rows.length,
    bases: rows.filter(r => r.isBase).length,
    mine: mine === null ? null : mine.length,
  })
}

/** MY/OUR: the signed-in maker's worlds — OWNED plus MEMBER (a live
 *  member:<handle> key on the world). Includes UNPUBLISHED (drafts); never
 *  cached (per-user truth). Null = signed out. */
async function fetchMineRows(): Promise<FeedRow[] | null> {
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
    where: { OR: [
      { ownerId: me.id },
      { tokens: { some: { revokedAt: null, name: `member:${handle}` } } },
    ] },
    select: {
      id: true, slug: true, name: true, forkOfId: true, isPublic: true, updatedAt: true,
      owner: { select: { name: true, email: true } },
      _count: { select: { forks: true, versions: true } },
      snapshot: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  })
  return stripRows(spaces)
}

/** PUBLISHED: every playable card; the BASES ride separately as the featured
 *  row (they are not repeated in the main grid). */
export function feedPublished(rows: FeedRow[]): { bases: Card[]; cards: Card[] } {
  const roots = rootRows(rows)
  const slugOf = new Map(rows.map(r => [r.id, r.slug]))
  const idToSlug = (r: FeedRow) => r.forkOfId ? slugOf.get(r.forkOfId) ?? null : null
  const toCard = (r: FeedRow) => cardFromRow(
    { ...r, forkOf: idToSlug(r), base: roots.get(r.id) ? slugOf.get(roots.get(r.id)!) ?? null : null },
    { card: r.card, blurb: r.blurb, vision: r.vision, __base: r.isBase },
    true,
  )
  const bases = rows.filter(r => r.isBase).sort((a, b) => b.updatedAt - a.updatedAt).map(toCard)
  const cards = rows.filter(r => !r.isBase).sort((a, b) => b.updatedAt - a.updatedAt).map(toCard)
  return { bases, cards }
}

/** MY/OUR: mine (drafts included) in recency order; rooting resolves against
 *  the public rows too (a draft fork of a public base still knows its base). */
export function feedMine(publicRows: FeedRow[], mine: FeedRow[]): { bases: Card[]; cards: Card[] } {
  const all = [...mine, ...publicRows.filter(p => !mine.some(m => m.id === p.id))]
  const roots = rootRows(all)
  const slugOf = new Map(all.map(r => [r.id, r.slug]))
  const toCard = (r: FeedRow) => cardFromRow(
    { ...r, forkOf: r.forkOfId ? slugOf.get(r.forkOfId) ?? null : null, base: roots.get(r.id) ? slugOf.get(roots.get(r.id)!) ?? null : null },
    { card: r.card, blurb: r.blurb, vision: r.vision, __base: r.isBase },
    true,
  )
  return { bases: [], cards: mine.sort((a, b) => b.updatedAt - a.updatedAt).map(toCard) }
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
      snapshot: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 500,
  })
  return stripRows(spaces)
}

// strip each snapshot IMMEDIATELY — only the card facts survive, so the
// cache never holds (and the wire never sees) whole world snapshots.
function stripRows(spaces: Array<{ snapshot: unknown; owner: { name: string | null; email: string | null } | null; _count: { forks: number; versions: number }; updatedAt: Date; id: string; slug: string; name: string; forkOfId: string | null; isPublic: boolean }>): FeedRow[] {
  return spaces.map(({ snapshot, owner, _count, updatedAt, ...rest }) => {
    const sn = snapshot as { worldData?: Record<string, unknown>; fields?: IconField[]; visualTypes?: IconVisual[]; modules?: IconVisual[] } | null
    const wd = sn?.worldData || {}
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

// TEMP until cards-data lands cardFromRow — this route then swaps to
// `import { cardFromRow } from '@/lib/cards'` and deletes this fallback
// (same signature: (row, wd, iconPresent) → Card).
function cardFromRow(
  row: { slug: string; name: string; updatedAt: number; forkOf: string | null; base: string | null; maker: Card['maker']; counts: Card['counts'] },
  wd: { card?: FeedRow['card']; blurb?: string; vision?: string; __base?: boolean },
  iconPresent: boolean,
  live?: { iconWgsl: string | null; hue: number | null },
): Card {
  const type = typeof wd.card?.type === 'string' ? wd.card.type : ''
  const tags = Array.isArray(wd.card?.tags) ? wd.card.tags.filter((t): t is string => typeof t === 'string') : []
  const desc = (wd.blurb || '').trim() || (wd.vision || '').split('\n')[0].trim()
  return {
    slug: row.slug,
    name: row.name,
    type,
    tags,
    desc,
    // referenced by slug ONLY — the icon store serves the PNG; never inline b64
    icon: iconPresent ? `/api/spaces/icons/${encodeURIComponent(row.slug)}` : null,
    iconWgsl: live?.iconWgsl ?? null,
    hue: live?.hue ?? null,
    maker: row.maker,
    base: row.base,
    forkOf: row.forkOf,
    counts: row.counts,
    playable: (row as { isPublic?: boolean }).isPublic !== false,
    mobileReady: wd.card && (wd.card as { mobile?: unknown }).mobile === true || (Array.isArray(wd.card?.tags) && (wd.card.tags as string[]).includes('mobile')) || false,
    isBase: wd.__base === true,
    updatedAt: row.updatedAt,
  }
}
