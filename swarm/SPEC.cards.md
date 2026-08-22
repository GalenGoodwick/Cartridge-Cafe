# SPEC — the CARD MAIN swarm (one truth; nodes import this, never diverge)

Vision: DESIGN-card-main.md (repo root). This SPEC is the contract layer for
`swarm/MAP.cards.json`. Run tools against THIS map:
`node swarm/tools/status.mjs swarm/MAP.cards.json` etc. The neighboring
MAP.json is the veilfire-3d swarm — do not touch it.

## Shared contracts (the law of shapes)

```ts
// worldData.card — the card facts a world carries (set via set_card)
type WorldCard = { type: string; tags: string[] }   // type = registry id

// the type registry — game slot `cardtypes:index`
type TypeRegistry = { v: 1; types: { id: string; label: string; desc?: string }[] }
// seeded from SEED_CARD_TYPES (web/src/lib/cards.ts); grows via propose_card_type

// a CARD as the feed serves it — the ONLY shape the UI may consume
type Card = {
  slug: string; name: string
  type: string; tags: string[]
  desc: string                       // blurb, fallback first line of vision
  icon: string | null                // /api/spaces/icons image for slug (PNG)
  maker: { handle: string | null; name: string | null }
  base: string | null                // rooting base slug (null = OPEN GROUND)
  forkOf: string | null
  counts: { forks: number; versions: number }
  isBase: boolean
  updatedAt: number
}

// the feed — GET /api/cards
//   ?tabs=1            → { tabs: [{ slug, name, count }...] , openGround: count }
//   ?tab=<baseSlug>    → { base: Card, cards: Card[] }   // base pinned FIRST
//   ?tab=open-ground   → { base: null, cards: Card[] }
// grid order (orderGrid): base first, then updatedAt desc, reading order L→R
// T→B. (Galen's "right to left" — if literal, flip ONLY in the UI node.)
```

Publish law: `publish_world` additionally requires a valid `worldData.card`
(validateCard against the live registry). Existing published worlds are
untouched until the backfill node types them.

## File ownership (the clobber law)

| node | owns (exactly) |
|---|---|
| cards-data | `web/src/lib/cards.ts` · `web/src/__tests__/unit/cards.test.ts` |
| cards-registry | `web/src/app/api/engine/cards-registry.ts` · `web/src/__tests__/unit/cards-registry.test.ts` · SEAM-A |
| cards-feed | `web/src/app/api/cards/route.ts` · `web/src/__tests__/unit/cards-feed.test.ts` |
| publish-gate | SEAM-B · `web/src/__tests__/unit/cards-publish-gate.test.ts` |
| backfill-types | `web/src/app/api/admin/backfill-card-types/route.ts` |
| cards-card | `web/src/app/cards/Card.tsx` |
| cards-grid | `web/src/app/cards/page.tsx` · `web/src/app/cards/Grid.tsx` |
| cards-tabs | `web/src/app/cards/Tabs.tsx` |
| cutover | (gated — no files until Galen's ruling) |

SEAMS — the only two shared-file touches, each owned by exactly one node:
- **SEAM-A** (cards-registry): in `web/src/app/api/engine/bridge/route.ts`,
  ONE dispatch block routing `card_types` / `propose_card_type` / `set_card`
  to functions imported from `cards-registry.ts`. Nothing else in that file.
- **SEAM-B** (publish-gate): inside the existing `publish_world` handler in
  the same file, the card requirement check (import `validateCard` +
  registry read). Keep it ≤10 lines, marked `// SEAM-B (cards)`.
Coordinate seam pushes on the commons; never edit the other seam's lines.

## Build waves (dependsOn enforces this)

1. `cards-data` → `cards-registry`, `cards-feed`
2. `publish-gate`, `backfill-types`
3. `cards-card` → `cards-grid` → `cards-tabs` (flag-gated `/cards`, main untouched)
4. `cutover` — BLOCKED on Galen's explicit ruling. Never claim it.

## Worker mechanics

- Worktrees base off `origin/opus/branch-to-fork`:
  run agent-dock with `SWARM_BASE_REF=origin/opus/branch-to-fork`.
- Fresh worktrees have no node_modules: `ln -s <main-checkout>/web/node_modules web/node_modules`
  (main checkout: /Users/galengoodwick/Documents/GitHub/cartridge-cafe).
- Tests: `cd web && ./node_modules/.bin/vitest run src/__tests__/unit/<yours>`.
  Typecheck before undock: `cd web && ./node_modules/.bin/tsc --noEmit`.
- Slots (`cardtypes:index`) are read/written ONLY through the game-slot store
  (`loadGameSlot`/`saveGameSlot`) — never invent a parallel store.
- Green is DERIVED (`status.mjs`); evidence keys recorded in the node, honestly.
