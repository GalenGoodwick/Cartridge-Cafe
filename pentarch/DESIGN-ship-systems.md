# DESIGN — PENTARCH advanced ship systems (v2)

*Jul 31 2026, Galen's spec, formalized. Extends the proven base (penta-core geometry,
edge+ce tree, battle-engine). Every subsystem = a render-free .mjs module with tests
BEFORE it touches the live designer (proper-always law).*

## Galen's spec, verbatim intent
- Turret **with arc**; weapon **placed on** the turret
- Energy **generation** + **batteries**
- **Propulsion types**
- **Rotation of parts** affecting turning physics / **strafing** / speed
- Click to **direct ship over a curve**; click-**hold to draw a route** — which
  **calculates what is possible**

## 1 · Part orientation (the new fundamental)
Every part on a tile has an ORIENTATION `o ∈ 0..4` — one of the pentagon's five
edge-normals (re-tap a placed part to cycle it; designer shows a direction tick).
Orientation is data on the tree node (`{part, o}`) beside `edge`/`ce` — survives
save/branch/battle identically to shape.

## 2 · Turrets & weapons (two-layer mounts)
- **TURRET** is a part occupying a tile: defines traverse ARC + turn rate + mount class.
- Its arc is EARNED BY PLACEMENT: centered on the mean outward normal of the tile's
  FREE edges, width = `base_arc × free_edges` (interior turret ⇒ sliver arc; a tile
  on a spine tip with 4 free edges ⇒ near-360). Hull curvature literally shapes
  firepower — same law as edge-normal guns, deepened.
- **WEAPON** slots ONTO a turret (select turret → weapon palette): defines range,
  damage, energy/shot, projectile type. Turret without weapon = dead mount; weapon
  needs a mount (no bare hull guns in v2 — the old GUN becomes FIXED mount: arc 0,
  cheap, fires along its orientation).

## 3 · Energy: generation → batteries → consumers
- GEN: +P/s. BATTERY: capacity + max charge/discharge rate. Consumers: weapons
  (energy/shot), thrusters (drain while burning), future shields.
- Tick: gen fills batteries → consumers draw from (gen + battery discharge cap).
  Sustained deficit ⇒ BROWNOUT (weapons fire at half rate — inherits the proven
  rule) and thrusters at 70%. Batteries make ALPHA STRIKES possible (burst > gen)
  — a real design axis: glass cannon = big weapons, small gen, big batteries.

## 4 · Propulsion types (orientation is destiny)
| part | thrust | torque | drain | role |
|---|---|---|---|---|
| MAIN thruster | high, along `o` | via lever arm | high | speed |
| JET (maneuvering) | low, fast response | via lever arm | low | strafe/turn |
| GYRO | none | pure ± torque | med | turn without drift |

## 5 · Physics (phys.mjs — the load-bearing math)
- mass `M = Σ part.mass`, COM = mass-weighted centroid, inertia `I = Σ mᵢ·rᵢ²`.
- Each thruster t at tile pos `pᵢ` (rel. COM), direction `dᵢ` (its orientation's
  edge-normal), max force `Fᵢ`: force `= u·Fᵢ·dᵢ`, torque `= u·Fᵢ·(pᵢ × dᵢ)`,
  throttle `u ∈ [0,1]`.
- **Allocation:** given desired (fwd, lat, turn) command, solve throttles by
  projected least squares (greedy per-thruster contribution — game-grade, tested).
- **Mobility envelope** (derived, shown in designer stats):
  `a_fwd`, `a_lat` (STRAFE — only exists if jets point sideways), `α` (angular).
  Rotating one part visibly changes these numbers — the designer teaches physics.

## 6 · Route command (route.mjs)
- **Click** a point → generate a feasible curve to it (arc-line, curvature-capped)
  and follow with the allocator.
- **Click-HOLD** → draw a polyline route. The system fits WHAT IS POSSIBLE:
  max curvature at speed v is `κ_max = min(a_lat_max/v², α-limit)`; a speed
  profile slows the ship into corners tighter than the envelope
  (`v ≤ √(a_lat_max/κ)`). Render BOTH: the drawn wish (ghost) and the feasible
  fit (solid) — the gap IS the feedback that teaches your hull's handling.

## 7 · Harvest from pentarch-stage (all render-free, all tested)
battle 34 · designer 45 · chrome 21 · lobby 7 · menu 7 · debrief 7 · finder 6.
Screens (menu/finder/lobby/debrief) = the Istrolid flow, wired later onto v2 base.

## Build order (each lands green before the next)
1. `phys.mjs` — COM/inertia/wrench/allocation/envelope + tests ← START
2. `energy2.mjs` — gen/battery/brownout tick + tests
3. `turret.mjs` — free-edge arc derivation + traverse + tests
4. `route.mjs` — curvature fit + speed profile + tests
5. parts catalogue v2 (orientation + new kinds) — extend parts.mjs, keep 12 tests green
6. designer UX: orientation tick + cycle-on-retap, turret→weapon two-layer palette
7. battle: allocator-driven steering, click/hold route input
