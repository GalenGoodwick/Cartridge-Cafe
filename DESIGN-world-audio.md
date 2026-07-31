# DESIGN — WorldAudio: one sound system for every world

**Status:** Phase A IN PROGRESS on branch `world-audio`. Behavior-CHANGING (unlike the
carve) — current behavior is the bug. Never merged without Galen's word; final gate is
Galen listening with the volume up.

**Grounding:** full audio audit, Jul 30 2026 (11 entry paths, 4 node graphs, 11
silencer sites, 0 restart paths). Key file:line cites inline below.

---

## 1. The diagnosis (from the audit)

- **Music never plays** because every world swap silences it (`resetWorldIdentity`,
  FieldEngine ~1650-1675, all 5 swap sites) and **no restart path exists**. Hooks fire
  `__play_music` on an EDGE (helios: `wd.__mact !== sim.act`); the play-scene stash
  restores the guard from localStorage, so the edge never re-fires. One-way door.
- **SFX is iffy** because: (a) `{name:'x'}` sounds are silently dropped unless
  preloaded (shooter3's gunfire is silent — scenes/shooter3/hooks/audio.mjs);
  (b) autoplay: sounds fire from rAF where the browser refuses to start audio, and
  nothing replays after the first gesture; (c) context birth race — a sound before
  the attach effect gives GameAudio a PRIVATE context that escapes mute and REC.
- The `tone` water voice (cafe-audio `setWorldVoice`) is silenced by **zero** of the
  11 silencer sites — only by the frame loop reading an absent key.
- `music_mod` set before the score starts is dropped (setScoreMod guards on scoreBus).

## 2. The design

### Core semantic change: music is DECLARED STATE, not an event
`wd.__play_music` stops being fire-and-delete. The engine keeps it in worldData,
JSON-compares each frame against the last-asserted payload (`GameAudio.assertMusic`),
and (re)plays only on change. Consequences, all intended:
- Saved scenes/snapshots now CARRY their music → loading a world replays it. The
  no-restart bug dies for every world at once, with zero cartridge edits.
- Per-frame re-asserts of the same payload are free (generalizes 0c3d86c's url-dedupe).
- After the first user gesture resumes a suspended context, the assert-cache is
  cleared → next frame replays cleanly (fixes the autoplay-loss).
- Retrigger-same-score worlds must add a nonce field (e.g. `t`) to force change —
  documented, acceptable.

### Declarative SFX manifest
`wd.sounds = { name: url, ... }` — engine preloads (gen-guarded, blob-store-only, same
`audioUrlOk` law). `{name}` plays then just work. A `{name}` miss logs a loud
warn-once instead of vanishing.

### Complete eject
`resetWorldIdentity` additionally calls `setWorldVoice(null)` (the voice finally has a
silencer) and clears the music assert-cache via `onWorldSwap`.

### One context, born attached
`GameAudio.ensureContext` adopts cafe-audio's `worldBus()` before ever building a
private context → mute + REC always capture world audio; the attach race dies.

### Debug surface (for headless verification)
`window.__cafeAudio()` → `{ ctxState, scorePlaying, musicPlaying, lastAssert }` —
tiny, read-only, lets smokes assert "music is actually running" without ears.

## 3. Invariants preserved (the five fragility fixes)
- f85093e generation guard: late async music can't start over a new world.
- 0c3d86c url dedupe: subsumed by assert-state compare.
- f4346cd uniform swap silence: kept — eject still stops+clears at all 5 swap sites.
- 9397334 worker writeback allowlist: untouched (`tone`/`music_mod`/`__play_*` pass).
- 5495080 lazy-SFX worldGen guard: kept; manifest preloads use the same guard.

## 4. Phase plan
- **A (this branch):** assertMusic state semantics · sounds manifest · voice in eject ·
  context-birth fix · unlock-replay · warn-once on name-miss · debug surface.
- **B (later):** full `WorldAudio.mount()/eject()` consolidation of all 11 silencer
  sites + folding the water voice INTO GameAudio (one node graph) + bridge
  `play_music` command. Rides with the Phase-3 scene-io carve.

## 5. ★ PORTING SOUNDS FROM LIVE WORLDS ON MAIN (Galen's requirement)
Live prod worlds carry their audio in SERVER-STORED state (scene snapshots + step
hooks in the DB/engine store), not in the repo's cartridge files. The port plan:
1. **Back-compat carries most worlds free**: old keys keep working; edge-fired music
   in stored hooks starts persisting (state semantics) the next time it fires, and
   from then on survives swaps/reloads. No touch needed for helios/tideglass-class
   worlds beyond one natural play-through.
2. **Inventory pass (bridge, read-only):** scan stored scenes/hooks on prod for
   `__play_sound`/`__play_music`/`tone`/`music_mod` writers → list of worlds × paths
   (the audit's cartridge list is the repo-side half; prod-side may differ).
3. **Worlds needing an actual port:** `{name}`-only SFX worlds (shooter3 pattern) get
   a `wd.sounds` manifest written over the bridge (`set_world_data`) — an AI session
   with the world key can do each in minutes. Worlds whose music never re-fires
   (guard stashed, act never changes) get their stored `__play_music` state written
   once over the bridge; it persists from then on.
4. Port work happens AFTER Phase A ships and is verified on one world end-to-end.

## 6. Verification gates (per commit, as ever)
tsc · lint parity · build · runtime smoke: inject `set_world_data {__play_music:
{score}}` into a scratch world on dev, assert `__cafeAudio().scorePlaying` flips true,
swap worlds, assert it stops, come back, assert it REPLAYS (the whole point). Then the
ear gate: Galen, volume up, helios + tideglass + a shooter3-pattern world.
