# VIGIL — build outline

*Worktree: `cafe-vigil-wt` (branch `vigil`). Edit here only; never the shared checkout (clobber law).*

## Concept — "seeing is touching"

A cathedral-scale dark. You carry a **flame** (KINDLE echo). Stone **Watchers** sweep slow
**gaze rays** through the black. The transept floor is a **chasm**; the only footing is
**panes of stained glass that exist only where a gaze currently falls on them.** Look away →
the pane winks out → you drop.

**The queer mechanic:** when your flame's **light-ray** and a Watcher's **gaze-ray** intersect
*inside a pane*, that pane's rule **flips** — solid-floor→passable-door, wall→bridge, and in
some cells **gravity inverts** and you fall *up* to the next tier. You don't avoid the gaze;
you *aim* it, positioning so their sweep crosses your own light on the pane you need.

Goal: cross the nave to the reliquary by arranging ray-crossings.

## Mechanic → substrate map (the thesis under test)

| Mechanic | Primitive | Layer |
|---|---|---|
| Watcher gaze | broadcast ray, marched vs world SDF | ray = render march |
| Pane exists-where-seen | effect-plane drawn+collidable only where a ray crosses it | render = collide = perceive, one query |
| Flame light | another broadcast ray | same primitive |
| ray ∩ ray ∩ pane → rule flip | intersection fires a rule that rewrites the pane's mechanic | mechanics-as-data (step hook + worldData) |
| Cheap detection | 2D plan overlap = broadphase → 3D ray-vs-pane narrowphase | two-phase |
| Vertical cathedral | panes on different `z` tiers | field `z` (already in FieldTransform) |

**One marched ray does four jobs: draw, collide, perceive, trigger-mechanic.** That is the
claim VIGIL exists to prove.

## Architecture — what's reusable infra vs cartridge-specific

Galen's law: *land reusables as platform infrastructure; unit-test new math before ship.*

**Reusable math lib** (`web/src/lib/gaze-math.mjs`) — pure, dependency-free, unit-tested:
- `rayPlaneHit(ro, rd, planePoint, planeNormal)` → t or null (ray vs bounded plane)
- `raysClosestApproach(aO, aD, bO, bD)` → {distance, midpoint, tA, tB} (do two gaze rays cross?)
- `pointInPaneUV(hitPoint, pane)` → bool (did the crossing land *inside* this pane's quad?)
- `marchSDF(ro, rd, sdf, maxT, eps)` → {t, hit, p} (JS-side gaze march for logic; mirrors the
  WGSL march so shader and logic share one truth — the `mod_cf_h` discipline)

These are geometry primitives every future ray/trigger world reuses. Tests in
`web/src/__tests__/unit/gaze-math.test.mjs` (foot-drift-style exactness: analytic cases with
known answers, 1e-9 tolerance).

**Cartridge-specific** (`web/src/app/engine/scenes/vigil-cartridge.mjs`):
- WGSL: SDF cathedral (Antichamber-adjacent unlit white + linework), Watcher forms, panes,
  the gaze-march visual, flame light.
- JS step hook: each frame — sweep Watcher gaze rays, march vs the shared JS SDF, test
  ray∩ray∩pane via gaze-math, and on a crossing write the pane's flipped rule into worldData.
- worldData game holders: pane states, tier, win condition, reset key.
- Input: pointer → flame position/light direction; movement across lit panes.

## Build phases (fill-in order, each landed + verified)

1. **Math lib + tests** — write `gaze-math.mjs`, exhaustive vitest unit tests, `npm test` green.
   *Nothing ships until the math is proven.*
2. **Cartridge skeleton** — minimal `vigil-cartridge.mjs` in engine idiom: SDF cathedral visual,
   one Watcher, one pane, camera, flame. Renders.
3. **Gaze + exists-where-seen** — Watcher gaze ray both drawn and gating pane visibility from the
   SAME march. Pane appears only under gaze.
4. **Rule-flip engine** — step hook wires ray∩ray∩pane (via gaze-math) → worldData rule rewrite.
   Floor→door demonstrated.
5. **The game** — chasm, multi-pane path, gravity-flip tier, reliquary win, reset key.
6. **Verify** — headless playtest (drive the flame, observe a pane light + a rule flip), then
   ship to `/space/vigil` as Galen on explicit word.

## Honest boundary (deferred — NOT in v1)

The design's dynamics-heavy corners — the *believable falling arc* under gravity-flip, and the
*swinging chandelier* that redirects a Watcher — need a real solver (XPBD), not the trigger
substrate. v1 uses discrete/tweened motion for the fall and omits the chandelier. Flagged here so
"trigger-substrate carries the world" is an honest claim about the 90%, with the 10% named, not
hidden. XPBD-over-SDF is the follow-on module.

## Status
- [x] Worktree + outline
- [x] gaze-math.mjs + tests — **23/23 vitest green** (rayPlaneHit, raysClosestApproach, pointInPaneUV, marchSDF, gazeCrossOnPane)
- [ ] cartridge skeleton
- [ ] gaze / exists-where-seen
- [ ] rule-flip engine
- [ ] game + win/reset
- [ ] headless verify → ship on Galen's word
