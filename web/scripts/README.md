# scripts — offline world-verification tools

Tighten the build loop for cartridge.cafe worlds: catch **compile errors** and
**logic bugs** locally in ~1s, instead of only discovering them at `render_probe`
time (a slow, sometimes-flaky cloud round-trip). What's left for the eye is then
only "does it *look* right" — the one thing that genuinely needs to be seen.

Three layers of verification, fast → slow:

| layer | question | tool | needs |
|-------|----------|------|-------|
| compile | does the WGSL assemble? | `wgsl-check` | naga |
| logic | do the game rules behave? | `hook-check` + a spec | node |
| pixels | does it look right? | `render_probe` (bridge) | the cloud eye |

## wgsl-check — does the shader compile?

Reassembles a world's **whole uber-shader** (every module + visual, with optional
local edits overlaid) on the engine's real helper library, and runs
[`naga`](https://github.com/gfx-rs/wgpu/tree/trunk/naga) — the same WGSL validator
the browser's WebGPU stack uses. Catches reserved words (`target`, `_`),
undefined functions (including cross-module gaps), type mismatches, and brace
faults, mapped to the owning module + line.

```bash
cargo install naga-cli            # one-time — puts `naga` at ~/.cargo/bin/naga

npm run wgsl-check -- --slug tideglass                 # validate the live world
npm run wgsl-check -- --slug tideglass --override ./my-modules   # with local edits
npm run wgsl-check -- --snapshot ./snap.json           # from a snapshot file
```

`--override <dir>` overlays `<moduleName>.wgsl` files onto the snapshot's modules
— so you validate the exact assembly the GPU would see before deploying a change.

## hook-check — do the game rules behave?

Runs a world's **step hook** (its game logic) in node against a mock sim that
mirrors `world-sandbox.ts`, and runs a per-world **spec** of assertions. Catches
rule bugs — a broken gate, a duplicated item — before a playtest.

```bash
npm run hook-check -- --slug tideglass --spec scripts/specs/tideglass.hook.mjs
```

A spec is an ES module default-exporting `(harness) => void`; `harness` provides
`runWorld(hookCode)` → `{ tick, settle, click, save }` and an `asserter`. See
`scripts/specs/tideglass.hook.mjs` for the pattern. The mock sim lives in
`scripts/lib/hook-harness.mjs` and **must be kept in sync with world-sandbox.ts**
(a method the real sandbox adds must be mirrored here, like the chapters/trigger
primitives).
