# THE ONE ENGINE — the whole app as shader UI layers (Galen, Aug 26 night)

> "Can we do the whole thing just with shaders — using the /pages block
> organization framework as a methodology for shader-based UI layers, so the
> entire app is driven by this one engine?"

**Yes.** Three primitives already exist in the tree; the work is a single
compiler that joins them, plus one a11y decision. This is the precise form of
the standing ruling "we design the whole site with the engine."

## What already exists (do not rebuild)

1. **The block model = the methodology** — `lib/page-types.ts`. A page is an
   ordered `Block[]`: `shader | heading | text | link | button`. **ShaderBlock
   is already first-class** (wgsl + aspect + span + prompt + AI "imagine"). The
   block list IS the organization framework Galen names.
2. **The shader UI renderer** — `engine/ui-solver.ts` + `engine/shaders.ts`.
   Worlds declare ONE retained UI tree → the solver resolves ONE rect table →
   the renderer draws it as REAL GPU PIXELS, no DOM (glass-box + screen-glyph
   passes; `char5x7`, `viewbox`). Clicks route via `__uiClick`; layout is
   readable at `__uiRects`. Pure + unit-testable. Its own header records why
   leaving DOM is possible: the engine font is monospace, so text metrics are
   arithmetic — the browser's one advantage dissolved.
3. **The placement layer** — `engine/ui-grid.ts` + `ui-grid-doc.ts`:
   regions / perchers / movers + the overlap gate (shipped this track).

They are three islands using one idea. Uniting them = the one engine.

## The synthesis

```
block  ──compile──▶  ui-solver node (percher)
  heading/text  ▶ glyph run
  button/link   ▶ glass-box + __uiClick target
  shader        ▶ WGSL panel (already native)

page (ordered blocks)  ──▶  a REGION's content (ordered slot-fill)
app (chrome/catalog/shells/game)  ──▶  a graph of page-docs laid into regions,
                                        drawn by the ONE shader pass
```

- **The missing piece is ONE compiler**: `block → ui-solver node`.
  `PageBlocks.tsx` renders blocks to DOM today — that is the only island seam.
  Route the block model through `ui-solver` and a page renders as GPU pixels.
- Then a **region is just a page-doc**, the **site is a graph of page-docs**,
  and **mobile is the same doc culled** by the when-clauses we already ship.

## Why it wins

- **The ghost dies everywhere** (Opus's finding): probes, recordings, headless
  eyes finally see ALL UI — game, chrome, site — because it is all engine
  pixels with `__uiRects` as readable truth.
- **One renderer, one overlap gate, one authoring model** for game UI + site +
  pages. AI authors the whole site exactly the way it authors a world.
- **One seam to secure, one layout to verify.** The eye covers the entire app.

## The a11y/SEO cost — RULED: pure shader, thin SEO crumb (Galen, Aug 26)

> "So no more HTML at all — the app built on its own engine. We can still
> surface prompts and instructions to SEO. Not worried about SEO. The UI is
> EVERYTHING. If we get the whole app, desktop or mobile, onto this engine we
> will have solved every problem."

**THE RULING — PURE SHADER, NO DOM UI.** The app is GPU pixels end to end;
there is no DOM UI layer and no semantic mirror to maintain. Shader-drawn text
being uncrawlable/unselectable is an accepted tradeoff — the UI is everything,
and one engine driving desktop and mobile is the win that dwarfs it.

**The only DOM that survives is a THIN SEO CRUMB**, server-rendered per
world/page, never interactive, never seen: the world's **prompt + instructions
+ title** as plain `<h1>/<p>` in the initial HTML (what a crawler and a link
preview read). It is metadata, not a UI mirror — a few fields per surface, not
the layout. Everything a human touches is the shader.

Consequence: the app boots to a canvas + the crumb; the engine paints
everything else. No `PageBlocks` DOM path in the app; `PageBlocks.tsx` becomes
the SEO-crumb emitter only.

## Rungs (each its own commit; gates: overlap gate + tsc + suite + build + eye)

1. **THE COMPILER kernel** — `block → ui-solver node` for `heading/text/button/
   link`; shader blocks pass through. Pure + unit-tested (glyph metrics are
   arithmetic — exact assertions). No live wiring yet.
2. **One real surface through it** — render the world-page TOPBAR's contents as
   compiled blocks via the shader pass; delete its DOM twin; eye-verify pixels
   + `__uiClick`. Proves the path on a shipped surface.
3. **The SEO crumb** — server renders the world/page prompt+instructions+title
   as a hidden, non-interactive `<h1>/<p>` block; `PageBlocks.tsx` becomes the
   crumb emitter, its DOM UI path deleted. Assert the crumb carries the text.
4. **A page IS a region** — `/pages` docs mount into ui-grid regions; `/p/<slug>`
   renders through the engine (canvas + crumb).
5. **The site as page-docs** — cafe chrome, then the catalog (a shelf scene,
   not a DOM page), migrate one region at a time; DOM chrome dies per surface.
6. **The eye renders the whole app** — projection asserts run over the entire
   surface graph in CI, not just worlds; the app boots to canvas + crumb only.

## Proof

A self-contained WebGL proof accompanies this doc (opened for Galen): the
app-shell — topbar / game / nav — rendered as pure shader layers from a
block+region doc, with a MOBILE/DESKTOP toggle showing the SAME doc culled to
two layouts. Every pixel is one fragment shader; no DOM element in the frame.
