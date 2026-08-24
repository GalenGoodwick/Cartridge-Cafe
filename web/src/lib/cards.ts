// cards — the PURE core of the card main (DESIGN-card-main.md §1-3).
// Every published world is a CARD: name, shader image, description, tags, and
// a MANDATORY TYPE from the generated type registry. The main becomes tabs —
// one per BASE archetype — each a grid: base card pinned first (top-left),
// its fork-lineage filling the page in reading order. No I/O here.

export interface CardType { id: string; label: string; desc?: string }

/** The seed vocabulary — the registry slot starts from this and GROWS via
 *  propose_card_type. IDs are the normalized labels (stable, URL-safe). */
export const SEED_CARD_TYPES: CardType[] = [
  'platformer', 'action dungeon', 'shooter', 'puzzle', 'adventure', 'arcade',
  'racer', 'tactics', 'sandbox', 'toy', 'builder', 'sim', 'arena', 'co-op',
  'rhythm', 'horror', 'narrative', 'sports', 'tower defense', 'roguelike',
].map(label => ({ id: label.replace(/\s+/g, '-'), label }))

/** Normalize a proposed/assigned type label → registry id form. */
export function normalizeTypeId(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/\s+/g, '-').slice(0, 32)
}

/** Normalize a tag list: lowercase, deduped, ≤8 tags of ≤24 chars. */
export function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const t of raw) {
    if (typeof t !== 'string') continue
    const v = t.trim().toLowerCase().replace(/[^a-z0-9 +-]/g, '').slice(0, 24)
    if (v && !out.includes(v)) out.push(v)
    if (out.length >= 8) break
  }
  return out
}

/** Validate a worldData.card candidate against the registry. Returns the clean
 *  record or the refusal reason — the set_card verb and the publish gate share
 *  this one truth. */
export function validateCard(
  candidate: { type?: unknown; tags?: unknown },
  registry: CardType[],
): { ok: true; card: { type: string; tags: string[] } } | { ok: false; error: string } {
  const typeId = typeof candidate.type === 'string' ? normalizeTypeId(candidate.type) : ''
  if (!typeId) return { ok: false, error: 'card.type is required — pick one from card_types (or propose_card_type if nothing fits)' }
  if (!registry.some(t => t.id === typeId)) {
    return { ok: false, error: `"${typeId}" is not in the type list — card_types shows the vocabulary; propose_card_type {label} to grow it` }
  }
  return { ok: true, card: { type: typeId, tags: normalizeTags(candidate.tags) } }
}

/** Append a proposed type to the registry (dedup by id). Returns the (possibly
 *  unchanged) registry and whether it grew. */
export function proposeType(registry: CardType[], label: string, desc?: string):
  { registry: CardType[]; added: boolean; id: string } {
  const id = normalizeTypeId(label)
  if (!id || id.length < 3) return { registry, added: false, id }
  if (registry.some(t => t.id === id)) return { registry, added: false, id }
  return { registry: [...registry, { id, label: label.trim().toLowerCase().slice(0, 32), desc: desc?.slice(0, 140) }], added: true, id }
}

// ── lineage rooting: which BASE does a world descend from? ──

/** Walk forkOf parents (≤8 hops, cycle-safe) to the first ancestor flagged as
 *  a base. `parents` maps id→forkOfId; `bases` is the set of base world ids.
 *  A base roots at itself. Null = OPEN GROUND (no base ancestry). */
export function rootBaseOf(
  id: string,
  parents: Map<string, string | null>,
  bases: Set<string>,
): string | null {
  let cur: string | null | undefined = id
  const seen = new Set<string>()
  for (let hop = 0; cur && hop <= 8; hop++) {
    if (seen.has(cur)) return null          // cycle — treat as unrooted
    seen.add(cur)
    if (bases.has(cur)) return cur
    cur = parents.get(cur) ?? null
  }
  return null
}

// ── the grid ──

export interface CardRow {
  id: string
  slug: string
  updatedAt: number
  isBase?: boolean
}

/** Order a base tab's grid: the base card FIRST (pinned top-left), then the
 *  family in reading order by recency (newest activity first). DESIGN §3 —
 *  flip the sort for literal right-to-left if Galen means it literally. */
export function orderGrid<T extends CardRow>(base: T | null, family: T[]): T[] {
  const rest = family
    .filter(w => !base || w.id !== base.id)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  return base ? [base, ...rest] : rest
}

// ── the CARD — SPEC.cards.md's one shape the feed serves and the UI consumes ──
// (interface below — the battle-grown version the UI consumes)


/** The worldData slice a card reads — never the whole snapshot. */
export interface WorldDataSlice {
  card?: { type?: unknown; tags?: unknown; mobile?: unknown } | null
  blurb?: unknown
  vision?: unknown
  __base?: unknown
}

/** Description: the builder's blurb, fallback the first non-empty line of the
 *  vision — one line, whitespace collapsed, ≤180 chars (the blurb-mirror law). */
export function descOf(wd: WorldDataSlice | null | undefined): string {
  const blurb = typeof wd?.blurb === 'string' ? wd.blurb.replace(/\s+/g, ' ').trim() : ''
  if (blurb) return blurb.slice(0, 180)
  const vision = typeof wd?.vision === 'string' ? wd.vision : ''
  const line = vision.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).find(Boolean) || ''
  return line.slice(0, 180)
}

/** Maker handle: email local-part, sanitized — the platform's one handle rule
 *  (scene-auth.ts). Null when there is no usable email. */
export function handleOf(email: unknown): string | null {
  if (typeof email !== 'string' || !email) return null
  return email.split('@')[0].replace(/[^a-z0-9_-]/gi, '') || null
}


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
  edit: { mode: 'static' | 'open' | 'crew'; editors: number }   // who may build (the card's tag)
  updatedAt: number
}

/** The ONE row→Card projection (was TEMP in the cards route — this is its
 *  canonical home; the route imports it). (row, wd, iconPresent, live?) → Card. */
export function cardFromRow(
  row: { slug: string; name: string; updatedAt: number; forkOf: string | null; base: string | null; maker: Card['maker']; counts: Card['counts'] },
  wd: { card?: { type?: unknown; tags?: unknown; mobile?: unknown } | null; blurb?: string; vision?: string; __base?: boolean },
  iconPresent: boolean,
  live?: { iconWgsl: string | null; hue: number | null },
): Card {
  const type = typeof wd.card?.type === 'string' ? normalizeTypeId(wd.card.type) : ''
  const tags = normalizeTags(wd.card?.tags)
  const desc = descOf(wd as WorldDataSlice)
  return {
    slug: row.slug,
    name: row.name || row.slug,
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
    edit: (() => { const r = row as { buildMode?: string; members?: number }
      return r.buildMode === 'anyone' ? { mode: 'open' as const, editors: 0 }
        : r.buildMode === 'invited' ? { mode: 'crew' as const, editors: (r.members ?? 0) + 1 }
        : { mode: 'static' as const, editors: 1 } })(),
    mobileReady: wd.card && (wd.card as { mobile?: unknown }).mobile === true || (Array.isArray(wd.card?.tags) && (wd.card.tags as string[]).includes('mobile')) || false,
    isBase: Boolean(wd.__base),   // truthiness — legacy worlds carry 1
    updatedAt: row.updatedAt,
  }
}
