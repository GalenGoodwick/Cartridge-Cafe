# DESIGN — Responsive Worlds (resizable grid, mobile, touch)

*Jul 31 2026 — driven by PENTARCH ("longer grid"), scoped for the whole platform.*

## Law

**Opt-in, never platform-wide.** Some games can stay square. A world that says
nothing renders exactly as today — square logical space, letterboxed, zero change.
Responsiveness is a contract a world *declares*, not a reshape the engine imposes.

## Ground truth (verified in FieldEngine.tsx, Jul 31)

- The renderer already draws the **full viewport**, not a square: visible range
  expands with aspect (`halfW = gridRange * max(aspect, 1)` — FieldEngine.tsx:4138;
  same in the pointer map :3826-3829). Wide screens already *see* extra world.
- Mouse→grid mapping is aspect-aware (`computeFieldViewport`, :60-71).
- **The gap:** hooks get `mouse_x/mouse_y/mouse_down/key_*` but nothing about the
  viewport. A world cannot know it is wide/tall, so it can't *use* the space it's
  already being shown. That one missing number is most of this feature.

## Track 1 — engine: expose the viewport (tiny, unblocking)

Engine writes, every frame, alongside `mouse_x`:

| key | meaning |
|---|---|
| `wd.view_aspect` | canvas w/h (1.0 = square, >1 wide, <1 tall/mobile-portrait) |
| `wd.view_coarse` | 1 when the primary pointer is touch (`pointer: coarse`), else 0 |

Read-only, engine-authored, costs two float writes. No opt-in needed to *receive*
them — receiving is inert; using them is the world's choice. This is the whole
engine change for Track 1.

## Track 2 — a responsive world (PENTARCH is the pilot)

A world that opts in does two things with `view_aspect` (call it `A`):

1. **Draw in aspect space.** Shader: `let p = vec2f(uv.x * A, uv.y);` then all
   geometry in `p`. Pentagons stay round at any aspect. Hook mirrors it in `toUV`
   (divide x by A). One constant threaded through; the letterbox click-mapping
   bug class doesn't recur because hook and shader share the same A.
2. **Fit content to the live box.** Hull-fit zoom uses the min of horizontal/
   vertical room instead of assuming square. Wide screen → wider build room;
   phone portrait → the grid is naturally *smaller and taller* — this is the
   "smaller grid works for mobile" hope, and it falls out free. No separate
   mobile grid.

`A` changes live on rotate/resize — worlds must treat it as a per-frame read, not
a constant (PENTARCH's layout cache keys on `D.rev`; add `A` to the key).

**Verify by the eye:** throwaway world first. Push a calibration hook (circle of
pentagons + rulers), eyeball at wide / square / narrow browser shapes: round
pentagons, cursor lands where it points, nothing clips. Only then does the
technique touch /space/pentarch.

## Track 3 — touch input (the real mobile blocker)

Hover doesn't exist on phones, and hover→ghost→click is the designer's spine.
Contract, world-side (no engine change if `mouse_down` fires on tap — verify):

- **Tap** an edge hit-area → ghost appears and *stays* (sticky, unlike hover).
- **Tap the ghost** → place blank. Tap elsewhere → ghost dismissed.
- **Double-tap** a tile → delete (already the desktop gesture; double-tap works
  on touch).
- Palette/HUD hit-areas get a minimum size gate when `view_coarse == 1`
  (fingers, not cursors: ≥ ~9% of the short axis).

Sticky-tap is strictly *more* usable than hover even on desktop, so it can ship
as the one input model — no forked code paths.

## Track 4 — mobile game list (platform, independent)

- Manifest/DB flag per world: `touch_ok: true` — a *declaration by the author*
  (or by a verified touch playtest), never inferred.
- Hub: when `pointer: coarse`, default the listing to a **Plays-on-mobile** shelf
  (filter `touch_ok`), with "show all" one tap away. Desktop hub unchanged.
- PENTARCH sets `touch_ok` only after Track 3 is *played* on a real phone.

## Waves (each independently shippable, verify before the next)

| wave | what | eye |
|---|---|---|
| W0 | throwaway world: confirm shader uv + hook see the full wide viewport as assumed; calibrate | browser at 3 aspects |
| W1 | engine: `view_aspect` + `view_coarse` | probe world prints them |
| W2 | PENTARCH responsive (aspect-space draw + fit) | live playtest, wide + narrow |
| W3 | PENTARCH sticky-tap input | phone playtest |
| W4 | `touch_ok` flag + mobile shelf in the hub | phone hub |

Nothing deploys without Galen's word (standing law). W0 needs no engine change at
all — it can start immediately.

## Open questions

- Does `mouse_down` fire from touch taps today, and does `mouse_x/y` track the
  touch point? (Decides whether Track 3 is world-only or needs an engine touch map.)
- Does the *shader* `uv` span the full wide viewport or the square subregion?
  (The renderer draws wide; whether world visuals receive wide uv is the W0 check.)
- `touch_ok` storage: worldData key vs. cartridge manifest field vs. DB column —
  pick when Track 4 starts (leaning DB column; it's a listing concern).
