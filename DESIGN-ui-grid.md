# THE UI GRID — the dual-layer primitive (Galen's ruling, Aug 26 night)

> "Whole viewport is infinite grid, culled to necessary Cafe and Game UI. A
> regional node system to define game or cafe space. Build the data structure
> into the snapshot. We have to get UI right in engine or project is a bust —
> we design the whole site with the engine."

## Why (what tonight proved)
The DOM-chrome-over-canvas split is structurally unfixable: two positioning
systems, six visibility flags, per-viewport collisions found only by eyeballs.
The UI projection instrument showed a FOUR-WAY chrome pileup invisible to every
other eye. The fix is not better discipline — it is a PRIMITIVE that makes the
collision inexpressible.

## The primitive
**THE VIEWPORT GRID `V`** — an infinite 2D space the engine owns. The browser
viewport is a WINDOW onto V (exactly like the world camera over a big grid).
The phone frame, desktop, any aspect: just different windows. Coordinates are
declared in viewport fractions (`vx, vy ∈ 0..1` bands — the fit-law's anchors)
or absolute grid units; the solver resolves them per-window.

**REGIONS — the node system.** A region is a NODE on V:
```jsonc
{
  "id": "chrome.topbar",          // node id — claimable, owned, versioned
  "layer": "cafe" | "game",       // THE DUAL LAYER — exactly one
  "anchor": { "vx": [0,1], "vy": [0,0.06] },   // bands; or {x,y,w,h} grid units
  "z": 40,
  "when": { "mode": ["view"], "role": ["owner","member","visitor"] },  // 3-axis
  "owns": ["chrome.topbar.*"]     // elements that may render inside
}
```
**THE DUAL-LAYER IMPLEMENTOR** is the compositor contract:
- GAME pixels (fields/visuals/populations/game-ui) render ONLY inside
  layer:"game" regions. CAFE elements render ONLY inside layer:"cafe" regions.
- An element with no region does not render (no floating chrome, ever).
- Regions of the SAME layer may not overlap unless one declares the other its
  parent. Cross-layer overlap = cafe composites OVER game with declared alpha.
- CULLING: a region outside the window, or whose `when` clause fails the
  3-axis state (mode × role × worldState), simply does not exist that frame.

**ELEMENTS** inside cafe regions use the EXISTING ui vocabulary (panels, text,
meters, buttons — the ui-solver + UiBox/glyph passes; clicks land in
`__uiClick`). No new widget system: the game-UI renderer IS the site renderer.

**THE SNAPSHOT CARRIES IT**: `snapshot.uiGrid = { regions, elements }`. So:
- `describe` returns the full UI structure (the AI reads it before building)
- `render_probe` renders BOTH layers (the chrome blindness dies)
- the projection metrics (overlap, alignment, margin rhythm) become native
  asserts: `overlaps(uiGrid) === []` is a GATE, not an investigation.

## What this retires
- DOM chrome on world pages (SHARE/DOCK/FOLLOW/pills/title) — becomes cafe
  regions + elements, migrated one node at a time (DESIGN-chrome-seam-map.md's
  18-surface inventory is the checklist).
- The worldMode boolean derivations in JSX — `when` clauses on regions replace
  scattered conditionals.
- Eventually: the site's pages themselves ("design the whole site with the
  engine") — /cards as an engine scene; the cafe is a world.

## Rungs (each its own commit, Galen-gated)
0. This design + the MAP. ✅
1. **The data structure**: engine types + `uiGrid` in the snapshot + solver
   that resolves regions per-window + `describe` exposure + overlap gate.
2. **The implementor**: compositor honors regions — game canvas clipped to its
   game region(s); cafe regions render via UiBox/glyph passes. Prove with ONE
   world-page element (SHARE) reborn as a cafe region node; delete its DOM twin.
3. **The world-page top bar** — the four-way pileup rebuilt as ONE
   `chrome.topbar` region (◂ · name · DOCK · overflow) — mobile & desktop from
   the same bands. Projection gate: overlaps === [].
4. Migrate the remaining 17 surfaces; DOM chrome dies per-element.
5. render_probe renders the cafe layer; projection asserts run in CI/the eye.
6. The site: /cards & shells as engine scenes.

| node | owns | state |
|---|---|---|
| uigrid-types | engine/ui-grid.ts (types, solver, overlap gate) | claimed: opus |
| uigrid-snapshot | snapshot/describe carry uiGrid | claimed: opus |
| uigrid-compositor | renderer clip + cafe-region render | open |
| uigrid-topbar | rung-3 region | open |
| uigrid-migrate | rungs 4-6 | open (coordinate: sibling + chair) |
