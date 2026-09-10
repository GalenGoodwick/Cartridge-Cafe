# DESIGN — THE BASE MATRIX, subtraction-first

**Status: RATIFIED direction (Galen, Sep 10 2026), building. Rule: no piece
ships without its named proof.** This doc is the clear-understanding artifact;
each piece below carries its proof obligation, and the proofs are artifacts
(traces, PNGs, test files), never claims.

## The thesis

An AI assembling a game from nothing wires something wrong every time (the
tilt-cathedral autopsy: camera inverted, world dark, HUD out of bands, stale
state). An AI SUBTRACTING from a maximal working world almost cannot — you
can't wire input wrong by deleting the weather. So every cell of the matrix is
a **maximal assembly**: everything a game of that shape needs, already wired,
one subsystem per node — and the AI's creative act is **carving it toward the
vision**. Deny-only creation: the function is the remainder. (Kin to Marble.)

## The matrix

|              | 2D                       | 3D (raymarched)          |
|--------------|--------------------------|--------------------------|
| **mobile**   | CELL 1 — build FIRST     | CELL 4 — last            |
| **desktop**  | CELL 2                   | CELL 3 (WORLD3 + grown)  |

One cell is proven END-TO-END before the next begins — the method is the
product; cells 2–4 are then replication. CELL 1 = 2D mobile (portrait 576×1024):
the growth audience, and tilt-cathedral just taught every pitfall fresh.

## The pieces, each with its proof

**P1 — The maximal base world** (per cell). Subsystems, ONE NODE EACH:
`player` (input+movement, both maps: keys + touch) · `camera` (follow/cover) ·
`physics` (gravity/collision helpers) · `entities` (spawner + population
buffer) · `rules` (score/lives/win-lose state machine) · `hud` (ui-solver
bands: hearts, score, pause-safe) · `save` (progress slot) · `audio` (sfx
hooks) · `fx` (juice: shake/flash/particles) · `atmosphere` (the backdrop
visual — never dark by construction). Vision + instructions + card shipped.
> **PROOF P1:** the full pixel-eye ladder on the base itself — state tests per
> subsystem (each node's job asserted tick-by-tick), eye render (bright,
> banded HUD, declared-grid frame), **playthrough trace** (moves, scores,
> loses, restarts — the resurrected local playthrough is the instrument),
> perf under budget on a phone-class cap. Artifacts committed beside the base.

**P2 — The base manifest** (`worldData.baseManifest`). For every node/field/
module: `{ role, desc, removable: true|'load-bearing', deps: [nodeIds],
carveHint }`. The manifest IS the AI's teardown map.
> **PROOF P2:** a conformance test — every hook/field/module in the snapshot
> appears in the manifest and vice versa (drift = red), deps reference real
> nodes, at least one node is load-bearing and at least half are removable.
> (Same discipline as the command registry: the map cannot lie.)

**P3 — Subtraction survives.** The core guarantee: removing any `removable`
subsystem leaves a WORKING world.
> **PROOF P3 (the killer):** an automated harness — for EACH removable node:
> fork the base → remove that node (+ its declared dependents) → run
> playthrough + eye → assert still renders bright, still responds to input,
> no hook errors. One green row per subsystem, committed as a test artifact.
> A base doesn't ship until every removable row is green.

**P4 — Load-bearing teeth.** Carving `player` or `camera` must not fail
silently into a broken world.
> **PROOF P4:** removing a load-bearing node without `force` returns the
> manifest's warning (bridge-side check on remove_step_hook/delete_field when
> a baseManifest marks the target load-bearing); the harness asserts the
> refusal text names the consequence.

**P5 — The door wiring.** Genre chips → base slugs. The ⚿ NEW WORLD prompt
teaches: `create_world {base:"<cell-base>"}` then CARVE — "start from
everything working; tear away what the vision doesn't need; the manifest
names what's safe."
> **PROOF P5:** end-to-end — walk the door's own prompt cold: create from the
> base via the chip's taught call, verify the newborn carries the subsystems +
> manifest, hygiene stripped base-hood, and the fork plays (trace) at tick 0.

**P6 — A carved game.** The method's existence proof: one real game made by
subtraction + a small addition on top (e.g. tilt-cathedral's loop rebuilt
FROM the cell-1 base), timed against what building-up took.
> **PROOF P6:** the finished world, its playthrough trace, and the honest
> count: nodes removed, nodes changed, nodes added, minutes spent — versus
> the two hours tilt's from-scratch build took.

## Laws it inherits (already proven elsewhere)
Never-dark (atmosphere floor) · never-inverted (grid-space y-down / viewbox
mapping only) · HUD in solver bands · declared-grid everywhere (no square
assumptions — the legacy-square sweep rides this program) · nodes law ·
budgets. The base is where these laws live as CODE instead of guide prose.

## Order
1. P2+P3 harness FIRST (the proof machinery — small, pure) →
2. CELL 1 base built subsystem-by-subsystem, each landing with its P1 state
   test →
3. P3 full sweep green → P4 teeth → P5 door → P6 carved game →
4. Cells 2–4 by replication.
