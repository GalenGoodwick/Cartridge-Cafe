# SAVE STATES — the universal cartridge save architecture

**Galen, Aug 7 2026:** "all cartridges need a universal save architecture connected to the
user's save state db. technically we can save this like an emulator or ROM with save states."

## The emulator model

- **ROM** = the cartridge as authored: fields, shaders, hooks, worldParams, and the
  *authored* worldData (spawn state, config, design). The ROM is written ONLY by
  design actions — bridge deploys, set_world_data, version saves. **Playing a
  cartridge never rewrites the ROM.**
- **SAVE STATE** = the machine's RAM dump, per player: every worldData key the live
  sim has moved off the ROM baseline. Captured by the ENGINE — the world's hooks
  need zero cooperation. Stored in the existing save DB (per-user scoped slots,
  guests included via the strong anon token).
- **Boot** = ROM + your save state overlaid. No save state = clean boot from ROM.
  "Reset to cartridge" comes free (delete the slot).

This is universal where `wd.save` adoption was per-world: veilfire keeps its whole
player in `wd.__vf` (position/hp/score/weapons/relics) — under save states that key
diverges from baseline during play, so it lands in the player's save state and stops
riding the shared snapshot. Zero changes to its 41 hooks. The Aug 7 leak (a guest tab
inheriting — and a session overwriting — another player's position/weapon) dies as a
class.

## State taxonomy → mechanism (Galen's four classes)

| class | example | mechanism |
|---|---|---|
| 1 player-persistent | position, score, inventory, `__vf` | **save state** (default for ALL runtime divergence) |
| 2 world-persistent | MOORING lanterns, KINDLE fire | `worldData.__shared = ['lanterns', …]` — declared keys keep today's semantics (owner sync → shared snapshot) |
| 3 round-transient shared | arena instances | arena service (server-side), untouched |
| 4 session-transient | input, per-frame buffers | never persisted (existing denylist + worker globals) |

`wd.save` (the Jul 30 channel) keeps working unchanged — worlds already cut over
(tideglass, pentarch) are simply worlds whose only divergent key is `save`.

## Mechanics

**DEFAULT-ON (Aug 7, Galen: "no more leaks"):** every SPACE is a rom world unless it
declares `worldData.__saveArch = 'legacy'` (globewarp holds legacy until the design-
mode bypass exists). `'rom'` remains as an explicit opt-in marker. Scenes (/play)
and the personal editor never set a baseline — play sessions don't write back and
the editor is a design surface. Communal declarations shipped with the flip:
kindle `__shared:['__k','__trail','__nudge']` · bloop `__shared:[players,playerCount,
multiplayer,mpManifest,__io,__edge]` · pentarch `__shared:['__lobby']`.
Implies persist semantics — no separate `persist:true` needed.

**Baseline:** at snapshot apply, the engine deep-clones the applied worldData →
`romBaselineRef`. This is the boot state.

**Capture (autosave loop, debounced like today):**
`captureSaveState(worldData, baseline, shared)` → every key where
`JSON(current) !== JSON(baseline)`, minus the hard denylist (input, gpuUniforms,
gpuPopulation, hud, cellSample, presence/engine keys, `__nodes`, `__bridge_rev`,
`last_hook_error`, …), minus `__shared` keys. POST to slot `<world>:__state`,
scope=user — the same save API, same guest scoping, same quarantine-logged deletes.

**Restore (entry):** after snapshot apply + baseline capture, GET the slot and
overlay onto worldData; `sandbox.injectState(data)` outranks in-flight worker
replies for 4 frames (the proven `injectSave` pattern).

**ROM protection (the leak fix):** for rom worlds, the owner 2s sync strips the
same captured-state keys from `filterSyncWorldData` — the shared snapshot carries
only ROM + `__shared`. Player state stops circulating entirely: not to the DB, not
to other tabs, not to probes.

**ROM upgrades:** save states are per-key overlays, so a redeployed world's new
baseline shows through for any key the player never diverged — emulator savestate
semantics with graceful ROM updates. (A world can force-invalidate by renaming a
key.)

**Slots:** `__state` is slot 0 (autosave). Named slots (`<world>:__state:2`),
export/import (`.cartridge` + savestate file), and a save/load UI are trivial
extensions of the same capture/restore pair — not in v1.

## V1 caveats (named, not hidden)

- **Owner in-tab design edits** on a rom world would classify as divergence and be
  stripped from the ROM sync. V1 rom worlds are bridge-authored (veilfire law:
  world content via bridge only), so this doesn't bite; before default-on, a design-
  mode session toggle must bypass capture.
- **Deep-diff cost:** per-key JSON compare at the 4s debounce on worldData-sized
  objects — measured, and keys are compared lazily (stringify once per key).
- **Multiplayer worlds** that share state through worldData (not arena) must declare
  `__shared` before opting in, or players stop seeing each other's world effects.

## Files

- `engine/persistence/serialize.ts` — `SAVE_STATE_DENY`, `captureSaveState()`,
  `stripKeys()` (pure, unit-tested)
- `engine/FieldEngine.tsx` — baseline ref at snapshot apply; `__state` load in
  `tryLoad`; capture in the autosave block; strip in the 2s sync
- `engine/world-sandbox.ts` — `injectState()` (the `injectSave` twin)
