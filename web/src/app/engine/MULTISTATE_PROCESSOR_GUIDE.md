# Multistate Processor Guide

How to build **one world that holds many states** — a single cartridge whose
visual is a state space, not a picture. It selects which state is live, transitions
between them, nests states inside states, and can remember where a player was. This
is the *contained* alternative to a graph of linked worlds: nothing lands on main,
the whole structure lives inside one shader module.

Read `AI_ENGINE_GUIDE.md` first — this builds directly on `define_visual`, the
`visual_*` signature, `worldData`, `gpuUniforms`, and `render_probe`.

---

## 0. When to reach for this

- **A hub that contains its worlds** (The Crossing): nine biomes paging inside one
  cartridge, not nine cartridges on the shelf.
- **Chapters / acts**: staged content in one world.
- **Hidden depth**: a metagame whose map is a tree of states, invisible until found.
- **A tournament host**: a rotating roster of candidate worlds competing in one frame.

If instead you want separate, independently-owned, portal-linked worlds, that's a
**world graph**, not a processor — different tool. A processor is one PlayerSpace.

---

## 1. The core idea

A normal visual returns a picture. A **multistate processor** returns
`select(state, pixel)` — the picture of whichever state is currently live. The
state is chosen by a *driver* (time, a uniform, an input edge, a discovered
condition). Everything is one `define_visual` on one full-screen field.

```
state space  ─(driver)→  active index  ─(pick)→  sub-state shader  ─(transition)→  pixel
```

Three parts, in order: **compose** the states into one module, **select** one,
**transition** between them.

---

## 2. Composition — many states in one module

Each state is an ordinary `visual_*` shader. Dropped into one module together they
**collide**: two states that both define `fn noise(...)` or `fn h21(...)` is a
duplicate-definition compile error. So **namespace every state before composing.**

The recipe (proven — this is how The Crossing folds nine biomes into one visual):

- Rename each state's entry `fn visual_<x>` → `fn g<i>_main`.
- Prefix every *other* function it defines with `g<i>_`.
- Leave calls to engine builtins alone (they're not `fn`-defined in the source).

A tiny transform does it (regex on `fn (\w+)`), applied per state `i`:

```
# for state i, wgsl string:
#   fn visual_tidewater(...)  ->  fn g0_main(...)
#   fn h21(...) / calls h21() ->  fn g0_h21 / g0_h21()
```

Then a **pick ladder** dispatches to the chosen state, and a **master visual**
drives selection:

```wgsl
fn pick(idx: i32, uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  if (idx == 0) { return g0_main(uv, sdf, color, time, params, behind); }
  if (idx == 1) { return g1_main(uv, sdf, color, time, params, behind); }
  // …one line per state…
  return g8_main(uv, sdf, color, time, params, behind);
}

fn visual_processor(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let n   = 9;
  let cur = i32(uni(0));                 // driver → active index (see §3)
  let nxt = (cur + 1) % n;
  let t   = uni(1);                      // 0..1 transition progress
  let a = pick(cur, uv, sdf, color, time, params, behind);
  let b = pick(nxt, uv, sdf, color, time, params, behind);
  return mix(a, b, smoothstep(0.82, 1.0, t));   // crossfade (see §4)
}
```

Only the taken `if` branch executes, so a two-way crossfade costs **2** state
evaluations per pixel, not N. Register with one `define_visual` whose `wgsl`
contains *all* the `g<i>_*` functions + `pick` + `visual_processor`, then one
full-screen field with `visualType: "processor"`. Send it as **one batch** (§8).

> **Self-contained shaders only.** The headless `render_probe` compiler does NOT
> inject the engine utility library (`hash21`, `fbm`, `vnoise`, `hsv2rgb`, …). Any
> state that calls one fails to compile. Every state must inline its own helpers —
> which also means namespacing is enough to guarantee no collisions.

---

## 3. Selection drivers — what chooses the active state

The *only* thing that changes between an ambient auto-cycler and a playable
metagame is the driver feeding the active index. Same `pick`, different source:

| Driver | Active index | Needs a hook? | Use |
|---|---|---|---|
| **Time** | `i32(floor(time / T)) % n` | no | ambient cycle, chapters that auto-advance |
| **Uniform** | `i32(uni(0))` | a hook writes `gpuUniforms[0]` | logic-, score-, or event-driven state |
| **Input edge** | hook increments an index on `input.pressed` | yes | player pages/navigates states |
| **Condition / secret** | hook sets the index when a hidden condition is met | yes | descent — the door to a deeper state |

Pure-time drivers render with **no step hook at all** (the shader animates off
`time`). Any *chosen* transition — a player paging or unlocking — needs a hook to
write the uniform. Hooks run fine in the deployed app (a live game like QUANTIC
DOJO is one big hook); write the index from the hook, read it in the shader:

```js
// step hook: page with ←/→, publish the active state to the shader
const wd = sim.worldData; const inp = wd.input || {};
wd.__g ??= { idx: 0 };
if (inp.pressed && inp.pressed.right) wd.__g.idx = (wd.__g.idx + 1) % 9;
if (inp.pressed && inp.pressed.left)  wd.__g.idx = (wd.__g.idx + 8) % 9;
wd.gpuUniforms = [ wd.__g.idx, wd.__g.trans || 0 ];
```

---

## 4. Transitions

Cross-state motion lives in the master visual. Two patterns:

- **Crossfade**: `mix(pick(cur), pick(nxt), smoothstep(0.82, 1.0, t))` — evaluate
  the incoming state only during the last stretch of the dwell, so most frames pay
  for one state.
- **Spatial wipe / iris / warp**: choose per pixel — `select(cur or nxt, f(uv, t))`.
  A black-hole iris that pulls the current state into a point and blooms the next
  out of it reads as *descending*, not switching.

Drive `t` from the same clock as the index so image and (optional) audio move as
one. Keep the incoming state dark until the wipe reaches it to avoid a double-bright
flash through the bloom pass.

---

## 5. Nesting — states of states

A state returned by `pick` can itself be a processor: its `g<i>_main` computes its
*own* sub-index and calls a deeper `pick`. That makes the state space a **tree**,
and the top-level world the **root you always return to**. Hidden games live down
branches; the entry point looks like one quiet world until a driver (a secret, a
sequence, a held gaze) moves you down.

Rules that keep a tree sane:
- **One root that recurs.** The trunk is the frame; descents resolve back to it.
- **Budget the depth, not just the breadth** — every visited leaf is still 1–2
  shader evals; the tree is cheap because only the active path renders.
- **Name by path** (`g2_1_main`) so a whole subtree stays collision-free.

---

## 6. Persistence — remembering the state

Ambient processors are stateless (every visit starts at the root). For a metagame,
opt in and let the engine save per-player:

```js
// once:  set_world_data { "data": { "persist": true } }
sim.worldData.save ??= { deepest: 0, unlocked: [0] };   // per-player slot
sim.worldData.save.deepest = Math.max(sim.worldData.save.deepest, wd.__g.idx);
```

The root greets everyone the same but remembers how far *this* player descended —
the spine of a metagame. Reset per-session latches on `worldData.__fresh`; keep the
saved progress itself.

---

## 7. The roster & the tournament (a processor that repopulates)

A processor's state slots need not be fixed. Treat them as a **roster of host
slots** and run selection *on the worlds themselves*:

1. **Populate** — a builder (or a swarm) produces a candidate state shader; namespace
   it and slot it into a free host index (recompose the master `define_visual`).
2. **Compete** — the hosted states are the tournament field; players judge by an
   auto-metric (dwell, return visits, descent depth) or explicit votes.
3. **Promote** — the champion graduates *out* as its own standalone world
   (`create_world` with its shader) and its slot frees.
4. **Swap / eliminate** — losers free their slots; refill from the queue.

The processor is the permanent arena; main fills with graduates. Incubate as
shaders-*in*-the-processor (nothing on main until promotion). The graph-orchestrator
daemon is the natural feeder: watch for empty slots → dispatch builds → compose
winners in → promote champions out. Store the roster + lineage in the `WorldGraph`
tables.

---

## 8. Write safety — the pitfalls (learned in blood)

- **ONE batched write per world per change.** Every bridge write is a fresh
  read-modify-write of the snapshot; firing several in quick succession at the same
  world **races**, and a lost write silently **drops a visual** (a backdrop field
  suddenly renders nothing, "visual X not found"). Compose the whole change into a
  single `{"commands":[…]}` batch. If you must send sequentially, space them.
- **Namespace or die.** Two states sharing a helper name = duplicate-definition
  compile fail for the *whole* module. Prefix per state (§2).
- **Shaders are self-contained.** No engine-util calls (§2 note).
- **Budget.** Combined uber-shader source ≤ ~300KB; ≤16 field dispatches/frame.
  Nine full biomes compose to ~35KB — fine. If a full-screen processor is heavy,
  set `worldData.renderScale = 0.6–0.7`.
- **No physics on composited layers.** Stacked visual fields with `collisionForce > 0`
  shove each other every frame — the world vibrates and fields drift off-screen.
  Set `{ "gravity":0, "friction":1, "collisionForce":0, "boundaryMode":"solid" }`.
  Prefer ONE full-screen field carrying all states over many overlapping fields.
- **Deleted/broken visuals quarantine silently.** Re-`define_visual` to clear.

---

## 9. Verification — see every state, not just one

A processor renders *one* state per probe. Verifying it means sampling the state
space:

- `render_probe` at several `ticks` values (e.g. 30, 900, 1600) so `time` lands on
  different states — confirm each renders and the index actually advances.
- Check `ok:true` and read `errors[]` (exact WGSL line) on every compose; a single
  bad state fails the whole module.
- `?action=describe` for a no-GPU structural x-ray (fields, registered visuals,
  which visual each field uses) — the fastest way to catch a dropped backdrop
  (field references a visual that isn't registered).
- Confirm `meanLum`/`coveragePct` per sampled state — a black sample = that state
  didn't compile or is off the driver's range.

---

## 10. Environment & constraints

- **Hooks run** in the deployed app — a live hook-driven game is proof. Chosen
  transitions (paging, unlocking) are available; you are not limited to auto-cycle.
- **No new worlds on main.** A processor's states live *inside* one PlayerSpace.
  Only **promotion** (§7) is allowed to materialize a standalone world.
- **The key can build, not delete.** A `uc_st_` world key builds and mutates its
  own world; deleting or re-parenting a world needs the owner session/UI.

---

## Appendix — minimal working processor (auto-cycling, no hook)

```
POST /api/engine/bridge  (Bearer <uc_st_ world key>)  — ONE batch:
{ "commands": [
  { "type": "reset" },
  { "type": "set_world_params", "params": { "gravity":0, "friction":1, "collisionForce":0, "boundaryMode":"solid" } },
  { "type": "set_world_data", "data": { "renderScale":0.7,
      "instructions": "No controls. Watch.\n\nStates rise in turn." } },
  { "type": "define_visual", "name": "processor", "wgsl": "<all g_i functions + pick + visual_processor>" },
  { "type": "create_field", "name": "stage", "shape":"rect", "x":256, "y":256, "w":512, "h":512, "visualType":"processor" }
] }
```

With a time driver inside `visual_processor`
(`let cur = i32(floor(time/6.5)) % n;`) this cycles all states full-screen, no hook,
CSP-proof. Swap the driver for `uni(0)` + a paging hook to make it navigable. Add a
deeper `pick` inside any `g<i>_main` to make it a tree.
```
