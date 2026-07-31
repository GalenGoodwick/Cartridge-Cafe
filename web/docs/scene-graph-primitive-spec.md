# `sim.defineScenes` — a scene-graph engine primitive

**Status:** spec / not built · **Author:** Claude Fable 5 (with Galen) · Jul 30 2026
**Proven consumer:** tideglass (`scenes/tideglass-cartridge.mjs`) — its hand-rolled
view system is the pattern this primitive generalizes.

---

## 1. What this is (and is not)

A **scene** here means a *view / room / chapter INSIDE one world* — the shore, the
gate, the record room in tideglass — not a cartridge. Cartridge loading
(`handleLoadScene`, the store) is a separate layer and is untouched. This primitive
is about **navigation and state WITHIN a single running world**: a first-class scene
graph that the engine owns, so a world author declares *where you can go and when*
as **data**, and the engine derives clicks, drawn exits, transitions, and validation
from that one declaration.

## 2. Why — the pain it removes (all real, all from tideglass)

Today every stateful world hand-rolls the same machinery in its step hook:

1. **A view integer + prevView + fade** manually packed on the whiteboard
   (`U[0]=view, U[1]=pv, U[2]=fade`) and hand-decayed each frame.
2. **`go(v)` / `inView(v)` boilerplate** — reimplemented per world, each with its
   own fade threshold and transition sound.
3. **Hit-zones coded TWICE and drifting apart.** The hook click-tests
   `if (hit(487,256,45)) go(4)`; the shader *separately* draws a chevron at what is
   *supposed* to be the same spot (`// nav chevrons (hook mirrors these hit zones)`).
   Nothing enforces the match → **invisible doors** (a drawn chevron with no hit
   zone, or a hit zone with no chevron). This exact class cost us hours in the
   tideglass bones work.
4. **Overlap bugs.** Two zones 64px apart both fired (`go(5)` then `go(1)`, "finale
   bounced back to the shore") until hand-patched into nearest-first `else-if`.
5. **No validation.** Nothing catches an edge pointing at a nonexistent view, a
   scene you can never reach, or a dead end with no way back.

The primitive makes **exits data**, drives **both** the click test and the drawn
chevron from that one source (invisible doors become *impossible by construction*,
the same law as the world-swap config whitelist), and folds view+fade+transition
into the engine.

## 3. The API surface

Available on the `sim` object inside a step hook (same place as `sim.edge`,
`sim.getFieldAtPoint`). Called **once**, on first hook tick (idempotent):

```js
const scenes = sim.defineScenes({
  start: 'shore',
  fade: 0.35,                 // default cross-fade seconds (per-edge overridable)
  transitionSound: { frequency: 90, duration: 0.35, volume: 0.18, type: 'sine' },

  // ── named boolean/number state the graph can gate on ──
  state: {
    vaultRisen: false,
    latticeSolved: false,
    doorOpen: 0,              // numbers allowed (0..1 charges, counts, etc.)
  },

  scenes: {
    shore: {
      exits: [
        // a click zone AND (optionally) a drawn chevron come from THIS ONE row.
        { to: 'gate',  zone: { x: 440, y: 300, r: 62 } },                 // building = door in
        { to: 'dome',  zone: { x: 214, y: 318, r: 80 }, when: 'vaultRisen', // gated edge
          chevron: { dir: 'up' } },
      ],
    },
    gate: {
      exits: [
        { to: 'shore',  zone: { x: 25,  y: 256, r: 45 }, chevron: { dir: 'left' } },
        { to: 'record', zone: { x: 487, y: 256, r: 45 }, chevron: { dir: 'right' } },
        { to: 'hall',   zone: { x: 256, y: 184, r: 75 }, when: s => s.doorOpen > 0.9 },
      ],
    },
    // …record, hall, dome, core
  },
})
```

### What `defineScenes` returns / owns each tick

- `scenes.view` — current scene **id** (string) and `scenes.viewIndex` (stable int
  for the shader). `scenes.prev`, `scenes.fade` (1→0) handled by the engine.
- `scenes.go(id)` — transition (guards same-scene, sets prev/fade, plays the sound).
- `scenes.in(id)` — the settled-`inView` guard (`view===id && fade < threshold`).
- `scenes.state` — the live named state object; mutate it (`scenes.state.doorOpen = 1`)
  and gated edges update automatically.
- **Clicks are handled by the engine**: on a click, the engine tests the *current*
  scene's `when`-passing exits (nearest-first, so the overlap bug is structural-fixed)
  and calls `go` for you. The hook still gets `onEnter(id)`/`onExit(id)` callbacks
  for puzzle side-effects.

### What reaches the shader (the anti-invisible-door contract)

The engine packs, into a **reserved whiteboard block**, for the current scene:
`viewIndex, prevIndex, fade`, and **the live exit zones** (x, y, r, dir, enabled).
A tiny provided WGSL helper — `scene_chevrons()` — draws the standard chevron at
each *enabled* exit that declares one. A world that wants custom art reads the same
zones and draws its own, but **the drawn thing and the clickable thing are the same
row**. An exit with a `zone` but no reachable `when` simply doesn't draw and doesn't
click — together, never apart.

## 4. The state model

- `state` is a flat map of named booleans/numbers, seeded at define time, persisted
  through `wd.save` when the world opts into per-player save (composes with the
  existing save architecture — scene id + state IS the save payload for a puzzle
  world).
- Edge gating: `when` is either a **state key** (truthy check) or a **predicate**
  `(state) => bool`. Re-evaluated each tick so doors open/close live.
- `onEnter(id, state)` / `onExit(id, state)` hooks for chapter side-effects
  (kick a sound, arm a timer, set `music_mod`).

## 5. The validator (build-time + a dev-mode runtime pass)

Run when the cartridge is baked (`node <cartridge>.mjs`) and once on first tick in
dev. Reports, never silently drops:

- **Undefined target:** an `exit.to` naming a scene not in `scenes` → error.
- **Unreachable scene:** graph walk from `start` over *all* edges (ignoring `when`);
  any scene with no inbound path → warning (probably a typo or orphan).
- **Trap scene:** a non-terminal scene whose only exits are all permanently
  `when:false`, or a scene with zero exits not marked `terminal: true` → warning
  ("no way back from `core`").
- **Zone collision:** two exits in the same scene whose zones overlap by > X% →
  warning (the tideglass finale bug, caught at author time).
- **Off-canvas zone:** a zone center outside 0..512 → warning.

Output is a small report object the bake step prints; nothing blocks the build (a
WIP graph must still run), but the author sees every hole.

## 6. Rendering integration

- **Reserved whiteboard slots.** The scene block claims a fixed, low index range
  (say `uni(0..2)` view/prev/fade + `uni(N..)` for up to K exit rows), documented
  as off-limits like the cafe hub's header. This dodges the 256-float ceiling by
  capping K (≈8 exits/scene is plenty) and keeps the rest of the whiteboard for the
  world.
- **`scene_chevrons(uv, t)`** — a provided WGSL module (opt-in, like
  `mod_playerglyph`) that renders the standard hover-glowing chevron at each enabled
  exit. Worlds that draw their own doors ignore it but still read the zones.
- The engine already owns the fade crossfade timer; the world's uber-visual keeps
  its `mix(sceneA, sceneB, fade)` shape but reads engine-provided `fade`/`prev`
  instead of hand-decaying them.

## 7. Migration — tideglass is the reference port

1. Land `defineScenes` behind no flag (additive; nothing uses it yet).
2. Port tideglass: replace its hand-rolled `view/pv/fade/go/inView` and the
   per-view `if (hit(...)) go(...)` blocks with one `defineScenes({...})`. Delete the
   shader's separately-authored chevron coordinates; switch to `scene_chevrons()` or
   read the reserved zones. **Success = the invisible-door class is gone and the
   playtest is pixel-identical.**
3. Second consumer (ESPERS or a hub sub-view) to prove it generalizes past tideglass.
4. Only then consider it stable and document in the world-authoring guide.

## 8. Open questions (need Galen's call)

- **A) Scene-local vs world-global fields.** Do scenes ever need to add/remove
  *fields* (not just branch a visual), like a cartridge swap does? Tideglass uses one
  fullscreen field branching by `view` — cheap, no field churn. If some world wants
  per-scene fields, that's closer to a mini-`handleLoadScene` and a bigger build. I'd
  **start visual-branch-only** (tideglass's proven shape) and add field-swap later
  only if a real world needs it.
- **B) Transitions beyond crossfade.** Just `fade` to start, or do we want
  slide/iris/cut as declared transition types? I'd ship `fade` + `cut` and add more
  when asked.
- **C) Does the primitive own the BACK affordance** (auto-add a "back to previous
  scene" edge), or stay fully explicit? Tideglass draws its own back chevrons; I lean
  **explicit** (no magic edges) to keep "exits are exactly what you declared."
- **D) Nested graphs / sub-scenes** (a puzzle-within-a-room) — defer; flat graph
  covers every case we have.

## 9. Non-goals

- Not replacing cartridge/scene *loading* (`handleLoadScene`, the store).
- Not a general state machine / behavior tree — it's navigation + gated exits, sized
  to what worlds actually need.
- Not multiplayer scene sync (single-player / per-player only for v1).
