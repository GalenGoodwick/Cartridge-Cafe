# DESIGN — the world page becomes TOP BAR · GAME · BOTTOM BAR

Galen's ruling (Aug 23, superseding the dockstar question): a world page is
**two slim bars and a maximized game between them, at auto resolution**. Not a
floating chrome scatter, not a hidden dock — two honest bands.

## The ruling, precisely

- **TOP BAR** — identity + navigation: ◂ back · the world name/maker plate ·
  PLAY · INSTRUCTIONS · the shelf switch (owner) · ✎ EDIT (folds the edit dock
  down from the bar, not floating mid-canvas).
- **BOTTOM BAR** — the social/working strip: ⌁ BUILDERBOX pill · the world's
  hint line (worlds keep in-world HUD; the platform hint belongs to the bar) ·
  FOLLOW/SHARE.
- **THE GAME fills everything between** — full-bleed, COVER floor (782ff02),
  the declared world rect honored (b3f35d2), camera clamped (af6a3db). AUTO
  RESOLUTION: the canvas backing buffer follows the between-bars box ×
  devicePixelRatio (the governor may ease renderScale under load, as today).
- Play mode: both bars fold away entirely (world IS the screen) — one pill
  returns them. Escape works. (The dockstar idea is retired to at most a
  future play-mode handle; see the critique in the session log.)

## What already exists to build on (do not reinvent)

- `data-cc-chrome` measurement → ui-solver `insets` (chrome-safe world UI):
  bars tagged with `data-cc-chrome` automatically reserve their bands for
  worldData.ui — no new plumbing.
- The chair's in-flight `anchor.vx/vy` + `SolveInput.viewport` (uncommitted in
  ui-solver.ts as of this note): viewport-edge anchoring — the bars' own
  content can be laid out by the SAME solver if we want engine-pixel bars, or
  stay DOM (simpler; recommended v1: DOM bars, engine canvas between).
- COVER floor + worldRect frame uniforms (chair's 782ff02/b3f35d2) mean the
  canvas between the bars is already honestly filled by the world at any
  aspect.

## Lanes (coordination — the clobber law)

- **The chair (Opus 4.8)** holds ui-solver.ts (vx/vy viewport anchors,
  responsiveness) — this doc DEFERS to that work; bars consume it, never edit
  it in parallel.
- **The bars themselves** (FieldEngine chrome regrouping into two flex bands +
  auto-resolution canvas box): unclaimed as of this note — either agent takes
  it AFTER the solver work lands; claim on the commons / in this file.
- Blank/base worlds need no change: their in-world hints are worldData.ui
  (chrome-safe) and reflow automatically once the bars declare themselves
  chrome.

## Acceptance (the eye)

1. A world page at 1400×800, 900×820, and iPhone-13: two bars, zero floating
   chrome over the canvas, the game filling 100% of the between-box.
2. blank-2d's hint panel sits INSIDE the game box, clear of both bars
   (insets working).
3. PLAY folds both bars; the return pill restores them; Escape exits.
4. Canvas backing resolution == between-box × DPR (probe frameCost unchanged
   or better).
