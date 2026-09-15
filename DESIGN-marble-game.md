# MARBLE — the representative game of the Dockstar workbench

**Status: SPEC (Galen, Sep 14 2026: "spec out a representative game model
with the kind of graphics that could run on an iPhone 14 — gorgeous,
exploiting every advantage this engine has. This is Marble. A node-carvable
game world. Node carving with 0 primitive layover is directly
unfalsifiable.")**

## Why this game

The engine's whole doctrine is subtraction: bases you carve, primitives you
triage, a language where the function is the remainder. MARBLE makes the
doctrine playable — **a game about carving stone, built by carving nodes, on
an engine that renders by carving space with rays.** The method and the
fantasy are the same shape. And the method claim is *directly unfalsifiable
in the good sense*: the shipped world carries its bridge-attested triage
ledger (bay empty · nodes green · born-inventory ≡ ledger), and the code
library shows every node — anyone can verify "this was made by moving
things over," no trust required.

## The fantasy

You are **the last chisel-light** — a warm spark drifting through a buried
temple of living marble. The stone is veined, translucent at its edges,
lit by shafts falling through cracks far above. The statues are already
inside the stone; your only verb removes what isn't statue. Carve passages,
let the light pour into spaces that have been dark for a thousand years,
and free the buried figures. When the last figure stands in open light, the
temple sings.

**Core loop:** drift → read the veins (they thicken toward buried figures)
→ press-and-hold to carve (SDF subtraction blooms under your light) → light
shafts break into the newly opened space → free the figure → the freed
figure's plinth lights a path deeper. 3 figures per chamber, 3 chambers.
Hearts: careless carving drops ceiling dust-falls (the stone answers);
three answers end the run at the last plinth.

**The plaque room** (the AI-accounting showcase): the entry chamber's wall
carries the world's own `__triage` ledger carved as inscriptions — every
primitive's fate, moved or deleted, readable in-game. The build method IS
an exhibit.

## The graphics — every advantage the engine has, iPhone-14 honest

All of these are proven on-engine (veilfire-3d mega-shader, mesh-SDF bake,
FCB persist targets) — MARBLE composes them, it doesn't invent:

1. **SDF geometry as sculpture.** Chambers are smooth-min blends of a few
   large primitives — marble FLOWS. Colonnades by domain repetition (one
   pillar SDF, infinite cost-free copies). Buried figures = the mesh→SDF
   bake pipeline (real sculpted silhouettes, first proven on /space/first-mesh).
2. **Carving = SDF subtraction, live.** The player's carve verb appends
   subtraction spheres to a capped lane bank (64 ops/chamber, oldest
   smooth-merge into a baked chamber mask on overflow). Your sculpture
   persists via the save node — re-enter and your tunnels remain.
3. **Veined marble material.** Triplanar fbm ramped through a two-stone
   palette (warm calacatta / cold basalt); veins are a 3D noise ridge —
   nearly free, reads as luxury.
4. **Translucency (the hero effect).** Single-scatter approximation: at
   each surface hit, one short ray marches INTO the stone toward the key
   light; exponential falloff → thin edges and fresh carve-lips GLOW. This
   is the shot that sells the game and raymarching does it for pennies.
5. **SDF ambient occlusion** (5-tap) + **soft shadows** (cone-traced, one
   light) — stone reads as mass, not surface.
6. **Volumetric shafts + dust.** The veilfire god-ray/lantern pieces as
   primitives; gpuPopulation dust motes drift only inside lit volumes —
   carving a ceiling literally pours light-and-dust into the room.
7. **Polish sheen.** Fresnel + gradient environment (no second bounce);
   freed figures get the one specular light — they read as finished marble
   against the rough walls.
8. **One camera.** worldData.__camera (drift-follow + carve-kick shake via
   the camera, never a paint offset — pixels≡hitbox holds in 3D: the ONE
   SDF the ray marches is the SDF collision reads).

### iPhone 14 budget (A15, 60fps target — frame-rate eye law applies)
- renderScale ~0.7 portrait (≈ 810×1750 marched), full-res HUD/UI
- march caps: 72 steps world, 24 steps scatter ray, 12 steps shadow cone;
  early-exit on ε; per-chamber bounding volume so rays never march the
  whole temple
- SDF piece budget: ≤ 12 live fields/chamber + 64 carve lanes + 2 figures
- ONE dynamic light + fixed sun; volumetrics only in declared shaft volumes
- ship gate: `render_probe frameCost` ≤ 14ms on the software-GPU proxy
  budget line, then REAL-TAB on-device check before publish (the Map-shape
  lesson: no green without a real screen)

## The node anatomy (all carvable, zero primitive layover)

Every subsystem one node, assembled from the Dockstar bay by the MOVE verb;
bay ends EMPTY, `__triage` complete:

- `player` — drift movement (touch stick + drag-look) + the carve intent
- `world` — physics against the ONE SDF (walk/float, carve-op application,
  dust-fall answers)
- `entities` — buried figures, dust golems, mote spawner
- `rules` — figures freed / hearts / chamber gates / temple-sings win
- `hud` — hearts, figures n/9, chamber name (wx/wy bands)
- `camera` — drift-follow + carve-kick (worldData.__camera only)
- `fx` — chisel sparks, glow pulses on free
- `audio` — chisel ring, stone hum, the choir on win
- `save` — carve lanes + freed figures persist (your sculpture remains)
- `uplink` — packs lanes (player light, carve ops, figure states), clears
  events, runs last

Removable set (the base-matrix guarantee holds): entities/rules/hud/fx/
audio/save each carve out to leave a working quiet cave-carving toy — the
harness proves every row.

## Ship gates
W-series gates (bay empty · nodes green · ledger complete) + full ladder:
state tests per node · eye (bright, banded HUD) · playthrough trace (carve →
free → win → restart) · frameCost budget · **real device tab**. Publish
carries vision + instructions (off-grid law) + the plaque room live.
