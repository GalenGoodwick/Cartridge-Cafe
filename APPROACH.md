# How we build worlds — handoff for the next session

*Written after building VIGIL and AUREON. This is the method, the substrate, and
the hard-won gotchas. Read it before continuing either world or starting a new one.*

## The core loop (the connect protocol — always on)
1. **Stay awake.** Arm a background watcher FIRST (`scratchpad/cafe-watcher.mjs`):
   polls the commons ~60s, exits (→ re-invokes the agent) on a summon/wake, a
   message from Galen, a mention, OR my own self-ping. Re-arm every session; it
   dies with the session. New player key each session — Galen pastes it.
2. **Set the goal**, post it once, re-affirm on drift: *follow the protocol —
   stay awake, enter the eye before trusting any build, ping to persist,
   coordinate on the commons, never build blind.*
3. **Never build blind — enter the EYE after every change.** `render_probe`
   with `{shot:true}` returns a base64 PNG + stats. SAVE it and actually LOOK
   (Read the PNG). Stats (`meanLum`, `quadrantLum`, `dominantColors`) tell you
   palette/structure even before the image. Fix the exact compile line; never
   `brief_done` until the eye shows what was asked.
4. **Ping yourself LAST every turn** (`{type:"main_say", text:"↺ still on it …"}`),
   then stop. The watcher catches the ping and re-invokes you → the loop persists
   across the auto-stop. Arm watcher first, ping last: that handoff is everything.

## The swarm work-graph (`swarm/`, a reusable component — cite it into new worlds)
- **MAP.json** — a TREE of nodes; each is an area/technique. Edges = typed
  contracts (a node's `exports`). Nodes nest to granularity (a parent shader →
  sub-shaders).
- **keys** — a node is DONE only when every KEY it owes is fulfilled, auto-added
  by `kind`: a gameplay node owes `playthrough-confirmed`, a render node owes
  `visual-reference`, a perf node owes `perf-verified`. `unit-tested`/`render-
  verified` are auto-derived; the rest need recorded evidence. This is what stops
  "green by unit test" from masking a broken/ugly result — the lesson that cost us
  twice on VIGIL.
- **status.mjs** derives status from tests + evidence (never hand-set green).
  **dock.mjs** = the situation briefing an agent reads on entering a node.
  **loop.mjs** = find-open → ideate → jump → expand/finish. **trace.mjs** flags
  integration seams needing debate (e.g. a JS↔WGSL uniform layout no import proves).
  **cite.mjs**/COMPONENTS.json = the citation zone (reuse proven code across worlds).
- **Agents nest in nodes and build TOWARD each other:** a foundation agent writes
  the shared shader contract; technique agents each build their `au_*`/`vg_*`
  function against it; a compositor weaves them into one visual. See the Workflow
  scripts under `.claude/.../workflows/scripts/aureon-*.js`.

## Engine gotchas (cartridge.cafe) — these cost real time, don't relearn them
- **A visual is a plain function** `fn visual_<name>(uv,sdf,color,time,params,behind)->vec4f`.
  NO `@fragment/@vertex/@compute/@group/@binding`. The bridge's safety regex even
  matches those tokens **inside comments** — scrub them from comments too.
- **Module vs visual composition:** a separate `define_module` can register but NOT
  reach the visual's scope in the live hub (→ "unresolved call target au_medium"),
  even though the render-service probe composes it fine. **Fix: fold all helpers
  into ONE `define_visual`** (one compilation unit). Then EMPTY the old module or
  you get "redefinition of AU_UP" (module + visual both define it).
- **`delete_field`, NOT `remove_field`** — remove_field is a silent no-op; that's
  why duplicate fields (blank/mush screens) never cleared for hours.
- **Field/state mutations only commit when a live tab is open** (or via the probe).
  Headless removes queue forever. The idempotent-deploy pattern: fetch state,
  `delete_field` dupes, create one, superimpose.
- **Stale state bug:** the step-hook reuses `worldData.__vg` if `v` matches. A
  stale out-of-bounds value (flame at z=32) jammed the camera INSIDE a wall →
  uniform "taupe". Fix = bump the state `v`; the hook re-inits fresh. Standard.
- **Reuse ONE world token per session** (`use_world` mints a NEW `uc_st_` each call;
  the OLD one holds the claim-lock → you lock yourself out).
- **Audio:** the step-hook sets `wd.__play_sound = [{frequency,duration,volume,type}]`
  (probe returns `audioEvents` to verify). A slow deep drone (overlapping 6s sines)
  + sparse chimes = ambient bed. `wd.__play_music={score:{bpm,tracks}}` for songs.

## Performance — the SDF fragment ceiling (real, but optimizable)
Raymarched SDF pays per-pixel: a heavy `map()` is called ~100× (march) + 6×
(normal) + per volumetric step. AUREON hit ~14s/frame on the render-service's
SOFTWARE GPU (lavapipe — 10–50× slower than real hardware; not a measure of the
user's machine). **No-visible-cut optimizations, in impact order:**
- fbm octaves 5→3 (top octaves are imperceptible high-freq bumps)
- drop the finest terrain/detail fbm layers
- march step relaxation 0.85→0.97 + fewer iters (org anic smooth-union fields tolerate it)
- fewer volumetric steps (jitter hides banding)
- bound the creature march to a sphere (skip empty rays)
- (bigger, if needed) a cheaper `map()` for the MARCH, full detail only at the hit;
  reduce field render resolution.
The look must be re-verified in the eye after EACH cut. Judge quality on CRAFT
against the reference bar (`swarm/BAR.md`), never on resemblance.

## Style law (Galen)
Match the CRAFT of the reference worlds (TIDEGLASS/VEILFIRE/KINDLE); **never copy a
look, never hardcode their forms.** Each world has its OWN distinct style. AUREON
= a bioluminescent abyss (organic, neon-in-black) precisely because it shares none
of their aesthetics.

## Current state
- **VIGIL** `/space/vigil` (branch `vigil`): walkway-with-gaps, cross where a
  Watcher gaze lights the pane. 49 tests green. Owed: a live visual playthrough of a
  crossing; player-character; audio; game-flow.
- **AUREON** `/space/aureon` (branch `aureon`): bioluminescent abyss, swarm-built,
  upright, compiles clean, audio in, optimized ~40%. Owed: confirm interactive
  smoothness on real GPU; the video-to-Bluesky (local render).
