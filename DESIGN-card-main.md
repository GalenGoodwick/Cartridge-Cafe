# DESIGN — The Card Main (core spec)

Galen's ruling (Aug 22 2026): demolish the current visual main — the spatial
constellation, the player-world nav, and sub-mains — and replace it with a
**grid-based shader page of cards** in a Magic-the-Gathering-ish format,
organized as **tabs, one per BASE archetype**. Built node-structured on the
co-build substrate this time; port what we keep, retire the rest.

## 1 · The Card (the atom of the new main)

Every published world IS a card. MTG-ish anatomy, mapped to what the platform
already records:

```
┌─────────────────────────────┐
│ NAME                    ⑄ 12│  ← title bar · fork count
│ ┌─────────────────────────┐ │
│ │                         │ │
│ │      SHADER IMAGE       │ │  ← the world's baked icon (the eye's photo);
│ │                         │ │    hover/focus = the LIVE shader animating
│ └─────────────────────────┘ │
│ TYPE — action dungeon       │  ← MANDATORY, from the generated type list
│ tags: 2d · multiplayer · …  │  ← optional, normalized lowercase
│ ─────────────────────────── │
│ Description — the blurb,    │  ← rules-text box
│ two lines, truncated.       │
│ ─────────────────────────── │
│ @maker        base: CINDER  │  ← artist line · set symbol = its base
└─────────────────────────────┘
```

**Field sources** (no new tables):
- name/slug/owner/forkOf/isPublic/counts → `playerSpace` (+ `_count`)
- shader image → the icon store (`world_icon:<slug>`, the bake pipeline)
- description → `worldData.blurb` (fallback: first line of `vision`)
- **type + tags → NEW `worldData.card = { type, tags[] }`** via `set_card`
- base lineage → walk `forkOfId` up (≤8 hops) to the rooting `__base` world

**The mandatory TYPE**: one value from the platform type registry (§2). The
publish gate extends: `publish_world` requires `card.type` alongside
vision + instructions + brief_done. Unpublished worlds may be typeless.

## 2 · The generated type list

Types are a curated-but-growing vocabulary (like MTG's type line, not free
tags): slot `cardtypes:index` = `{ v:1, types: [{ id, label, desc? }] }`.

- Seeded with a starter vocabulary (platformer, action dungeon, shooter,
  puzzle, adventure, arcade, racer, tactics, sandbox, toy, builder, sim,
  arena, co-op, rhythm, horror, narrative, sports, tower defense, roguelike).
- `card_types` (bridge) returns the list — the AI building a world picks from
  it; `propose_card_type {label, desc}` appends when nothing fits (deduped,
  normalized; curation = admin prune later). The list is GENERATED in both
  senses: seeded by generation, grown by the builders' proposals.
- `set_card {type, tags}` validates type ∈ registry, normalizes tags
  (lowercase, ≤8, ≤24 chars each).

## 3 · The page: tabs per base, lineage grids

- **Tabs = the public `__base` worlds** (PLATFORMER 2D BASE, 3D BASE, ARENA
  BASE, ADVENTURE BASE, …). A tab is a shader-grid page for that base's family.
- **Base card pinned top-left, featured** (larger frame — the "set's face").
- **The family grid**: every public world whose forkOf-chain roots at that
  base, filling the grid in reading order (left→right, top→bottom), ordered by
  recency of update. (Galen said "right to left top to bottom" — implemented
  as reading order; flip to literal RTL is a one-line sort change if meant.)
- **The +1 tab: OPEN GROUND** — public worlds rooting at no base (legacy,
  one-offs). Existing worlds live here until adopted by/re-forked from a base.
- Maker view (`/u/<handle>`) becomes the same card grid filtered by maker —
  the spatial deed retires with main.

## 4 · What retires, what ports

| Current | Fate |
|---|---|
| Spatial constellation (SpatialCanvas, bubbles) | RETIRED after cutover |
| Player-world nav (deed, big-bubble view) | RETIRED → maker card grid |
| Sub-mains (groups' spatial shelves) | RETIRED as nav; group registry stays — a group becomes a **deck** (a named card list) later |
| Main reckoning (tournament:main) | PORTS — a tab-level surface; ruling kept: main-only voting |
| Presence/heat, world entry, search | PORT into the card grid (presence chip on cards; search filters the grid) |
| cafe-cartridge.mjs door hook | RETIRED after cutover (its jobs move to card pages) |

## 5 · Built with nodes (the dogfood rule)

The replacement is built as NODE-STRUCTURED subsystems — each its own module
with an owner, buildable/revertable via the dock (this is the first product
built on the co-build substrate):

- `cards-data` — lib + feed API (rung 1, THIS commit)
- `cards-registry` — type list slot + bridge verbs (rung 1, THIS commit)
- `cards-grid` — the grid page UI (React route `/cards`, flag-gated)
- `cards-tabs` — base tabs + OPEN GROUND
- `cards-card` — the card component (baked PNG → live shader on focus)
- `cards-port-*` — presence, search, entry, reckoning ports
- `cutover` — main → cards, demolition of the spatial system (LAST, gated)

## 6 · Rollout law

1. Data + registry land first (invisible; publish gate warns before it blocks).
2. `/cards` grows in PARALLEL behind the flag — main untouched.
3. Backfill sweep: every public world gets `card.type` (AI-classified from its
   vision/blurb, from the registry vocabulary) — no card left typeless.
4. Bases ship (2D, 3D, arena, adventure) — tabs become real.
5. Galen walks /cards → cutover ruling → main swaps, spatial system removed.

## 7 · Open questions (one-line answers when ready)

- Literal right-to-left grid flow, or reading order? (implemented: reading)
- Do private worlds show as face-down cards on the owner's own grid? (proposed: yes)
- Deck feature for retired groups — build or drop?
- Card rarity/foil from fork-count or playtime — cosmetic, later?
