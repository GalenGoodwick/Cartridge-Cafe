# THE UI SYSTEM — one layout authority

*Born Aug 9 2026 from the pentarch UI saga: shader chrome, DOM panels, and
hand-computed hit rects each held a copy of the same geometry, aligned only by
matched coordinates — every edit broke an alignment somewhere else. Veilfire
never had the disease: ONE render authority. This system makes one authority
the platform contract. Read this before building ANY screen-space world UI.*

## The one truth

```
worldData.ui            the declarative tree a world (hook or bridge) publishes
      │   ui-solver.ts — pure, deterministic, monospace-exact (runs on main, µs)
      ▼
worldData.__uiRects     { rev, rects: {id: {x,y,w,h}}, hits: [{id,action,rect}] }
      │                 HOST-OWNED — worlds/hooks READ it, never write it
      ├── renderer glass pass    SDF rounded-rect panels + meter track/fill
      ├── renderer glyph pass    text runs (pre-wrapped/clipped by the solver)
      ├── click routing          pointerdown → hitUi → wd.__uiClick/__uiClickT,
      │                          swallowed from gameplay (INSPECT still outranks)
      ├── hooks + AI             the layout is readable data
      └── UI EDIT (planned)      drag/resize/collapse → worldData.__uiOverrides
```

Everything is REAL ENGINE PIXELS — no DOM. Probes, recordings, and the REC
button see the true UI. The legacy `hud` protocol (DOM) still works and is
untouched; new UI should use `ui`.

## Units — design units, one space

All coordinates are the **512-grid of the resting letterboxed square**
(centered, side = min(W,H)), origin top-left, **y DOWN** — the same space as
`worldData.__entities` (sx,sy) and design-px fontSize.

- screen px = unit × side/512
- uv (pop/chrome, −1..+1 y-down) = unit/256 − 1
- **UI never follows the grid camera.** Chrome is anchored to the square at
  rest; only the world rides the camera.

Text is exact because the font is monospace: advance = **0.62 × fontSize**
per glyph, line height = **1.15 × fontSize** (`ADV`/`LINE` in ui-solver.ts —
these MUST stay equal to the renderer glyph pass constants). Wrap and
auto-height are therefore arithmetic, not browser magic.

## The tree

```js
worldData.ui = {
  rev: 3,                      // bump on structural change (any change is fine)
  theme: { border: 'rgba(80,220,255,0.55)' },   // optional glass defaults
  root: [                      // top-level PANELS only
    { id: 'vitals', kind: 'panel',
      anchor: { x: -0.82, y: 0 },   // uv seat | {gx,gy} grid | {entity:'helm'}
      align: 'cl',                  // which panel point pins to the anchor
      w: 110,                       // units | '22%' | 'auto' (from content)
      gap: 4, pad: 8,               // column flow (dir:'row' for rows)
      glass: true,                  // false = no box; {border,bg,radius,glow} = styled
      children: [
        { id: 'h',  kind: 'text',  text: 'VITALS', fontSize: 11, color: '#7fdfff' },
        { id: 'm1', kind: 'meter', value: 0.7, w: 94, h: 11, label: 'THRUST', hue: '#ffb347' },
        { kind: 'row', gap: 2, children: [
          { kind: 'text', text: 'SPD', fontSize: 8 },
          { kind: 'spacer', flex: 1 },                  // flex absorbs leftover
          { id: 'spd', kind: 'text', text: '4.2u', fontSize: 8 } ] },
        { id: 'desc', kind: 'text', wrap: true, fontSize: 8, text: 'wraps itself…' },
        { id: 'buy', kind: 'button', text: 'MOUNT', click: 'buy-lance' },
        { id: 'portrait', kind: 'slot', w: 60, h: 60 },  // reserved rect the
        // WORLD's shader draws into — read its seat from __uiRects (via
        // uniforms/pop) → shader graphics anchored INTO the UI, zero drift
      ] } ] }
```

Node kinds: `panel` (top-level, anchored, glassed) · `col`/`row` (flow) ·
`text` (wrap or '..'-clip — the atlas is ASCII, no '…') · `meter` (track +
fill + inset label) · `button` (label + hit rect + action) · `spacer` (flex) ·
`slot` (reserved rect for world-drawn graphics).

Anchors: `{x,y}` uv seat (pentarch chrome convention) · `{gx,gy}` grid units ·
`{entity:'id-or-label'}` — resolved from `worldData.__entities`, so UI can pin
to LIVE GAME ELEMENTS (tooltips, unit frames) instead of hand-matching coords.
`dx/dy` offsets compose with all three.

## Clicks

Buttons need ZERO world-side rect math: the engine hit-tests the solved rects
(last-painted panel wins) and writes `wd.__uiClick = action`,
`wd.__uiClickT = now`. Hooks edge on `__uiClickT` change — the same contract
the DOM protocol used. A UI hit never reaches gameplay/mouse_down.

## Overrides — the edit channel

`worldData.__uiOverrides = { panelId: { dx, dy, w, h, collapsed } }` applies
after anchoring (solver input, human- or AI-written). This is where UI EDIT
mode's drags land — and where an AI reads what the human adjusted, then bakes
it back into the source tree.

## Laws

1. **Never position UI by matching another layer's coordinates.** If two
   things must align, make one the child of the other, or anchor both to the
   same entity/seat. Drift is a design error the solver exists to make
   impossible.
2. `__uiRects` is host-owned (excluded from the sandbox worker echo). Worlds
   read, never write.
3. `ui` crosses the worker boundary like `hud`: whitelisted worker→main,
   dropped from the main→worker echo — republish it from the hook (cheap,
   rev-gated inside the solve).
4. The hub never renders a world's `ui` (same lingering-bleed law as hud).
5. Perf: the solve is pure arithmetic per frame; glass ≤512 boxes, glyphs
   ≤4096 (shared with world hud text). Keep trees under a few hundred nodes.
6. Verified renderer parity constants: if the glyph pass metrics ever change,
   change `ADV`/`LINE` with them — the unit tests pin both.

## Verification

`src/__tests__/unit/ui-solver.test.ts` — 27 golden-layout tests incl. the
anti-drift law (every run/meter/hit provably inside its panel) and byte
determinism. Pixel proof recipe (headless Chrome + WebGPU on Metal, dev-only
`window.__ccDevSim` handle): see the ui-pixel-proof harness pattern —
inject `worldData.ui`, read back `__uiRects`, dispatch pointerdown at a
solved hit rect, screenshot, LOOK.
