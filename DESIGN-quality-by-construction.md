# DESIGN — QUALITY BY CONSTRUCTION

**Status: SPEC (Galen, Sep 17 2026). The question that prompted it: "will this
quality replicate with a fresh AI?" Honest answer today: the FLOOR replicates
(correct, framed, not-ugly, un-crashable — all engine-enforced); the CEILING
("wooow") does not — it still depends on the AI's taste and the human's eye.
This program moves aesthetic quality from *witnessed* to *constructed*.**

## The gap, precisely
NOCTILUCA looked amazing because (a) IMAGINE produced a rich, specific dream,
(b) shader craft hit it, (c) Galen's eye confirmed it. Only (a) is gated —
IMAGINE checks the dream EXISTS and is specific, never that it's good or that
the build MATCHES it. (b) lives in one AI's skill, not a library. (c) is the
human because the AI's own eyes are half-blind. Close those three and quality
is by construction.

---

## PILLAR 1 — VISION-CONFORMANCE (the dream becomes a contract)
LOOK today exits on machine layer-truth (compiles, bright). It does NOT check
the frame matches the declared IMAGINE layers. So a specific-but-flat dream
executed blandly passes every gate.

**Build:** at LOOK exit, judge the real-tab frame against `worldData.imagine.layers`:
- **Palette conformance** — the frame's dominant colors (the eye already returns
  `dominantColors`) must intersect the declared palette. A "deep indigo, lantern-gold"
  dream that renders grey fails.
- **Feature presence** — declared hero-moment / atmosphere features are checkable:
  "a moon" → a bright bloom region; "aurora ribbons" → banded chroma variance;
  "bioluminescent trails" → cyan-green high-saturation clusters. A small library of
  feature-detectors, each mapping a layer phrase-class to a pixel test.
- **The judge** — cheap pixel tests first; a vision-judge agent (LLM given the frame
  + the declared layers, asked "does this exhibit them?") for the subjective call.
> **PROOF:** a world whose LOOK ignores its own IMAGINE (grey when it dreamed
> gold) fails vision-conformance at the LOOK gate, named layer by layer. Needs
> Pillar 3 (the real-tab eye) to supply the frame.

## PILLAR 2 — THE LOOK-KIT (craft becomes a library)
`atmos_kit` is citizen one. Extract the craft already proven into named,
pullable modules so a world COMPOSES gorgeous primitives instead of
hand-rolling from a flat gradient (the MOTH failure).

**The kit (each a `define_module`, pulled by any field's visual):**
- **`atmos_kit`** ✅ — fbm clouds, stars, sun/moon bloom, aurora, gradient
- **`water_kit`** — height-field swells + chop + ripple rings, moonlit specular,
  subsurface (from NOCTILUCA)
- **`sdf3d_kit`** — the raymarch spine: camera→ray basis (one convention, kills the
  hand-rolled copies), march loop, normal, AO, soft shadow, smooth-min (from MARBLE/
  veilfire/the base)
- **`material_kit`** — thin-film iridescence, veined stone, polished metal, translucency
  single-scatter (from AURELIA/MARBLE/the base slabs)
- **`particle_kit`** — bioluminescence trails, spores, embers, dust-in-shaft (from
  NOCTILUCA/MOTH/veilfire)
- **`post_kit`** — bloom, vignette, grade, tone-map
Each field declares which kits it pulls; "3D" = a field pulling `sdf3d_kit`, "2D
effects" = pulling `particle_kit` — the unification as a pull list.
> **PROOF:** a new world reaches AURELIA-grade LOOK by pulling kits + composing,
> with < ~40 lines of its own WGSL. The kit is versioned; a fix to `water_kit`
> lifts every world that pulls it. Ships as ENGINE modules (every world gets
> them) after proving on the base.

## PILLAR 3 — THE WEBGPU EYE (the AI gets its own real screen)
The AI's blindness is why the human is the visual gate: the local eye renders
SQUARE (can't see aspect bugs), the tab-eye can't do headless WebGPU (canvas
reads black). So the AI cannot run visual-gate or vision-conformance itself.

**Build:** `world-tab-shot` renders REAL WebGPU and judges the SCREENSHOT (not the
lying canvas readback): headed Chrome on Metal (or a persistent headed instance the
AI drives), front-door already handled (consent+play+aliveness). Run it at BOTH
declared aspects (portrait + wide). Feed its frames to Pillar 1's judge.
> **PROOF:** the AI runs the visual gate ITSELF at both aspects before the human
> — catching the mis-framed base, the black-at-desktop OMEGA, the aspect-crop —
> so the human becomes the FINAL arbiter, not the ONLY instrument. (The human
> stays load-bearing by law; this just stops trivial visual bugs reaching them.)

---

## PILLAR 4 — THE PHASE PACKET (Galen: verbs/guide/references per gate stage)
`dock_phase` already returns verbs + gate + a guide pointer. Extend it into a
curated **context bundle** so each phase is a focused workspace — the AI never
guesses a verb, reads the whole guide, or hunts for an example:

```
dock_phase {id:"look"} → THE PACKET:
  verbs:   the phase's verbs WITH FULL CONTRACTS (params/example/law from the
           ONE command registry) — not just names
  guide:   the guide SECTIONS mapped to this phase (read_guide is already
           sectioned; add a phase→sections map), inlined or linked
  kits:    the look-kit modules available to pull (Pillar 2), with one-line
           what-each-is
  refs:    REFERENCE EXEMPLARS for this phase — e.g.
             IMAGINE → the dream-writing craft + NOCTILUCA/AURELIA imagine docs
             SPACE   → pixels≡hitbox + field-owned geometry examples
             LOOK    → the kit index + a proven shader per kind
             BEHAVIOR→ the base spine + the pull-grammar (kind/uses) examples
             TUNE    → the feel-metric bands + a proven playthrough
  gate:    exactly what must be TRUE to leave, in this phase's terms
```
Per-phase context is the delivery vehicle for Pillars 1–2: the LOOK packet
hands over the kits and the conformance target; the IMAGINE packet hands over
the dream-craft and exemplars. Focus becomes not just *which verbs work*
(already enforced) but *the AI is handed exactly what it needs to do the phase
WELL*.
> **PROOF:** a fresh AI docked into a phase has, in one response, the verbs it
> may use, the guide it must know, the kits it can pull, and the exemplars to
> match — and cannot see the rest. Measured: build quality per phase with vs
> without the packet.

---

## Order
1. **Pillar 3 first** (the eye) — it unblocks 1, and stops trivial visual bugs
   reaching the human immediately.
2. **Pillar 2** (look-kit) — extract the proven craft; the biggest single lift
   to default visual quality.
3. **Pillar 1** (vision-conformance) — needs 3; makes the dream a contract.
4. **Pillar 4** (the packet) — the delivery layer; grows as 1–2 land.
5. Re-run the NOCTILUCA test with a FRESH agent (no memory) through the packeted
   phases — the acceptance test for "quality by construction."

## What stays the human's, by law
The FINAL visual/feel arbiter is always the human (the "no green without a real
screen" law). This program does not remove the human — it stops the AI wasting
the human on bugs the AI should catch itself, and raises the floor the human
judges FROM.
