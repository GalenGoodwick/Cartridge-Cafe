# DESIGN — Multiplayer World Building (the fork-is-creation model)

Galen, Aug 22 2026, designing aloud: *"we have a total blank world first. A
world is always forked. On fork we set up world parameters — anyone can add,
only invited can add, others can play. One tab is published worlds. Then a
My/Our worlds."*

## 1 · The first principle: A WORLD IS ALWAYS FORKED

There is ONE truly blank world — **THE BLANK** — the ur-base beneath the base
archetypes: empty snapshot, no engine, no level, `__base: true`, house-owned.
Every world on the platform is a fork of something:

```
THE BLANK
 ├─ PLATFORMER 2D BASE        (engine forked onto blank, no level)
 │   ├─ someone's fell        (level designed onto the engine)
 │   │   └─ a remix of it
 ├─ 3D BASE · ARENA BASE · …
 └─ any freeform world        (forked straight off THE BLANK)
```

- "Brew a world" = fork THE BLANK. Fork a base = start a platformer. Fork any
  world = remix. **One primitive** — create_world becomes sugar for
  fork(blank). Lineage becomes TOTAL: every world roots somewhere, so the
  catalog, credit stacks, and base families need no special cases.

## 2 · Fork-time parameters: the world's SOCIAL CONTRACT

At the moment of forking, the forker sets who the world is for. Two axes:

```
worldData.policy = {
  build: 'anyone' | 'invited' | 'owner',    // who may ADD to the world
  play:  'everyone' | 'invited' | 'builders', // who may ENTER and play
  // (later, riding the monetization model:)
  forkable: 'free' | 'paid' | 'closed',
  price?: number,
}
```

Named presets at fork time (the UI moment — a panel on the FORK dialog):

| preset | build | play | the sentence on the button |
|---|---|---|---|
| **Open ground** | anyone | everyone | "everyone builds, everyone plays" |
| **Crew world** | invited | everyone | "my crew builds, everyone plays" |
| **Private table** | invited | invited | "invite-only, build and play" |
| **Solo** | owner | everyone | "I build, everyone plays" (today's default) |

## 3 · Enforcement: policy → keys (nothing new to invent)

The mechanics already exist — policy just decides who gets which key:

- **build: anyone** → any signed-in visitor can mint a member build key for
  this world (the co-build dock's node holds prevent clobber; per-key
  `holderOf` gives attribution). The world is a public construction site.
- **build: invited** → member keys minted only through the owner's invite
  (co-build rung 3: invite by handle / join link, keys named `member:<handle>`,
  kick = revoke). Everyone else's bridge writes are refused.
- **play: invited** → the space page gate checks membership, not just
  isPublic (extends today's owner-or-public check with a members list).
- All building rides the node law: dock a node, build it, undock with
  submitted code; per-node versions + revert keep a shared world healable.
  Live-adopt (`?rev=1`) means every builder-player SEES each landed edit in
  ~2s; `mpManifest` + the arena service give shared play state. **Build IS
  play** — a crew standing in the world it is shaping.

## 4 · The catalog: TWO TABS

- **PUBLISHED** — the public shelf. Every published card (mandatory type,
  the card anatomy). BASES surface as a featured row/section at the top of
  PUBLISHED (all bases, one place — per-base FAMILY pages remain as
  click-through pages, not tabs).
- **MY / OUR WORLDS** — the personal-and-collaborative shelf: worlds I own
  PLUS worlds I'm invited into (building or playing). "Our" is the point —
  this is where multiplayer building lives day to day: the crew's worlds,
  their build activity (presence, LIVE tags), my drafts (face-down cards).

## 5 · What this retires / reuses

- create_world → fork(THE BLANK) with parameters. The /fork route gains the
  policy panel. brew flow = pick a base (or blank) → set the social contract
  → you're standing in your world with your crew keys minted.
- Per-base tabs (built this week) → the featured BASES row + family pages.
- Sub-mains stay retired; a "crew" is a world-scoped members list (the
  roundtable co-dev spec's governance — unkickable owner, kick/ban — applies
  per world, not per spatial shelf).

## 6 · Build rungs (each a map node when we build)

1. **THE BLANK** — mint the ur-base world, house-owned, published.
2. **policy field + enforcement** — worldData.policy; bridge write-gate reads
   it (build access); space page gate reads it (play access). Tests.
3. **fork-with-parameters** — /fork + scene/fork accept {policy, name};
   the FORK dialog gains the preset panel.
4. **member keys** — co-build rung 3 (invite/join/kick → named uc_st_ keys),
   'anyone' = self-serve mint.
5. **catalog two tabs** — PUBLISHED (bases featured) + MY/OUR (owned ∪ member).
6. **arena wiring** — mpManifest on bases so crews co-exist as players while
   building (bloop's proven stack).

## 7 · GALEN'S RULINGS (Aug 22, second pass)

- **BLANKS ARE FUNCTIONING WORLDS, and there are TWO: BLANK 2D and BLANK 3D**
  (more added as we go). A blank is a working minimal world for its dimension
  — render loop, input plumbed, camera, one field — with NOTHING in it. The
  root layer of the fork tree. Distinction from a BASE: a blank is a
  DIMENSION substrate; a base is a GENRE engine (blank-2d → platformer-2d-base
  → someone's fell). Blanks show as cards.
- **NO policy change after fork — ever.** "That isn't fair to people." The
  social contract is immutable from the moment of forking.
- **SHARING A LINK IS SHARING OWNERSHIP.** The invite mechanism IS the world
  link: whoever holds the link holds build access at ownership level. No
  separate invite/accept flow — possession of the link is membership. (An
  'invited' world's link is a bearer credential; treat it with key seriousness:
  the /pair-style page mints their member key on first visit.)
- **MAKE PLAYABLE / MAKE UNPLAYABLE replaces Public/Private** as the world
  toggle everywhere in the UI. A world is PLAYABLE (on the shelf, enterable)
  or UNPLAYABLE (hidden). isPublic stays as the column; the language changes.
- **The griefing problem** (players deleting/overwriting each other's work):
  defense in depth, mostly already built —
  1. Node holds: a held node refuses a foreign overwrite (live).
  2. Per-node version history + node_revert: NOTHING is ever truly lost —
     any clobber or delete heals to last-good (live).
  3. Provenance: every landed rev records its builder (holderOf) — griefing
     is attributable, not anonymous (live).
  4. Destructive verbs tightened: remove_step_hook / remove_node / field
     deletion allowed only to the node's HOLDER or the world OWNER (build rung).
  5. The BAN: world-scoped ban tool (owner + unkickable-admin model from the
     roundtable spec) — a banned member's key is revoked and their link access
     dies (build rung). Galen: "that might be a ban" — yes, plus the above
     making bans rare because damage is revertable.
- **Main wears the cartridge.cafe logo** (landed on the catalog masthead).
