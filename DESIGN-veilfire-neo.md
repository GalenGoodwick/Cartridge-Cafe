# DESIGN — VEILFIRE NEO: the port that proves the methodology

**Status: RATIFIED direction (Galen, Sep 15 2026, after the dark-world
incident): "a new game, this time with proper architecture and methodology.
Methodology must be a hard requirement of the engine for this port — so
methodology first, then bulletproof swarm-editable game architecture, then
porting scrap." Hard ORDER — no stage begins before the prior one is
engine-enforced, not convention.**

## Why Neo exists (the incident as founding autopsy)
A builder's AI cross-cut all 48 of veilfire's hooks with one onboarding gate
(push), deleted the load-bearing s3 visual, and the world went black for
every fresh visitor. Nothing structural prevented any of it. Neo is the same
demon cathedral rebuilt so that failure class is IMPOSSIBLE, not discouraged.
Veilfire-3d stays live as-is (healed) and becomes the SCRAP SOURCE.

## STAGE 1 — METHODOLOGY AS ENGINE LAW (hard requirement, first)
All already live or one rung away — Neo refuses to start until each is
enforced on its world:
- **Phase docks** (live): creation earns VISION→…→TEND; verbs outside the
  docked phase refuse. Neo is BORN docked.
- **Triage accounting** (live): the scrap bay rides dockstarBay/triage —
  born inventory ≡ ledger, bay empty at ship, server-computed.
- **Gates** (live): visual-gate first · node-green · performance (live tab)
  · no-live-bugs · real-tab rung.
- **PULL BINDING (to build — the one new engine piece)**: node records gain
  `uses: [profileIds]`. THE ROOM CALLS; PROFILES ANSWER; a profile pulled by
  nothing is inert and shows as a leftover. Conformance: a hook that reads
  state owned by a profile it doesn't `use` gets flagged (owns-guard family).
  Push patterns (one node early-returning others, cross-node injection) have
  no grammar to exist in.
- **Swarm safety** (live): per-node claims + P4 load-bearing teeth + owner
  notes + version history/undo. Blast radius of any edit = one node.

## STAGE 2 — THE ARCHITECTURE (bulletproof, swarm-editable)
The node grammar — extremely granular, nodes applied to nodes by PULL:
- **Room nodes** — one per room (nave, warren, crypt, tomb, arena, city…):
  its SDF piece, palette, bounds, and `uses:[...]` — the COMPLETE truth of
  that room readable in one node.
- **Profile nodes** — physics-stone, physics-water, law-timecell, spawn
  tables, atmosphere grades: inert until a room pulls them.
- **Entity nodes** — one per creature (demon, lurker, sentinel, orb,
  dragon, crucifix): brain + body SDF module + declared lanes.
- **Event nodes** — door, key/lock, ambush, boss-wake, onboarding: bound to
  their room via that room's `uses` — The Quiet Approach done right is one
  node pulled by the entrance room only.
- **Global fact nodes** — player-start (one transform), base-state, save.
  As small as a single fact; that IS the granularity.
- **The spine** — player, camera, uplink: load-bearing, manifest-marked.
- Lane registry via register_node owns (exists) — every uniform lane has one
  owner; the whiteboard cannot be fought over.

## STAGE 3 — THE PORT (scrap → Neo, node by node)
- The healed veilfire-3d full source (the 496KB dump is in hand) is decomposed
  into the SCRAP BAY: every visual, module, hook fragment enters
  dockstarBay.born as `scrap-*` items with role labels.
- Rewrite node by node through the phase docks: write a Neo node → triage
  the scrap it supersedes as `moved` (or `deleted` with the reason — cut
  content is a decision on the record).
- **Interpretation is licensed**: faithful to the spirit (the nave's dread,
  the burning five, the time-cell laws), free on the letter — this is a
  port of a GAME, not a transliteration of code.
- Ship gate: ZERO scrap remaining · every node green · full ladder · the
  live measurement · the human word. At the end there is no scrap and there
  is a working game — the claim is unfalsifiable from the ledger.

## Order of work
1. Pull-binding engine piece (`uses` on node records + inert-profile
   leftover check + conformance flag) — small, testable offline.
2. Neo world born THROUGH the docks (VISION first: the Neo vision doc).
3. Architecture skeleton: spine + first room (the nave) end-to-end through
   every gate — the vertical slice that proves the grammar.
4. Scrap bay loaded from the dump; the port proceeds room by room.
5. Veilfire classic stays live throughout; Neo ships beside it.

## PORT LAWS (paid for Sep 16, the renderScale miss)
- **The scrap inventory is the WHOLE world doc.** Hooks, modules, visuals,
  fields, interaction rules, AND every durable worldData key (tuning, config,
  progression baselines). The triage gate verifies born ≡ ledger — it cannot
  see territory the loader never declared. A port therefore always runs a
  PARITY DIFF: source doc vs bay coverage; any element uncovered = red.
  (The miss: classic's renderScale 0.28 / maxBufferPixels / noPixelSampling /
  postProcess never entered the bay — Neo shipped at ~13x the pixel cost and
  the gate stayed green. 21 keys were late-born and accounted.)
- **Scrap is a sketchpad (Galen).** Scrap items may be AUTHORED, not just
  ported: stream-of-thought code, drafts, half-ideas — never executed, never
  required to compile. The bay tolerates broken text because scrap never
  runs. The accounting still holds: every sketch eventually MOVES into a real
  node or is DELETED with its reason. Thinking in code becomes first-class
  and tracked, without polluting the world.
