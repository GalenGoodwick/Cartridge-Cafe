# DESIGN — THE DOCKSTAR WORKBENCH (3D ray superimposition, triage-complete)

**Status: DRAFT (Galen's ask, Sep 14 2026: "a matrix for Dockstar's hackable
mobile space — loaded with primitives, AI deletes code / organizes it into
nodes; all nodes green, all primitives deleted — the AI's job is simply to
move things over. AI accounting." Substrate ruling: "not 2D — FIELD ENGINE
with 3D ray superimposition. That's the best.") Awaiting ratification; no
piece ships without its named proof.**

## The thesis

The base matrix proved subtraction: carve a working game toward a vision.
The workbench proves **triage**: a space is born LOADED — a bay of small,
working, demonstrable primitives — and the AI's whole creative act is moving
each piece into its node or deleting it. Ship is refused until the bay is
EMPTY and every node is GREEN. The two chronic AI failures are structurally
impossible here: hand-rolling what already exists (the primitive is sitting
in the bay — move it), and abandoned fragments (nothing untriaged can ship).
Deny-only creation again: the game is what survives triage. (Kin to Marble,
and to the carve-merge skill's fragment law.)

## The substrate — FIELD ENGINE + 3D RAY SUPERIMPOSITION

The engine's field system carries the 3D world: each geometry primitive is a
FIELD contributing an SDF piece, and the renderer raymarches their
SUPERIMPOSITION (the veilfire-3d composition, generalized). The law this
completes:

**ONE SDF IS BOTH THE PICTURE AND THE COLLISION.** The map function the ray
marches is the same field set the physics hook reads (sim.fields — geometry
already exposed to hooks since ce80959c). Veilfire's known divergence
(painted map vs coarse collision tables) becomes impossible by construction —
the 3D pixels≡hitbox law. No shadow tables, no private cameras
(worldData.__camera / uni-lane camera owned by ONE node), never-dark,
never-inverted, declared-grid: all inherited as code.

Mobile-first: portrait/landscape declared, touch controls in the bay
(stick-move + drag-look; tap = act), HUD in wx/wy solver bands.

## The mechanic — TRIAGE + AI ACCOUNTING

- Born world = the node spine (player · world/physics · entities · rules ·
  hud · camera · fx · audio · save · uplink, all green at birth) + THE BAY:
  `prim-*` entries (hooks, SDF fields, visual modules), every one RUNNING and
  demo-able in isolation, each manifest-labeled: role, suggested target node,
  lane/SDF contract, graft hint.
- Build act = for EVERY primitive: **MOVE** (graft its logic into the right
  node, delete the prim in the same bridge act) or **DELETE** (discard, with
  reason). One verb, atomic — nothing silently lost.
- **AI ACCOUNTING**: worldData.__triage is the ledger — every primitive's
  fate (`moved → <node>` | `deleted: <reason>`, by whom, when). The ledger is
  append-only and publish-checked: bay ∪ ledger must equal the born
  inventory, exactly.
- Ship gate (bridge-enforced): `bay empty` AND `all nodes green` AND
  `ledger complete`. brief_done/publish otherwise refuse, speaking the exact
  leftover list.

## The bay load-out (first cut, 3D mobile)

- **Geometry (SDF fields)**: room, corridor, pillar grid, terrain patch,
  stairs/ramp, door/arch, water plane — each a field with its SDF module
- **Movement**: FPS walk (touch stick + drag-look), fly/orbit, rail glide
- **Entity brains**: patroller, chaser, orbiter, spawner-wave — nav in the
  same SDF space (entitiesIn/spaceOf style queries)
- **Interactions**: collect, key/door, checkpoint, hurt/hearts, timer, goal
- **Projectiles**: tap-fire bolt, lob, beam
- **Light/atmo**: lantern cone, god-rays, fog band, day/dusk grade
  (the veilfire volumetric pieces, made primitives)
- **HUD**: hearts, score, timer bar, end screens (wx/wy bands)
- **FX**: hit flash, trail, shake-via-__camera
- **Audio**: event → sound-id map
- **Save**: progress slot

## The pieces, each with its proof

**W1 — The loaded bay + inventory manifest.** Every primitive present,
labeled, and RUNNING.
> **PROOF W1:** per-primitive isolation test (statetest-style: each prim
> ticks alone against the spine without errors and does its one job) + bay ↔
> manifest conformance (the map cannot lie) + eye render of the born world
> showing the demo lane bright.

**W2 — The triage ship-gate.** Publish refuses while the bay is non-empty or
the ledger is incomplete.
> **PROOF W2:** publish with leftovers → refusal naming them verbatim;
> triage everything → publish passes. Gate is registry-driven, bridge-side.

**W3 — Node-green harness.** Per-node contracts asserted tick-by-tick; the
carve harness runs on the organized result (removable nodes still carve
clean — the workbench output IS a base-matrix world).
> **PROOF W3:** all-green run committed; one deliberately broken node → red.

**W4 — The MOVE verb (AI accounting).** One atomic bridge act: graft + prim
delete + ledger append.
> **PROOF W4:** after a full build, born-inventory ≡ ledger exactly; a prim
> deleted outside the verb is refused (accounting cannot be bypassed).

**W5 — One-SDF collision.** The physics node collides against the SAME
fields the ray marches.
> **PROOF W5:** move a geometry field live → the eye shows the wall moved
> AND the state trace shows collision at the new surface; no second table
> exists to drift (grep-proof: no coordinate literals duplicated between
> visual and physics).

**W6 — The door + the existence proof.** Dockstar chip teaches the triage
law; one real 3D mobile game built purely by moving things over, with the
honest ledger (moved / deleted / minutes) — the P6 role, absorbed.
> **PROOF W6:** the finished world, its playthrough trace, its __triage
> ledger, and the time count vs a from-scratch baseline.

## Laws inherited (as code, not prose)
Pixels ≡ hitbox (now: SDF ≡ collision) · one coordinate owner
(worldData.__camera) · never-dark · never-inverted · wx/wy HUD bands ·
declared grid · nodes law · manifest classes (load-bearing / removable /
**must-triage**) · P4 teeth · real-tab rung before any ship (the Map-shape
lesson: the eye's sim is not the browser's sim).

## Order
1. W2 gate + W4 verb + manifest class FIRST (the enforcement machinery —
   small, pure, testable offline) →
2. W1 bay built primitive-by-primitive on the 3D spine (veilfire-3d pieces
   extracted into primitives; each lands with its isolation test) →
3. W3 harness green → W5 one-SDF proof → W6 door + carved-by-triage game →
4. Replicate the workbench pattern back over the 2D cells.
