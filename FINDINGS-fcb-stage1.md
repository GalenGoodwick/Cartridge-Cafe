# FCB Stage 1 — findings from the render-target investigation

Branch: `fluid-control-channels`. Date: 2026-08-04.
Goal: feed the real FLUID solver's velocity into control channels (depth/normal/flow/matID)
via a cross-pass buffer, as the producer half of a neural-video pipeline.

## What the real code says

- **globewarp is NOT a fluid** — analytic raymarched cosmos + portal lens. No velocity. Irrelevant.
- **FLUID (main snapshot) IS a real stable-fluids solver** (`.engine-versions/FLUID/1784420059316.json`,
  effect `fl_sim`): semi-Lagrangian advection + divergence damping. It computes and stores real
  per-cell velocity: `result = vec4f(vel/VS, dye, a)`, `VS=220` → `.rg`=velocity/220, `.b`=dye.
- Velocity lives **only** in the per-effect private feedback buffer (`fbStateNext`, `@group(3)`,
  `shaders.ts:1129`). No other pass can bind it. The solver's own display can't read it either —
  so `visual_fluid_base` **fakes** the swirl with an analytic `fluidVel()`. The real velocity and the
  render-target system exist in the same engine and never touch.

## Three blocking facts discovered empirically (Fluid Control Channels world, guest token)

1. **`create_field {renderTarget}` is buggy.** The key is whitelisted (`space-store.ts:160`) but at
   store time the field is saved with `properties: cmd.properties` (`space-store.ts:300`) and
   `renderTarget` arrives top-level — never copied into `field.properties`. Silently dropped.
   Only `set_visual {renderTarget}` (`space-store.ts:751-757`) assigns it correctly.

2. **Render targets are entirely unexercised.** `grep create_render_target|sampleTarget` across every
   scene + cartridge = 0 hits. The cross-pass capability is scaffolding (client resolver at
   `FieldEngine.tsx:3915`, shader write at `shaders.ts:2135-2156`, sample at `1633-1668`) that has
   never been wired end-to-end through bridge→store→render.

3. **The headless render_probe cannot verify feedback / cross-frame state.** A self-incrementing
   ping-pong through a render target AND a `prevHere()` counter BOTH read empty (~1 increment, no
   accumulation). Every probe reports `frames: 1`. The probe renders from cold, cleared buffers with
   ~1 frame of history. Therefore render targets, `prevHere/prevAt`, and per-effect feedback all read
   zero in the probe. **Any stateful sim is invisible to the probe.** Stage 0 worked only because it
   was purely analytic (function of time+uv, no memory).

## ROOT CAUSE — render targets are structurally non-functional in the fused renderer

After reading the client renderer path (`renderer.ts`), the reason `sampleTarget` always reads ~0
is not the probe being cold. It is two architectural facts that make the feature effectively
write-only:

1. **Targets are cleared EVERY frame** (`renderer.ts:3604-3612`): before the super dispatch,
   `encoder.clearBuffer(entry.buffer, ...)` zeroes every render target unconditionally. So a
   cross-frame read (this frame reads last frame's write) always returns 0. No persistence.
2. **Single fused super dispatch — reads precede writes.** Render-target *writes* happen in a
   second loop (`shaders.ts:2135`, "Re-scan visible fields here") AFTER the main accumulation loop
   where visuals run. A consumer visual's `sampleTarget()` executes in the accumulation loop,
   BEFORE any field's render-target write in the same invocation. So a within-frame read also
   returns the just-cleared 0.
3. **No consumer dispatch.** Nothing reads the targets after the super pass writes them — the blit
   reads `accumBuf`, not targets. Confirmed: only one dispatch touches targets.

Net: the write path exists (`renderTarget_i[idx] = ...`) but there is no path by which any pass
reads back a non-zero value. The feature was scaffolded (bindings, resolver, layout, write loop)
and never completed with either persistence or a consumer pass. That fully explains 0 shipped
usages and every empirical zero read.

Note the per-effect FEEDBACK buffer is different — it DOES persist across frames (ping-ponged
`fbStatePrev`/`fbStateNext`), which is how the FLUID solver holds velocity. The gap is purely that
no *other* pass can read it, and render targets — the intended cross-pass bridge — are incomplete.

## Two candidate engine fixes (Galen's call — both need live-GPU verification)

**A. Persistent render targets (small, surgical, recommended).** Make the per-frame clear at
`renderer.ts:3610` OPT-OUT per target (add a `persist` flag on `create_render_target`; default keeps
clearing so all existing behavior is byte-identical). A persistent target is a cross-frame ping-pong
buffer: a field writes it this frame, reads it (via `sampleTarget`) next frame — one-frame latency,
which is fine for a fluid/video pipeline. This turns render targets into the persistent state store
the solver-as-world-content approach needs, WITHOUT touching the hot effect pipeline. ~10 lines.

**B. Two-pass consumer (larger).** Split the super dispatch so producer fields write targets, then a
second dispatch runs consumer visuals that read them — within-frame, zero latency. Correct but a real
restructure of the core frame loop; higher blast radius.

Recommend **A**: smallest change, legacy-neutral by default-off, gives persistence which is what a
solver needs anyway. Then the FLUID solver ports to a render-target ping-pong entirely in world
content (no effect-pipeline surgery), and the Stage-0-proven channel math reads it.

**Neither is headless-verifiable** — both are cross-frame/feedback and the probe renders ~1 frame
from cold. Verification = live tab on Galen's GPU or a local dev server + local-render eye.

## Consequence

- The "world-content only" shortcut (render-target ping-pong solver) is **not available** — the
  feature is non-functional through the current stack.
- Stage 1 requires **engine work**, and **no form of it is headless-probe-verifiable**. Verification
  requires a live tab on a real GPU (continuous frames) or a local dev server + live-render eye.

## Recommended path (pending Galen's call)

**Fix + finish the render-target cross-pass as a general engine capability** (multi-pass for ALL
worlds, not just fluid). Lower risk than hot-path effect surgery — additive scaffolding already
present. Then fluid→channels is pure world-content.

Concrete work:
1. **Bug fix (done on this branch):** copy `cmd.renderTarget` into `field.properties` in `create_field`
   (`space-store.ts`), mirroring `set_visual`. Correct-by-construction vs the working path.
2. Verify `create_render_target` → buffer allocation → `resolveRenderTarget` → `shapeDims[3]` →
   shader write (`renderTarget_i[idx]`) → `sampleTarget` read works end-to-end **in a live tab**.
   (The store round-trips `properties`; confirm the client renderer allocates + binds targets and that
   the write path with alpha=1 gives clean overwrite semantics for solver state.)
3. Port the stable-fluids solver (from `fl_sim`) into a render-target ping-pong: field A reads
   `sampleTarget(0)` (prev state), advects, writes `vec4f(vel/VS, dye, a)` to target 0 (alpha=1
   overwrite); field B samples target 0 and derives the 4 channels (math proven in Stage 0
   `control-channels-fcb-stage-0`).
4. Verify live. Then the neural-renderer plug (Stage 2) consumes the same target.

## STATUS 2026-08-05 — Option A implemented on branch (UNCOMMITTED, UNVERIFIED)

Persistent render targets built end-to-end. Diff (typechecks clean, 0 errors):
- `store.ts` — `RenderTargetDef.persist?`; `addRenderTargetDef(name, persist)`.
- `bridge/route.ts` — passes `cmd.persist` to `addRenderTargetDef`.
- `agent/route.ts` — `create_render_target` type gains `persist?`.
- `renderer.ts` — `renderTargets` map carries `persist`; `createRenderTarget(name, persist=false)`;
  **the per-frame `clearBuffer` loop now `continue`s past persistent targets** (the core change).
- `FieldEngine.tsx` — both the command handler and world-load replay pass `persist` through.
- `space-store.ts` — (earlier) `create_field` now folds top-level `renderTarget`/`sampleTargets`
  into `field.properties` so the assignment round-trips.

Semantics: a `persist:true` target is never cleared → holds state across frames. A field writes it
this frame (alpha=1 in the render-target write loop = overwrite); a consumer `sampleTarget()`s it and
reads LAST frame's value (one-frame latency — correct for a ping-pong solver). Legacy targets still
clear every frame → every existing world byte-identical.

Demonstrator authored: `fcb-demonstrator.json` — a screen-space stable-fluids solver (ported from
`fl_sim`) writing real velocity+dye into the persistent target `state`, plus a 4-quadrant channel
viewer (depth/normal/flow/matID) reading it back with the Stage-0-proven math.

### KNOWN RISK to check live: in-place read/write race
The solver reads `sampleTarget(0)` at neighbor pixels while the dispatch also writes `renderTarget_0`.
Single buffer → some reads see this-frame writes, some last-frame (no cross-dispatch barrier). Classic
in-place-update race; often visually tolerable for advection, but if it looks noisy/unstable the fix is
double-buffering (two persistent targets, swap by frame parity). Decide after seeing it live.

### HOW TO VERIFY (only path — no headless option exists)
The change is in the browser engine (`renderer.ts`/`FieldEngine.tsx`). `render_probe` renders via the
Railway render-service's OWN engine copy from cold, so it CANNOT exercise this branch or a feedback sim.
Verification requires the branch code in a real browser + real GPU:
1. In `cafe-fcb-wt/web`: `npm run dev` (branch engine on localhost).
2. Brew/open a world against localhost, POST `fcb-demonstrator.json` as `{commands:[...]}` with its token.
3. Open the world in the browser. Watch several seconds: the four quadrants should show a LIVE fluid —
   dye plume (depth), its shaded normals, a smooth flow colorwheel that swirls, and matID regions that
   move. If quadrants are black/static, the persist path isn't feeding back — check `[RTT]` console logs
   and the race note above.

### Verification reality

The pixel-eye-verify skill exists because probe ≠ live. Here it's absolute: **the probe is blind to
this entire class of work.** Live tab (Galen's GPU) or a local dev server + local-render eye is the
only verification. Do not trust a clean probe as evidence a stateful sim works.
