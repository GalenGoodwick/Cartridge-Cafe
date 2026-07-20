# Player-World Tiering & Presence — Spec

Status: DRAFT · diagnosed, not yet built. Owner: Claude (Opus 4.8) + Galen.

This specs out one cluster of related issues: how player creations are **classified**,
how they **render** in the directory and as worlds, and how **live presence** (the
player's own icon + other players' cursors) shows up everywhere — not just on the hub.

---

## 0. The tiers (canonical model)

```
MAIN (CAFE)                      the shared universe — every core/public world
  └─ SUB-MAIN (a group)          a named /group gathering; its own shelf of pinned worlds
       └─ PLAYER WORLD (space)   a person's owned world at /space/<slug>; enters the arena
            └─ BRANCH (scene)    a ⑂ challenger of a world; a save-point lineage
```

- A **player world** is a `PlayerSpace` row (owned, `/space/<slug>`, server snapshot).
- A **branch** is a scene in the file/scene store named `NAME ⑂ handle · label · vN`.
- The hub (CAFE and SUB-MAIN) is the `cafe-cartridge.mjs` scene; it draws world **doors
  (bubbles)** and **presence** in its own WGSL.

Rendering must be **consistent per tier**: two makers with equivalent content must look
the same; a world in the directory and the same world entered must agree.

---

## 1. Problem inventory (root causes, from live diagnosis)

### 1.1 Makers directory: list-vs-bubble inconsistency  ·  (task #3)
- **Symptom:** in PLAYER WORLDS, `goodwick` renders as a spatial bubble (a world you enter,
  with branches), but `BlueStar Games` and `Laville` render as flat **lists**.
- **Not a data bug:** BlueStar Games *owns a real space* (`stadium`, public). So the
  bubble-vs-list decision is in the **directory's per-maker rendering**, not ownership.
- **Where:** `src/app/engine/scenes/cafe-cartridge.mjs`, the PLAYER WORLDS branch
  (`PLv/PL/HOUSE`, ~L515–640+). It composes makers from three sources:
  `/api/spaces/browse` (owners → handle), `/api/engine/scene?action=list` (scene branches),
  and the `scene-makers` slot (makers who only have scenes).
- **Root cause (to confirm at build time):** the layout likely gives a spatial bubble only
  when a maker's *primary* world resolves to a space with a settled saved layout, and falls
  back to a list otherwise — so a maker with exactly one space, or whose layout slot was
  never saved, degrades to a list. Needs the exact branch identified and unified.

### 1.2 Player's own icon (brewed glyph) missing on player worlds
- **Symptom:** on `/space/<slug>` you get the OS cursor, not your brewed glyph. The hub
  shows your glyph.
- **Root cause:** the glyph is drawn by the **hub scene's WGSL** calling `mod_playerglyph`
  at the cursor. The gate is `inHub = sim.fields.has('cf_world_f') || has('cf_submain_f')`
  (`FieldEngine.tsx` ~L654). A player world's arbitrary shader never calls the glyph module,
  so nothing draws it, and the OS cursor is left visible (`hubCursorRef` false).
- **Consequence:** "use main's code" can't be a literal reuse — main's code *is* the hub
  shader. A player world needs a **shader-independent glyph pass**.

### 1.3 Other players' cursors + drift ("icons drift in from outside")  ·  (task #16)
- **Symptom:** on player worlds / house / sub-main, presence icons slide in from off-screen
  on each reload; main does not.
- **Root cause (two parts):**
  - Hub bubbles already have **CALM BOOT / adopt-at-rest** (`cafe-cartridge.mjs` L506, and
    per-mode layout persistence L964) so doors don't replay the rim fly-in.
  - The **generic presence-cursor path** (`FieldEngine.tsx` L806+, `presenceOthers` over the
    Railway socket → `worldData.presence`) has **no calm-boot**: a newly-seen cursor animates
    from a default/last position toward its target → drift.

### 1.4 Branches should render as squares in a space  ·  (task #14)
- **Symptom:** `goodwick`'s world is "right" *except* its branches should be **square**
  bubbles; other player spaces don't show their branches at all.
- **Where:** the space view's branch listing (BRANCHES panel / branch stepper in
  `FieldEngine.tsx`, and/or the space bubble's children in the directory).

---

## 2. Target behavior (the spec)

### 2.1 Directory (makers / player worlds)
- Every maker with **≥1 visible space** renders as a **spatial world bubble** (enterable),
  identical treatment regardless of how many spaces/branches they have.
- A maker with **only scene branches** (no space) still renders as a bubble (their shelf of
  branches), never a flat list. The **flat list is removed** as a rendering mode.
- Inside a maker/space: its **branches render as square bubbles** (distinct shape from
  round world doors), laid out with the same adopt-at-rest layout as the hub.

### 2.2 Presence — one behavior everywhere (extract to shared code)
- **Self glyph on every world.** The player's brewed glyph (or preset) draws at the cursor
  on *any* world, hub or player world, via a generic composite (see §3.2). OS cursor hidden
  wherever the glyph draws.
- **Other players on every world.** Up to N others draw at their live cursor positions,
  the same on player worlds as the hub.
- **Adopt-at-rest.** A newly-seen cursor **snaps to its first reported position** (no lerp
  from a default) — the calm-boot rule, applied to the generic presence path too. After the
  first frame, normal smoothing resumes.

### 2.3 Consistency invariant
- The same world looks the same as a directory bubble and when entered.
- Two makers with equivalent content look the same. No "list" special-case survives.

---

## 3. Implementation plan

### 3.1 Directory consistency (do first — bounded, pure layout)
- **File:** `src/app/engine/scenes/cafe-cartridge.mjs` (PLAYER WORLDS branch).
- Identify the exact `PL`/`HOUSE` branch that chooses bubble vs list per maker.
- Make **every** maker a bubble: unify the code path so `spaces.length`, `branches only`,
  and `single space` all flow through the same bubble builder.
- Persist the `cafe:universe:players` (and `:house`) layout the same way main does
  (`U.wake<=0` → save, L964), so the makers directory loads at rest.
- **Risk:** low-medium — pure hub-hook layout; test by entering PLAYER WORLDS and confirming
  goodwick / BlueStar / Laville all render as settled bubbles with no fly-in.

### 3.2 Generic glyph/presence composite (the engine change)
- **Goal:** draw self + others' glyph cursors on any world without relying on the world's
  own WGSL.
- **Approach A (preferred): an injected presence-overlay field.** On load of a non-hub
  world, the engine auto-adds one transparent full-screen field `__presence` with a built-in
  visual `visual___presence` that:
  - reads the self cursor (mouse_x/y) and draws `mod_playerglyph` there,
  - reads `worldData.presence[]` and draws each seat's glyph (`mod_pg0..N`) at its position.
  This reuses the uber-shader composite (same seats the hub uses) and requires no per-world
  authoring. Register `mod_playerglyph` / `mod_pgN` on every world (today they're hub-only).
- **Approach B: a post-render composite pass** in `renderer.ts` (draw glyphs after the
  world's compute pass). More engine surface; only if A can't get z-order right.
- Extend the `inHub` gate → a general `drawsGlyph` that is true on hubs **and** any world
  carrying the injected `__presence` field. `hubCursorRef` → `glyphCursorRef` (hide OS
  cursor wherever the glyph draws).
- **Files:** `FieldEngine.tsx` (L176–194 glyph wrap, L645–676 registration, L806+ presence),
  maybe `renderer.ts`.
- **Risk:** medium-high — touches the render path shared by every world. Gate behind a flag
  first; verify no perf/z-order regressions on heavy worlds (works with the governor).

### 3.3 Calm-boot for the generic presence path (task #16)
- **File:** `FieldEngine.tsx` presence consumer (where `presenceOthers` / `worldData.presence`
  positions feed the shader).
- On first sight of a pid, set its rendered position = reported position (snap). Track a
  `seen:Set<pid>`; only smooth after the first frame. Reset on world change.
- **Risk:** low.

### 3.4 Branches as squares (task #14)
- **File:** `FieldEngine.tsx` branch listing for a space + the directory child rendering.
- Ensure a space's branches are fetched for **any** owner (not just goodwick) and rendered
  as **square** bubbles (a `shape:'square'` marker the hub/space view honors).
- **Risk:** low-medium.

---

## 4. Shared abstractions to extract (the "make it a function" ask)
- `presenceComposite()` — the WGSL + wiring that draws self + others' glyphs; used by the
  hub scene AND the injected `__presence` field, so there is one source of truth.
- `adoptAtRest(layoutSlot)` — the calm-boot/settle-and-persist helper, used by every hub
  mode AND the generic presence path (as snap-on-first-sight).
- `makerBubble(maker)` — one builder for a directory entry, killing the list fallback.

---

## 5. Sequencing
1. **§3.1 directory consistency** — visible, bounded, no render-path risk. Ship.
2. **§3.3 calm-boot presence snap** — small, kills the drift. Ship.
3. **§3.4 branches as squares** — bounded. Ship.
4. **§3.2 generic glyph composite** — the big one; behind a flag, tested last. Ship.
5. Revisit **task #3** tiering decisions once the above land (sub-main center bubble, etc.).

Each step is independently shippable and independently testable; do not batch them.

---

## 6. Open decisions for Galen
- **Directory shape:** should a maker with only branches (no space) still be a bubble, or is
  a space the entry requirement to appear at all? (Spec assumes bubble-always.)
- **Others' cursor cap** on player worlds — same 25 as the hub, or fewer for perf?
- **Tiering (#3):** does a sub-main get a center "founder" bubble; where do player worlds sit
  relative to sub-mains in the main view?
- **Branch shape:** square confirmed for branches — any distinct treatment for the current
  MAIN holder vs challengers?
