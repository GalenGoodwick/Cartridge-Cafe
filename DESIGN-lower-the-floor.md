# DESIGN — Lower the Floor (give the AI its budget back)

**Why.** Slop is a *budget* problem, not a talent problem. Every AI has fixed
intelligence-per-build; our system makes it spend that budget clearing an
authoring floor (write WGSL for a colored square; re-emit the whole UI tree
every frame for a live meter) before any lands on the actual game. Strong AIs
with headroom left make good worlds; the rest spend everything on plumbing and
ship slop. The games that "really work" (cinderfell, doggo-bounce) stayed in the
well-scaffolded shader/physics lane; the slop is games that reached for the two
high floors below. Both floors have a fix that's ADDITIVE on top of machinery
that already works — not a rewrite.

Sequence: **FIX 1 first** (smaller, wiring already traced), then FIX 2.

Laws that bind this work: **no buggy main** — both touch code every world
compiles/runs, so eye-verify (render_probe / localhost WebGPU / playthrough)
BEFORE any push; **proper-always** — finish the wiring, never ship a half-flag;
**the eye is the WGSL compiler** — a green pipeline compile + a real drawn
frame is the proof, not a passing tsc. Never worktree-isolate core edits.

---

## FIX 1 — Re-enable + fully wire the built-in visual library

**Goal:** `create_field {shape:'circle', color:[1,0,0,1]}` draws a red circle
with ZERO shader code. `visualType:'glow'` (or `ring`/`pulse`/…) works without a
`define_visual`. WGSL stays available for custom looks.

**The finding (verified Sep 7).** A 13-visual built-in library exists —
`solid, circle, glow, ring, eyes, coin, platform, stripe, pulse, gradient,
lava, crystal, plasma` — at `web/src/app/engine/shaders.ts:1298–1601`, but it
was DISABLED at the Unity-Chant→cafe extraction and never re-enabled:
- `export const BUILTIN_VISUAL_WGSL = []` (empty) — the live one.
- The real library sits in `const _BUILTIN_VISUAL_WGSL_DISABLED = [ … ]`.

**What's wired vs not (the crux — it's HALF-wired):**
- WIRED: the composite generator merges `BUILTIN_VISUAL_WGSL` into `mergedTypes`
  and dispatches visuals by id (`shaders.ts:1642` and `:2312`). So if the array
  is non-empty, the built-in WGSL compiles in AND the id-dispatch routes to it.
  (Confirmed: re-enabling and loading localhost with WebGPU → pipeline compiled,
  0 WGSL/Tint errors, canvas rendered. Re-enabling the WGSL is SAFE to compile.)
- NOT WIRED: `renderer.resolveVisualType(name)` (`renderer.ts:4470`) only reads
  the *runtime* `visualTypeRegistry`. Built-in names ('solid'…) are NOT in it,
  so a field asking for `'solid'` resolves to `undefined` → renders NOTHING.
  This is why a naive flag-flip makes it WORSE (a default that resolves to
  nothing but claims a visualType). DO NOT ship the flag alone.

**The unproven risk — id collision.** Built-ins carry ids 0–12. Runtime visuals
get ids from `registerVisualType` (`renderer.ts:4427`). BEFORE building, read how
that assigns ids: if runtime ids start at 0 they collide with built-ins and the
dedup ("first id wins", `shaders.ts:~1648`) will break complex worlds
(veilfire-3d, which registers its own visuals). If they collide, offset runtime
ids above the built-in range (start at 100+), or key dispatch by a namespace.

**The change:**
1. Re-enable: make the export hold the library (rename `_BUILTIN…_DISABLED` →
   `export const BUILTIN_VISUAL_WGSL`, delete the empty one). Mind `const`
   ordering.
2. Wire resolution: register each built-in name→id into `visualTypeRegistry` at
   renderer init (or make `resolveVisualType` fall back to a built-in name→id
   map). Ensure runtime registration still overrides a built-in by name.
3. Guarantee no id collision (see risk above) — verify on a world with runtime
   visuals, not just cinderfell (which registers 0).
4. Default `create_field` to `solid` when `visualType` absent but `color`/shape
   present — `web/src/app/api/engine/space-store.ts`, the `case 'create_field'`
   (~line 391, just before the `skinned`/`shape` block). One line:
   `if (cmd.visualType == null) cmd.visualType = 'solid'`.
5. Guide: `web/src/app/engine/AI_ENGINE_GUIDE.md` Quick Start (~line 9) — LEAD
   with the no-WGSL path: "a colored shape is `create_field {shape,color}` —
   no shader. Built-in looks: solid, glow, circle, ring, pulse, gradient, lava,
   coin, platform, stripe, crystal, plasma. Write WGSL only for a custom look."
   List each built-in's `params` (p.x/p.y meanings) from the shader comments.

**Verification gates (all before push):**
- A field `{shape:'circle', color:[1,0,0,1]}` with NO `define_visual` draws a red
  circle (render_probe or localhost WebGPU screenshot — real pixels, coverage>0).
- Each of the 13 built-in names renders its distinct look.
- veilfire-3d AND cinderfell still render unchanged (no id collision, no compile
  break) — probe both.
- tsc 0 errors, vitest full suite green.

---

## FIX 2 — UI data-binding + a small composed-component vocabulary

**Goal:** an AI declares a HUD ONCE (via bridge), and it stays live as game state
changes — no re-emitting the tree every frame. Common layouts come from named
components, not hand-nested primitives.

**The finding (verified Sep 7).** The UI system is NOT broken and NOT half-wired
on its core path: declare (`worldData.ui`) → solve (`ui-solver.ts`) → render
(glass `renderer.ts:2284`, glyphs `:2330`) → click hit-test
(`FieldEngine.tsx:3560-3622`) → `wd.__uiClick`/`__uiClickT` → hook reads it. The
loop CLOSES. Sliders, buttons, meters, held-touch `key:` controls all
round-trip. The slop is a BUDGET gap, two causes:

1. **No data-binding.** `UiNode.value` is a literal number (`ui-solver.ts:77`),
   `text` a literal string. So any value that CHANGES forces a step-hook to
   REBUILD THE ENTIRE `wd.ui` TREE every frame, duplicating game state into a
   second structure. That doubled bookkeeping is the drain (and the source of
   stale-value / clobber bugs). A pure-shader game skips it: the uniform IS the
   value.
2. **No component library.** Every HUD is hand-assembled from
   `panel/row/col/text/button/meter/spacer/flex` with guessed pads/gaps → uneven
   → slop. Contrast the shader lane's SDF helper library.

**Half-wired notes found (address opportunistically, not blocking):**
- `web/src/app/engine/ui-blocks.ts` (285 lines: `blocksToUi`, `pageToUi`,
  `worldChromeUi` — "chrome as engine pixels") is ORPHANED: called by nothing;
  only two constants are imported from it into `world-chrome.ts:25`, a closed
  dead loop. It's the composition engine to REVIVE for component expansion. Live
  shell chrome is still DOM (`ui-topbar.tsx`, `FieldEngine.tsx:6859+`).
- `UI-SYSTEM.md:22` labels UI-EDIT "(planned)" but it's WIRED
  (`FieldEngine.tsx:6738-6776` write `__uiOverrides`, solver consumes at
  `ui-solver.ts:397-414`). Fix the doc — an AI reading it thinks the channel is
  vapor.
- Clobber seam: the sandbox worker posts its whole worldData each tick
  (`world-sandbox.ts:308`), so a bridge-set static `ui` on a hook'd world can be
  stomped unless a hook republishes (`UI-SYSTEM.md:107` law 3). **Bindings FIX
  this** — declare once via bridge, hooks never touch `ui`, they mutate the
  bound keys.

**The change:**
1. Binding resolution. Add optional `bind?: string` to leaf `UiNode`s
   (`ui-solver.ts:47-83`) and `{key}` interpolation in `text`. The per-frame
   solve at `FieldEngine.tsx:5285-5379` ALREADY runs every frame — resolve
   `value`/`text` from `worldData` THERE at solve time (`{kind:'meter',
   bind:'hp'}` → value = `wd.hp`; `text:"SCORE {score}"` → interpolate `wd.score`).
   Rendering side needs ZERO change. This is the high-leverage half.
2. Composed components. Expose a handful AI-side that expand to the primitive
   tree: `healthBar`, `statRow`, `buttonBar`, `dialog`. Reuse `ui-blocks.ts`'s
   block-compiler pattern (revive it). The UI parallel to `sdCircle` helpers.
3. Guide UI section (`AI_ENGINE_GUIDE.md:~1046-1094` — the recipe is strong,
   keep it) — lead with declare-once + `bind:`, then components, then the raw
   primitive tree for custom.
4. Fix `UI-SYSTEM.md:22` stale label.

**Verification gates (all before push):**
- A meter declared ONCE via bridge with `bind:'hp'` updates live when a hook
  mutates `wd.hp` — prove with `playthrough` over ticks + probe, no per-frame
  `set_world_data`.
- A composed `healthBar`/`dialog` renders correctly.
- Click routing still round-trips (a `button {click:'x'}` reaches a hook).
- tsc 0 errors, vitest green.

---

## After both land

Update the guide so the FIRST thing an AI learns is the low-floor path (colored
shapes without shaders, live HUDs without re-emit), and WGSL/raw-tree are the
"custom" escape hatch — not the default teaching. That reframing is half the
win: the floor being low only helps if the guide leads with it.
