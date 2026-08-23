# BASE ARCHETYPES — engine, no level

A base is a totally flat playable substrate: all the code behind the engine
(physics, input, camera, weather, entity systems with EMPTY rosters), zero
level design. Bases carry `worldData.__base = true` + a card, appear as TABS
on the card main, and groups FORK them into their own worlds.

- `base2d-*` — PLATFORMER 2D BASE: the cinderfell engine flattened
  (mod_cf_h/terrainH → 0, the ONE TRUTH; FOES roster empty, doors/beacons/
  chapters stripped; run/jump/grab-fling/wind/camera kept). Deployed via
  bridge; these files are the bootstrap record, the live world is the truth
  (cafe-worlds-via-bridge law). NOTE: the visual ships with cf_lib INLINED —
  the fx pipeline composes visuals without modules.

- `blank2d-*` — BLANK 2D: the dimension substrate beneath the 2D bases. A
  WORKING empty world: input (keys + touch — mobile-ready from birth, declares
  card.mobile), easing camera, edge clamps, one breathing avatar dot. The
  fork-tree root for 2D (blank-2d → platformer-2d-base → games).

TODO next: BLANK 3D · 3D base (veilfire-doom engine) · arena-io (bloop) ·
puzzle-adventure (tideglass) · arena multiplayer wiring (mpManifest).
