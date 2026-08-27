# THE UNIFIED WORLD — one config for any kind of world (Galen, Aug 27)

> "It is time we designed a unified system for any kind of world configuration."

Today a world's shape is spread across many places: render mode lives in the
renderer, chrome lives in React/FieldEngine, layout lives in `ui-grid`, UI
content is starting to live in `ui-solver`/`ui-blocks`, fit/responsivity lives
in my shell work, inputs live in TouchControls + `__uiClick`. Each is good; none
is the whole. **The unified world is ONE declarative document that composes them
all** — so a raymarched FPS, a 2D field puzzle, a shader-UI catalog, and a mobile
app page are the SAME schema with different facet values.

This is the convergence of the two live lanes: the chair's `one-engine`
(everything rendered as engine pixels) and my fit/instance layer (one declaration
recomposed across every viewport). They are not two systems — they are two
**facets** of one config.

## The insight: a world is a composition of ORTHOGONAL FACETS

A world config declares each facet independently; the engine solves and draws
the composition. The facets:

| Facet | Answers | Today it lives in |
|---|---|---|
| **render** | how the visual is drawn | `renderer.ts` (field2d / raymarch3d), `ui-solver`+`shaders.ts` (shaderUI) |
| **layout** | where regions sit on the viewport | `ui-grid.ts` + `ui-grid-doc.ts` (regions / perchers / movers + overlap gate) |
| **ui** | what content fills each region | `ui-solver.ts` nodes, `ui-blocks.ts` (block→node), DOM (escape hatch) |
| **fit** | how it recomposes per viewport | when-clauses (`ui-grid`) + aspect-aware recomposition (my FitShader principle) |
| **input** | how it's controlled | `__uiClick`/`__uiRects`, TouchControls, key/pointer |
| **behavior** | what runs each tick | `__nodes` step-hooks (node-runtime), `world-sandbox` |
| **state** | what persists | `worldData` + persistence/serialize |

The power is that these are **orthogonal**: you swap `render: raymarch3d` for
`render: shaderUI` without touching layout/ui/fit/input. "Any kind of world" is
just a different vector across these axes.

## What already exists — DO NOT REBUILD (honoring one-engine's ethos)

- **Placement**: `ui-grid.ts` — regions, movers/perchers, `when` predicates, the
  overlap gate. Pure + tested.
- **Shader UI render + solve**: `ui-solver.ts` + `shaders.ts` — node tree → rect
  table → GPU glass/glyph pixels, `__uiClick` hits, `__uiRects` readable truth.
- **Block compiler**: `ui-blocks.ts` (chair) — block model → ui-solver nodes;
  shell chrome via `shell:` namespace routed to the host.
- **World render**: `renderer.ts` (FieldRenderer) — field2d + raymarch3d, camera,
  the aspect-aware cover math, the load governor, the mobile pixel/fps caps.
- **Fit/instance**: the FitShader principle (a shader reads its own real size and
  recomposes isotropically) + the calculated-instance shell (one doc culled to
  phone/desktop). This is the missing FIT facet made explicit.
- **Behavior/order/state**: node-runtime (`__nodes`, declared order, provenance),
  `world-sandbox`, `worldData`.

Seven islands, one idea. The unified world is the **schema that composes them**.

## The one declaration — `WorldDoc`

```
WorldDoc = {
  id, name,
  render:  RenderFacet,        // { kind: 'field2d'|'raymarch3d'|'shaderUI'|'composite', … }
  layout:  UiGridDoc,          // regions (game.stage, chrome bands, slips) — EXISTS
  ui:      { [regionId]: UiNodeTree | Block[] | DomTenant },  // per-region content
  fit:     FitPolicy,          // when-clauses + aspect policy ('cover'|'contain'|'isotropic')
  input:   InputMap,           // click targets, touch controls, key bindings
  behavior:__nodes,            // EXISTS (node-runtime)
  state:   worldData,          // EXISTS
}
```

A **region** is where a facet-vector lands: `game.stage` gets `render`, chrome
bands get `ui`. Every region carries its own `fit` policy. The site is a graph of
WorldDocs laid into regions; **mobile is the same doc culled by `fit.when`.**

## The one pipeline — config → solve → render → verify

```
WorldDoc ──▶ solve (ui-grid regions + ui-solver nodes, culled by fit.when)
         ──▶ __uiRects  (the one readable rect table — layout truth)
         ──▶ render     (per region: field2d | raymarch3d | shaderUI, ONE pass)
         ──▶ eye        (probe/headless reads pixels + __uiRects — the ghost dies)
```

One solve, one rect table, one render pass, one verification surface. The eye
covers the WHOLE app because layout is `__uiRects` and paint is engine pixels.

## Why this is the unification (not a third thing)

- The chair's **one-engine IS the `render: shaderUI` facet + the `ui` facet.**
- My **fit/instance work IS the `fit` facet** made first-class.
- `ui-grid` IS the **`layout` facet**. node-runtime IS **`behavior`**.

Nothing is thrown away; each existing island becomes a facet with a name and a
slot in one schema. The new code is small: the **facet-composition type + the
solve/render dispatcher** that reads a WorldDoc and routes each region to its
render backend by `render.kind`.

## "Any kind of world" — the same schema, four vectors

- **Raymarched FPS** — `render:raymarch3d`, `ui`: HUD nodes + chrome bands,
  `fit:{aspect:'cover'}`, `input`: touch stick + keys.
- **2D field puzzle** — `render:field2d`, `ui`: minimal chrome, `fit:{aspect:'contain'}`.
- **Catalog / site page** — `render:shaderUI`, `ui`: block-compiled cards,
  `fit:{when: mobile↔desktop}`, `input`: click targets.
- **Mobile app shell** — same as above, `fit.when` culls to the phone instance;
  reserved header/footer bands + expand-from-band menus (the shell proof).

Four worlds, one config type, one engine, one eye.

## Rungs (incremental — each gated + eye-verified, nothing to prod without your word)

1. **The facet types** — `world-config.ts`: `WorldDoc`, `RenderFacet`, `FitPolicy`,
   `InputMap`. Pure + unit-tested. No behavior change; just the schema all facets
   agree on.
2. **The fit facet, first-class** — lift the FitShader principle into a shared
   `fit(rect, aspect)` the render pass uses for every region (shader or field).
   Prove: circles round, content reflows, at 4 aspects.
3. **The solve/render dispatcher** — read a WorldDoc, solve layout, route each
   region to its render backend by `render.kind`, draw one pass. Prove on a
   composite doc (a raymarch stage + shaderUI chrome + a DOM escape-hatch input).
4. **Author + eye** — one authoring surface writes a WorldDoc; the eye reads
   `__uiRects` + pixels across the phone/desktop matrix. The loop closes.

## Ratification gate

This doc is the design; **no code lands until Galen ratifies the facet model.**
Open decisions for him:
- **The DOM escape hatch** — keep it as a declared per-node backend (my earlier
  rec, for text-input/a11y), or hold to the one-engine's pure-shader ruling?
- **Facet names/shape** — is the 7-facet cut the right decomposition, or should
  any merge/split (e.g. is `input` part of `ui`)?
- **Base** — build the unified engine here (off prod) and fold in the chair's
  `one-engine` render + my `ui-benchmark` fit, or merge those branches first?

## RULINGS — Aug 27 (Galen) — chrome inventory + creation flow

The full world-chrome inventory (~25 controls) was accounted; these rulings
resolve the flagged items and set the creation flow:

- **DOCK IN: REMOVED.** Membership automatically allows editing open worlds —
  no dock ritual, no docking limit (limits verified already gone). The
  membership ask surfaces at the EDIT ACTION, not as a chrome button.
- **⚔ branch-standing: REMOVED** (button + its 10s arena poll). Branch/
  tournament paradigm is retired; the riding chip keeps only author + discuss.
- **PREMIUM GAMES → WHITE-LABEL.** Not deleted — repurposed: premium space
  becomes the white-label lane where DEVS OWN THEIR IP (the Fortis shape:
  tenant seam, own branding, own terms). Design pending; gate component stays.
- **DELETE WORLD → the account page.** Off the world page; lives with the
  user's game list (/mine). PROTECTION: a world with multiple editors is
  protected — no single-click deletion of co-built work.

### THE GENERATE FLOW (to build) — creation asks three questions

New-world creation becomes a real flow; each answer is a FACET of the
unified WorldDoc, set at birth through the ONE birth pipeline (birthWorld):

1. **BASE** — "fork from here" moves OUT of the in-game dock INTO creation:
   pick blank, or any forkable world on the shelf as your starting base
   (lineage recorded, same as today's fork).
2. **DIMENSIONS** — the targets facet, chosen up front: desktop | mobile |
   universal (+ optional min bounds). Feeds the catalog badge, the door
   notice, and every solve verdict from day one.
3. **PEOPLE** — the access model: solo | invite-only | open world. Maps to
   membership editing (open = members may edit), invites (co-build), or
   private solo build.

One form, three selections, one WorldDoc born through one pipeline. No
parallel creation routes (universal-pipelines law).
