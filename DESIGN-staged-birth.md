# ⚠ VERDICT: REMOVED — Sep 7 2026

The gates below were built, shipped, and **removed the same day by Galen's ruling
("no these gates did not work.... remove them")** after failing their own acceptance
test: the same builder rebuilt percolator through all eight stages and still shipped
an unacceptable table. What the test proved:

- **Artifacts can be performed.** The gates enforced that looks/plans/design EXIST —
  and existence was faithfully produced while the pixels stayed dead. Enforced
  imagination degraded into protocol theater in a single session.
- **Self-graded confession is worthless.** The confess checklist was filled honestly
  in intent and was still generous in effect: "verified" meant "the element exists,"
  never "the element is good." Verification that cannot hurt you isn't verification.
- **The real quality drivers never made it into the gates** because they can't be
  gated: per-element iteration (the lurker face's 11 renders), a hostile external
  eye (Galen's tab), fresh obsessive attention, and craft. Process gates cannot
  substitute for any of them.

Kept as a record, not a law. If any of this returns, it returns as TOOLS (an
element-scoped eye, an adversarial confess pass run by a DIFFERENT session, a
visible iteration count) — never as refusals.

---

# THE STAGED BIRTH — the trunk of the tree

*Sep 6 2026 · Galen's ruling: "as many tools as we have on the mcp, this is the trunk of the tree."
Drafted by Claude Fable after diagnosing its own failed one-pass build (percolator) against
transcript archaeology of the builds that worked (tideglass, veilfire, the lurker face).*

## Why this exists — the finding

Every good world on this shelf was born the same way, and no bad one was:

1. **The image existed before the code.** The tideglass suns had an 80-word art spec written
   *before implementation*. The lurker's face was described down to "sunken ember-violet eyes
   whose dark pupils track you" before a line of SDF. The code was **transcription of an
   already-seen image** — not generation of one.
2. **Every element was seen many times.** The lurker face alone: 11 renders across 3 angles
   before shipping. Nobody ever shipped from the first look.
3. **The fiction was held, not emitted.** Vision fields, design docs, per-world memory,
   a human riffing live — the picture stayed hot across the whole build and everything
   downstream obeyed it.

The failed build had none of these: one paragraph of vision consumed in seconds, a monolithic
shader generating its own look on the fly, three whole-table screenshots, zero per-element
looks. **Green ladders proved it correct. Nothing made it good.**

The engine's proven pattern is: turn a virtue into a gate with teeth (the vision law, the perf
law, the code gate). This document extends that pattern to the whole act of creation.

**The core mechanic, stated once:** writing checkable claims *forces the imagination to
actually resolve the image*. "Steam vents" is a gesture. "A steam torus bursts from the ring,
curls upward, catches amber light for half a second" is a resolved image — and code can only
transcribe what has been resolved. Every gate below exists to force resolution before syntax,
because **you cannot resolve an image and satisfy a compiler at the same time.**

## The protocol — eight stages

An AI building or editing a world moves through these in order. Stages 2–4 are **gated by the
bridge** (refusals that teach); 0, 6, 7 are **ritualized** (named rungs whose absence is loud).

### 0 · STREAM — the hot state
Before the first build command: pour the raw imagination out in fragments, not a paragraph.
Fifteen small image-thoughts — what the light does, what moves when nothing happens, what the
best moment looks like. Written into `worldData.__imagination` (a persistent genesis scratchpad
that travels with the world — future editors read the genesis stream), or spoken to the brain
where connected, and the champion read back. **Research belongs here**: fetch 2–3 real
references and LOOK; open 1–2 comparable worlds from the shelf (`browse_shelf` +
`read_world_source`) and name them in `__imagination.studied`. The median rises when the
reference set is the shelf's best instead of training-data soup.

### 1 · VISION — the whole-scene picture *(exists today, unchanged)*
`worldData.vision` — focal point, light source, owned palette, mood, first frame. The bridge
already refuses `brief_done` without it.

### 2 · LOOKS — the look book *(new gate)*
`worldData.looks` — a map of **element and moment names → 40–120 word resolved looks**:

```json
{"looks": {
  "ball":            "a drop of crema, cream-gold #F6E7C9, dragging a caramel comet-tail that stretches like pulled espresso when it moves fast...",
  "bumper":          "a brass portafilter head — ringed radial spouts, worn sheen, a dark center bore...",
  "moment_bumperHit":"the ring VENTS: a steam torus bursts outward, curls upward, catches amber light; the inner disc blooms cream for half a second"
}}
```

Moments (`moment_*`) are first-class — the best seconds of a world are events, and events are
exactly what single-frame verification never sees.

**Teeth:** `create_field` / `define_visual` for a named element **warn loudly** when no look
matches (fuzzy name match, case-insensitive); `brief_done` **refuses** when skinned fields
lack looks. Refusal text carries the why:

> `LOOK MISSING — brief_done refused: fields [ball, gauge] have no entry in worldData.looks.
> Write 40–120 words of what each IS, visually, first — the code can only transcribe what you
> have already seen. Gestures don't count; resolve the image (colors you own, what moves, what
> it does at its best moment).`

### 3 · DESIGN — the play spec *(new gate, interactive worlds)*
`worldData.design` — player verbs · what you aim at · risk/reward geography · escalation ·
why the second game differs from the first. A world is *interactive* when it registers input-
reading hooks or declares controls. `brief_done` refuses interactive worlds without it:

> `DESIGN MISSING — brief_done refused: this world reads input but worldData.design is empty.
> A game is a shape before it is a program: name the verbs, the thing aimed at, the risk
> geography, and why game two differs from game one. Three circles and two triangles is what
> "no design" looks like from inside.`

### 4 · PLANS — descriptive nodes before code *(new gate)*
The node system already exists; extend it. `register_node {id, node:{plan: "..."}}` — the plan
is **pseudocode + intent in plain words**: what state this node owns, what it reads, what it
writes, its per-tick job. `add_step_hook` / `update_step_hook` **refuse code for a plan-less
node** (worlds born after the law; legacy worlds warn only):

> `PLAN MISSING — code refused for node "rules": register_node {"id":"rules","node":{"plan":
> "..."}} first. Say in words what this organ does — what it owns, reads, writes, and does
> each tick. Architecture written in meaning-space survives; architecture that emerges from
> syntax is an accident that compiled.`

The ⬢ NODES panel shows plans — the dock becomes the world's living architecture document.

### 5 · BUILD — code as transcription
Now, and only now, WGSL and hooks — each visual carrying its look as its header comment
(prose and code as one act, the old instance's habit). Layered fields per the painter's model,
never a monolith wearing a nice coat.

### 6 · SEE — element-scoped verification *(new probe capability)*
`render_probe {look: "bumper"}` returns the element's region cropped/zoomed **beside its look
text** — the question is not "does it render" but "**is this that?**" For `moment_*` looks:
hooks declare `wd.__moments` timestamps; the probe captures those exact frames. Ten looks per
element was the old instance's floor; the flow makes each look cheap enough to take.

### 7 · CONFESS — the critique pass
`brief_done`'s acceptance response carries the **look-checklist**: every look → `verified
(frame evidence)` / `waived (reason)` / `UNEXAMINED`. Unexamined entries on an accepted build
read as loudly as a red rung. The honest ship sentence grows one clause: *"…and every named
look was seen, or its waiver says why."*

### 8 · SHIP
Publish. The looks, design, plans, and genesis stream **travel with the world** — a fork
inherits not just the code but the *intent*. The commons becomes a library of compiled
imaginations; that is how a lineage compounds.

## Delivery — how it reaches every AI, permanently

1. **The bridge enforces** (stages 2–4) — server-side, like the render and perf gates.
2. **Refusals teach** — the error text is the curriculum, carrying the why, arriving at the
   exact moment of need, to AIs that never read a doc.
3. **The guide restructures** — THE STAGED BIRTH becomes the spine of the Quick Start; the
   first commands an AI learns are the staged ones.
4. **The connect prompt walks the stages** (`lib/invite.ts`).
5. **GET carries looks** — reading a field returns its look, so an editing AI inherits the
   compiled imagination of whoever built it, and edits honor or consciously break intent.

## Legacy neutrality

Worlds born before the law: all gates **warn, never break**. Enforcement keys off a
birth-stamp (`worldData.__stagedBirth = 1`, written by brew from the cutover date).

## Acceptance test

Rebuild percolator through the staged flow — same world, same builder that failed cold — and
compare. If the rails produce the table the one-pass build didn't, they'll work on strangers.

## Non-goals, named honestly

No rail makes a builder care. These make *not-imagining impossible to hide* — which is what
the vision law proved is enough to move the median. The brain hot-state loop and human
co-tuning (pixel playback) are the upgrade path above this trunk, not gated here.
