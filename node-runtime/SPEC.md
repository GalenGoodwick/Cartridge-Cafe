# node-runtime — the FieldEngine's execution model

**Status:** live rungs spliced into the real engine on branch `node-runtime`. Not the
default yet (opt-in per world), not shipped to cartridge.cafe.
**Owner of record:** opus-a (client + guard + auto-register lanes) · engine-room co-owned with claude-opus.

This is **not an addition to the engine — it is the engine's execution model.** Today a
world is a flat array of step-hooks that run in push order; the last thing pushed has the
final word, and re-pushing a hook silently moves it to the end. That is the whole bug
class (the veilfire weapons clobber, hit ×3). The node runtime replaces "flat array in
push order" with **a registry of nodes run in declared order, each owning a slice of the
uniform whiteboard, every pixel it paints tagged with who painted it.**

## The model

- **Registry = the work graph.** Every hook/piece is a **node**: `{ id, order, owns, ... }`.
  Nodes are what an AI docks, claims, patches, and promotes.
- **Declared order.** The scheduler runs `nodes.sort(order)`, not array order. Push order
  stops mattering. (rung 1)
- **Owned state.** Each node declares `owns.uni` — the uniform indices it may write. A
  frame-end diff flags any write outside that range. Advisory now (logs), strict later
  (drops). (rung 2)
- **Provenance.** Every painted pixel carries an owner index → the node → its code → any
  rival candidate. Click a pixel, learn who made it and why. (seed: live)
- **Superposition + collapse.** Rival candidates for a node coexist, are scored against a
  drifting truth, and the champion is promoted; losers fall to history. (seed: live)
- **Playback.** Color + owner buffer recorded every frame; scrub freezes the sim and
  replays any past frame with provenance intact. Non-destructive floor. (seed: live)

## The rung ladder

| rung | what | status |
|---|---|---|
| 1 | **declared order** — sort by `__nodes[id].order`, legacy-neutral | ✅ all 3 runners (FieldEngine, sim, probe) + tests |
| 2 | **ownership guard** — frame-end diff vs `owns.uni`, advisory | ✅ probe + client runners, 8/8 + 4/4 proofs |
| 3 | **auto-register** — every `add_step_hook` auto-mints a node | ✅ **built + proven (9/9), this rung** |
| 4 | **strict ownership** — out-of-range writes dropped, not just logged | ▫ next |
| 5 | **render manifest** — nodes declare draws; renderer composits by manifest | ▫ |
| 6 | **decompose** — split the 88KB veilfire mega-hook into owned nodes | ▫ |

## Rung 3 — auto-register (the keystone: node-design becomes the DEFAULT)

The first two rungs only help a world that has a `__nodes` registry, and building that
registry was manual (`register_node` per piece). Auto-register removes the manual step:

> **Every hook that enters the engine via `add_step_hook`/`update_step_hook` is
> automatically registered as a node.** First sight mints `__nodes[id]` with a **stable
> order** (an insertion counter — so run order == today's insertion order, *legacy-neutral*)
> and a **best-effort `owns.uni`** inferred from the code's literal `u[N]`/`gpuUniforms[N]`
> writes. **A re-push never changes an auto-node's order** — so re-pushing a hook can no
> longer shove it to the end of the run array. Explicit `register_node` (auto:false) wins
> and is left untouched.

This is the moment "universal" flips on: an AI does nothing special and its piece is
already a clobber-proof, ownership-checked, provenance-tagged node.

- code: `web/src/app/engine/node-autoregister.ts` (+ `.mjs` mirror), called from
  `space-store.ts` `add_step_hook`.
- proof: `node-runtime/proof-autoregister.mjs` — drives the shipped module: builds the
  veilfire world the *default* way (no `register_node`), re-pushes base 10×, weapons lamp
  survives every time; removing the substrate brings the clobber back (falsifier). **9/9.**

## The AI-to-node loop — the stated core methodology

This is how every AI builds on the engine, from now on. It is the same work-graph the
`/world-dock` skill enforces on live worlds:

**DOCK → PULL → SCRATCH → TEST (pixel-first) → PROMOTE (collapse) → UNDOCK.**

1. **DOCK** the node you'll change (`claim.mjs dock`); post to the commons.
2. **PULL** the current live piece — never a private full copy.
3. **SCRATCH** your diff onto it; candidates may superpose.
4. **TEST** pixel-first — probe/readback that your change is live and correct.
5. **PROMOTE** — collapse the champion into the node.
6. **UNDOCK**; post to the commons.

Auto-register is what makes step 5 land somewhere real: the promoted piece is *already* a
node, ordered and owned, the instant it's pushed. Design-in-nodes is no longer a thing you
opt into — it is what adding a hook *is*.

## Ship discipline

Branch `node-runtime` only. Never auto-deploy to cartridge.cafe. Engine-room files
(`render-core.mjs`, `owns-guard.mjs`, `space-store.ts`) are co-owned with claude-opus —
dock the lane and coordinate on the commons before touching them. The TS side
(`node-autoregister.ts`, `world-sandbox.ts`, `space-store.ts`) still needs a real Next
build to type-check — no local tsc; flagged for CI.
