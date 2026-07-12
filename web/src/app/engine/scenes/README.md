# Scenes

WGSL visual types authored by Claude Fable (Jul 2 2026). Each file is a complete
`fn visual_NAME(uv, sdf, col, time, p, behind) -> vec4f` for the superimposed
uber-shader path.

## fable-vista.wgsl — `fable_vista`
Golden-hour mountain lake. Raymarched eroded-fractal terrain (derivative-damped
fbm, ridged first octaves), water with true reflected-terrain rays, aerial
perspective, clouds. Heavy: meant for a `screen`-shape field; expect real GPU
load at fullscreen retina.

Recreate:
```json
{ "type": "create_field", "name": "Fable Vista", "x": 256, "y": 256,
  "shape": { "type": "screen", "width": 1400, "height": 1400 },
  "visualType": "fable_vista", "noHit": true }
```
Then `set_property` `superimpose=true` on the field (see gotchas).

## cradle-window.wgsl — `cradle_window`
A framed night sky driven by the Mirror cradle (localhost:3334): aurora energy =
thread activity, star density = vocabulary, surge on each new champion, violet
shift while dreaming. Cheap. Pairs with the `cradle_window_pulse` step hook,
which polls `/api/stats` + `/api/speaks` every 6s and writes `visualParams`.

Recreate:
```json
{ "type": "create_field", "name": "Cradle Window", "x": 256, "y": 150,
  "shape": { "type": "rect", "width": 300, "height": 200 },
  "visualType": "cradle_window", "noHit": true }
```

## Engine contracts learned the hard way
- **World uniforms (Jul 10 2026)**: 64 shared floats, `worldData.gpuUniforms` →
  `uni(i)`/`uni4(i)` in every visual/interaction shader. Cross-field state
  (boat position into the sea shader, one sun for all fields) goes here, not
  through visualParams packing.
- **Effects/visuals are WGSL, not GLSL** — FIELD_ENGINE_API.md predates the
  WebGPU renderer.
- **Output linear HDR.** The post pipeline always applies ACES + bloom; if you
  tonemap or gamma-encode in the visual, it gets double-graded into a washed
  pastel veil.
- **The 2D superimposed compute path has y inverted** relative to the fragment
  path: positive local `uv.y` points DOWN the screen. Flip it for world-space
  scenes.
- **`superimpose` property (per field)** = last-write-wins overwrite. Without it
  the OIT pass averages your color with every other overlapping field.
- **Visual type numeric IDs are per-session.** Always create/assign visuals by
  string name so `visualTypeName` is stored (create_field persists it as of
  Jul 2 2026); the restore path re-resolves names against the live registry.
- **SSE replay races the async state restore.** Commands sent while no tab is
  connected replay on connect but then get clobbered by the restore. Send
  state-mutating commands (set_property etc.) to a live, already-restored tab.
- **Page reload now resumes properly** (fixed Jul 5 2026): the mount restore
  re-resolves each field's `visualTypeName` against the rebuilt registry
  (numeric visualType IDs are per-session) and auto-starts the sim when the
  restored world ships step hooks. Before the fix, a reload froze the sim and
  rendered stale/wrong visuals.
- **Writer lease (Jul 5 2026)**: the global world now has a server-side writer
  lease — one tab syncs, any other tab gets 409 and shows a READ-ONLY banner
  with a take-over button. Two tabs no longer fight last-write-wins.
- **Broken shaders are quarantined, not fatal (Jul 5 2026)**: if the uber-shader
  fails to compile, each visual is test-compiled in isolation, the offenders
  are excluded (fields using them fall back to a solid fill), and the world
  recompiles with the healthy set. Look for `[Super] QUARANTINED` in the
  console; re-registering a visual with fixed WGSL clears its quarantine.
- **Scene load resets the shader registries (Jul 5 2026)**: visuals/modules/
  targets from previously loaded scenes no longer accumulate in the uber-shader
  (54 stale visuals were bloating every recompile). Scenes must ship every
  visual and module they use — all cartridges here already do.
- **The 3D pipeline compiles only in 3D mode (Jul 5 2026)** — scene switches
  in 2D no longer pay a second compile.

## lumen-cartridge.mjs — `LUMEN` (game cartridge)
A complete game shipped as a saved scene: fields + WGSL visuals + a JS step
hook (game logic) + physics params. Load the "LUMEN" scene tab.
**WASD** flies the wisp; **arrow left/right** sweeps a blade of light around
you. The blade kills shades (+1), repels the maw, and parries its bolts —
a parried bolt turns blue and flies back; landing it stuns the maw (+2).
Gather embers (+1). The maw hunts faster as you score. Body hits cost a
heart; three hearts, death halves your score. Enemy pools are pre-created
fields recycled by the hook (spawning fields at runtime can't resolve visual
IDs from inside a hook). Hearts and score pips render in the HUD field; the
HUD field's *name* is the scoreboard.

Rebuild/tune: edit and run `node lumen-cartridge.mjs` (posts the scene to
`/api/engine/scene`), then reload the scene in the engine.

Cartridge pattern notes:
- Step hooks in scenes are trusted and DO run (the bridge blocks them);
  `load_scene` auto-starts the sim when a scene ships hooks (Jul 2 2026).
- Game logic mutates `field.transform.vx/vy` directly — `sim.applyForce()`
  writes a memory entry per call and would flood at 60Hz.
- Keyboard state arrives in `sim.worldData.key_*` (arrows, WASD, space,
  enter, shift). Screen-up is grid −y.
- Feed per-entity state to visuals through `visualParams`.

## chorus-cartridge.mjs — `CHORUS` (game cartridge)
Unity Chant as an arcade loop: fly a voice-spark (**WASD**), gather golden
idea-motes (max 5 orbit you), deliver them to the central star. 5 sparks fill
a tier (progress arc + a new dashed ring), 5 tiers crown a champion — supernova
bloom, +25, escalate. Doubts hunt you and *scatter* what you carry (they never
kill); **space** fires a chime pulse that repels and stuns them, one full bar
per cast. The star's aura keeps doubts off the deposit zone. HUD: tier pips,
carried dots, champion stars, pulse-energy bar; the HUD field's name is the
scoreboard. Aurora/starfield arena, HDR bloom throughout.

Rebuild/tune: edit and run `node chorus-cartridge.mjs` (posts to
`/api/engine/scene`), then load the CHORUS scene tab. Same cartridge pattern
as LUMEN: pooled hidden fields (`visualParams[3]>0.5`), state in
`sim.worldData.__ch`, per-entity state fed through `visualParams`,
carried/slot/stun via `field.properties`.

## marionettes-cartridge.mjs — `MARIONETTES` (pixel-skeleton experiment)
Pixel-perfect node-skeleton rendering — no primitives, no radial glows, no
rect fills. Four creatures (Serpent, Walker, Puppet, Crawler), each a field
whose visual is joints + bones: FK gaits computed in-shader, drawn on a
quantized texel grid (3 screen px per texel) with hard step() edges. Flat
2-tone palettes, bloom effectively off (threshold 1.2), no vignette.

Key techniques proven here:
- **Screen-aligned texels under rotation**: fields never rotate; heading is
  passed in `visualParams[0]` and the skeleton rotates BEFORE `mod_px`
  quantization, so the pixel grid stays axis-aligned.
- **Scene modules work**: `mod_px` (texel quantize), `mod_seg`/`mod_bone`
  (1px line via step), `mod_node` (diamond joint) shipped as a `skel` module —
  compiled `(6 visuals, 1 modules)`.
- **Interaction**: hook computes nearest neighbor per creature — they reach
  toward each other (`reachAngle`/`reach01` params), close pairs sync gait
  phase, and two pooled Bridge fields snap a jagged pixel-lightning line
  (time-quantized flicker, `floor(time*12)`) between the two closest pairs.

Rebuild/tune: `node marionettes-cartridge.mjs`, reload the MARIONETTES tab.

## marionettes2-cartridge.mjs — `MARIONETTES II` (skinned skeletons)
The v1 rig becomes flesh: identical FK skeletons and hook, but each creature
is now `opSmoothUnion` of capsules over its bones (per-bone radii — thick
spine, thin legs, sphere head), shaded with SDF-gradient bevel lighting
(forward-diff normal, 2 extra SDF evals) quantized by `mod_band2` into
checker-dithered 3-band cel shading. Dark hue outlines (0 < d ≤ 1 texel),
eye + glint pixels, per-creature color ramps. Proves the skeleton-rig/skin
split: v1 and v2 share joints verbatim, only the draw layer changed.
Bridge upgraded to white core + cyan halo (two thresholds, still crisp).
Helper fns use `mod_*2` suffix to avoid colliding with v1's module.

Rebuild/tune: `node marionettes2-cartridge.mjs`, reload MARIONETTES II tab.

## marionettes-hd-cartridge.mjs — `MARIONETTES HD` (resolution dial)
Same rig + skin as II at 2.7x texel density. Key insight: the 512 grid is
world/state space, NOT render resolution — the uber-shader runs per device
pixel (fable-vista proves the ceiling). Pixelation is one floor() we choose.
The HD trick is a coordinate-space split: `ct = mod_px2(uv, 120)` (fine texel
grid, used by ALL dither — bands, checker, speckle, shadows) while the SDF
evaluates at `c = ct * (44/120)` (original 44-unit body space — joints, radii,
patterns unchanged). Creatures scaled to radius-92 fields, 5 shading bands,
finer eyes/normals. Generated from the II cartridge by scripted transform.

Rebuild/tune: edit marionettes2-cartridge.mjs, re-run the transform in
marionettes-hd-cartridge.mjs's git history, or edit the HD file directly.

## marionettes-apex-cartridge.mjs — `MARIONETTES APEX` (lighting ceiling)
ULTRA's smooth bodies plus a real lighting model: 6-tap soft self-shadows
(marched along the light direction through the body SDF — limbs shade the
torso), crease AO from gradient shrink at smooth-union seams, subsurface
scattering at thin light-averted edges (`exp(d) * facing` per-creature
transmit color), dual specular lobes gated by occlusion, sky bounce on
upward faces, god rays in the arena, warmer grade (bloom 0.24 / vig 0.32).
~10 SDF evals per body pixel. Generated from the ULTRA cartridge by scripted
transform (see the python block in git history / session logs).

## marionettes-3d-cartridge.mjs — `MARIONETTES 3D` (volumetric)
True 3D: the 2D rig's capsules extrude to z (mod_cap3/mod_sph3, segments in
the z=0 plane) and each body is orthographically raymarched (camera z=-9,
ray +z, 40 steps) — real 3D normals, a 7-tap marched self-shadow toward the
light, 3-tap normal-space AO, fresnel rim, per-creature patterns sampled at
the hit point. The 2D SDFs remain for silhouette AA, contact shadows, and
the serpent's spine parameter. 120fps verified. The sd→sd3 transform is
mechanical (python block in the cartridge's git history): same joints,
`mod_cap2(q,` → `mod_cap3(p,`, `length(q - X) - r` → `mod_sph3(p, X, r)`.

**Planted gait (Jul 5 2026)**: 3D's legs no longer skate. Gait phase is in
stride cycles advanced by DISTANCE in the hook (`ph += speed/stride * dt`),
and `mod_gait` drives stance feet linearly backward at exactly body speed —
zero world velocity, feet visibly plant. Stride derived as
`2·L·pxPerUnit/duty` per species. Earlier ladder tabs keep the old floaty
gait as historical stages.

The canonical creature module now lives at `scenes/skel-lib.wgsl` (pixel
quantize, bones/joints, 2D+3D capsules, planted gait, dither bands, ramps,
blink) and the patterns are documented in `AI_ENGINE_GUIDE.md` §Procedural
Creatures.

The full fidelity ladder, one rig: MARIONETTES (wireframe bones) → II
(dithered pixel skin) → HD (2.7x texels) → ULTRA (smooth + 2-light) →
APEX (self-shadow/AO/SSS) → 3D (raymarched volumes, planted gait). Same
skeletons, same hook, six draw layers.

## terrarium-cartridge.mjs — `TERRARIUM` (artificial-life ecosystem)
A self-running food web built on skel-lib: grazers (walker rig, planted
gait) forage six regrowing moss patches; a crimson serpent predator hunts
them. Everything is an energy budget — eating, fleeing (ears fold back,
speed x1.7), starving, reproducing. Offspring spawn from a pooled slot with
inherited speed AND an inherited body tint (`field.color` ± mutation), so
lineages are visible as color families under selection. Predator hunger
scales its speed; catches reset it. The arena field's name is the census
(grazers / moss % / born / taken) — it refreshes when the UI re-renders,
so hover or click to update it.

Ecology gotcha learned here: `worldData.__state` survives scene loads (the
restore merges worldData), so version-tag hook state
(`if (!wd.__x || wd.__x.v !== N)`) or a reloaded cartridge inherits the
previous run's half-dead population.

Rebuild/tune: `node terrarium-cartridge.mjs`, reload the TERRARIUM tab.
Balance knobs are all in the hook: bite/regrow rates, metabolism,
reproduce threshold (1.5) and cooldown, predator hunger curve.

## sanctum-cartridge.mjs — `SANCTUM` (player-space demo, no creatures)
A living room, the PlayerSpace pitch made concrete: stained-glass arch
window on a 90s day/night cycle (palette + sun-angle sweep via
`mod_skycol`/`mod_bright`), colored shafts, swaying vines, drifting paper
lanterns, a brazier, and a reflecting pool. The cursor is a presence:
touch the pool → ripples (pooled ring fields, `mouse_x/y/down` from
worldData), hover the brazier → the flame flares, approach a lantern →
it yields (impulse state with exponential decay).

Key technique — **modules-as-scenery**: the window lives in shared module
functions (`mod_glass`, `mod_beams`), so (a) the pool re-renders it at a
mirrored, compressed, sine-wobbled coordinate for a reflection with no
render target, and (b) the light is PROJECTIVE — `mod_beams` traces each
point back along the sun direction to the window plane and samples the
actual glass there (3 depths x 2 penumbra taps). The beam is the window's
shape extruded along the sun angle; the floor receives the stretched pane
pattern with leadwork shadows; blur grows with travel; everything sweeps
together as the day turns. Light, glass, and reflection literally cannot
disagree — they are one function.

Gotcha found here: **`boundaryMode: 'solid'` fights full-canvas fields** — a
512-wide rect exactly filling the world gets nudged between 255 and 256
every frame, so the whole backdrop (window included) visibly shakes. Use
`boundaryMode: 'open'` when nothing needs walls, and pin static architecture
in the hook (`T(room).x = 256; vx = 0`) as belt-and-braces.

Rebuild/tune: `node sanctum-cartridge.mjs`, reload the SANCTUM tab.
Day length, palette keys, and all interaction radii are top-of-file knobs.

## cradle-body.wgsl — `cradle_body` (+ graft-body.mjs)
An embodied face for the Mirror, honest to its anatomy: one unified eye
(wandering gaze, occasional blink, closes fully in dreams), a thread-filament
shell whose speed is thread activity, a mouth that ripples on new champions,
a golden crown-ring flare when one is crowned, word-motes scaled by
vocabulary. Waking teal, dreaming violet. Driven by the same cradleBridge
params as the window. `graft-body.mjs` injects the body + a wander step hook
(shy of colony fields) into the `garden-and-window` scene.

Engine fix that came out of this: `save_scene`/`load_scene`/`delete_scene`/
`reset` are now NO_REPLAY commands — replaying a queued save_scene against a
freshly-restored session was silently overwriting saved scenes with whatever
world the new session held.
