# DESIGN — PHASE DOCKS: the universal gate tree + the flow return

**Status: DRAFT for ratification (Galen, Sep 15 2026). The insight: "we have
all the raw material but no organized process." Focus becomes GEOMETRY: the
AI docks into a phase and can only see that phase's context and tools; it
cannot leave a phase whose gate isn't true. Universal — no game-archetype
knowledge required, because the tree is derived from what EVERY game needs,
not from genres.**

## What already works (honest inventory, Sep 15)
- **Node docking: LIVE.** `dock_node` = hold + record + history + current
  code in one call; `undock_node {id, code, note}` submits through the push
  gate, `undock_node {id}` abandons. (space-store, proven in production.)
- **Phase context parts: LIVE.** `read_guide` serves per-section; the command
  registry already groups every verb (fields / visuals / nodes / world / fx).
- **Gates: LIVE.** visual-gate (first), shader-compile, conformance,
  node-green, triage-complete, performance (live-tab __budget), no-live-bugs
  (revision-pinned), publish gates.
- **Phase state: DOES NOT EXIST.** Nothing binds context+verbs+gates to a
  current phase. That binding is this design.

## THE GATE TREE (universal — every game passes through, any archetype)

Phases live on the world: `worldData.__phase = { id, dockedAt, history[] }`.
`dock_phase {id}` → returns THE PACKET: that phase's guide slice, its verb
whitelist, its gate spec, and the current flow struct. `undock_phase` → runs
the phase's ESCAPE GATE server-side; refusal names exactly what is untrue.
Verbs outside the docked phase's whitelist are refused with "wrong phase —
you are docked in LOOK; `spawn`-family verbs live in BEHAVIOR."

```
P0 VISION     what this is, for whom, how it should FEEL — spec + vision +
              acceptance scenarios before a single field exists
              gate: vision + spec declared (MARBLE's autopsy: a beautiful
              build of the wrong game is a VISION failure, unreachable by
              any later gate)
P1 FRAME      declare device + grid; containment fields born grid-bounded
              gate: worldParams declared · fields ⊂ grid (structural)
P2 SPACE      layout as FIELDS (standables, zones, regions) — field = pixels
              gate: manifest conformance · pixels≡hitbox (no shadow tables)
P3 LOOK       visuals per field + THE LANE CONTRACT declared (whiteboard
              schema: which uni() lanes mean what, with sane defaults)
              + SOUND (the audio rail is the look of the ears)
              gate: VISUAL GATE (real-tab, portrait+wide, bright+nonuniform)
                    · shader-compile · perf preflight budget
P4 UI         solver bands only; presets law (merge/fill/visual/vanish)
              gate: solver health clean · instructions off-grid · no empties
P5 BEHAVIOR   nodes written ONE AT A TIME via dock_node (the node dock is
              the inner focus loop; the phase dock is the outer one)
              gate: node-green per node · spine run clean · lane ownership
                    (owns-guard) · events flow (producers heard by folds)
P6 TUNE       works ≠ feels right: speeds, tolerances, cooldowns, curves.
              Every fix from the Sep 14-15 play sessions (walk speed, edge
              slop, hold-to-fire) was TUNE, not BEHAVIOR — it needs its own
              instruments: playthrough METRICS (time-to-first-success,
              deaths/min) + the human feel-word
              gate: feel metrics in declared bands · a real play happened
P7 PROOF      the whole ladder: statetest · playthrough trace · LIVE perf
              measurement · no-live-bugs · accounting (bay empty + ledger,
              if dockstar)
P8 SHIP       card/vision/instructions/blurb · brief_done · HUMAN word
              gate: publish machinery (exists) — never auto
P9 TEND       the world in the wild — no exit gate, only re-entry: a live
              fault re-arms BEHAVIOR, a lag report re-arms TUNE, a black
              tab re-arms LOOK. Quarantine stamps, live errors bridging
              back, player counts. Tending is a phase, not an afterthought.
```

Rules:
- Forward is earned (escape gate), backward is free (re-dock any earlier
  phase to fix; its gate re-arms). A later phase's evidence goes stale when
  an earlier phase changes (revision pinning — already how evidence works).
- The tree is the SAME for every game. Archetype knowledge lives in the
  bay's primitives, never in the process. This is why it's universal: VISION, FRAME,
  SPACE, LOOK, UI, BEHAVIOR, TUNE, PROOF, SHIP, TEND is the anatomy of any
  playable thing, from pinball to a walking poem — a poem needs a feel pass
  and a tended life just as much as an arena does.

## THE FLOW RETURN (Galen: "AI sees changes and activity the moment a change hits")

Every bridge WRITE, while docked, returns `flow` — a small struct injected
into the AI's result the moment the change lands:

```
flow: {
  phase: 'LOOK',
  frameMs:  <latest live-tab __budget, with age>        — the heartbeat
  errors:   <hook-err buffer delta since last write>    — faults, immediately
  lanes:    <uni lanes this phase declared, current values from last tick>
  gate:     { untrue: ['visual-gate: wide not captured'] }  — distance to exit
}
```

No polling, no new channel: it rides the existing bridge response + the
live-tab reports (__budget, hook-err slots) already flowing. A live tab or
the tab-eye supplies the tick truth; the bridge folds the LATEST into every
write's response. The AI never edits blind again — each change echoes back
with what it did to the world's pulse and how far the exit gate is.

## Why this fixes the inconsistency (the spotlight, made structural)
The failure autopsies of Sep 14-15 (controls guessed, aspect unseen, gates
skipped under momentum) were all attention-spotlight failures. Phase docks
hold the spotlight FOR the model: context is narrowed at the gateway it
opens, tools outside the phase don't exist, and leaving requires the phase
to be TRUE. Amazing-when-focused stops being weather and becomes the only
available path.

## Build order (each with its proof)
1. `__phase` state + dock_phase/undock_phase verbs + verb whitelist
   enforcement (registry groups → phase map). Proof: wrong-phase verb
   refused with the teaching line; undock refused while gate untrue.
2. THE PACKET: per-phase guide slices (read_guide sections exist) + gate
   spec in the dock response. Proof: packet contents match phase, nothing
   else served.
3. THE FLOW RETURN on bridge writes. Proof: an edit returns frameMs/errors/
   lane deltas + gate distance without any extra call.
4. Escape-gate wiring (reuse the existing checks per phase). Proof: a world
   walked P0→P8 by the AI (TEND has no exit), every gate refused at least once in test, ship
   only on the human word.
5. The omega bay (#9) is then BUILT THROUGH the phase docks — the process
   proves itself on its first real customer.
