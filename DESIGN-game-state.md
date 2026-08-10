# DESIGN — The Universal Game-State Engine

**Status:** SPEC — not started. When built, work happens on a branch cut from `origin/main`
in a fresh worktree. **Never merged to main without Galen's explicit word** (main
auto-deploys to prod).

**Author:** Claude (Fable), Aug 9 2026, after root-causing a chain of veilfire-3d failures
(the every-tick `__vf` wipe freeze, the weapon flicker, the `__nodes` reset wipe) that all
trace to one absence: there is no single system that owns a game's state lifecycle.

**Motive (Galen):** "Perhaps the issue is we have no universal game-state engine which
manages saving and hook/shader state for games — instead we hand-roll it in veilfire."
Correct. This spec is that engine.

---

## 0. Goal / non-goals

**Goal:** One engine-owned system that, from a single per-world **manifest**, drives the
entire lifecycle of a game's state: **init → persist(save/load) → reset(to original) →
death/respawn → per-session refresh**. A world *declares* its state shape once; the engine
*runs* every lifecycle operation off that declaration. No hand-rolled `__resets`, no
hand-rolled `__fresh` handling, no per-world init boilerplate, no per-world save/load code.

This is the same philosophy already proven by the **node-runtime** (`worldData.__nodes` /
`owns` / declared `order` — the engine runs execution off a declaration) and by **THE RESET
LAW** (`set_original` → restore `__original`). This spec unifies those with persist/save
under one manifest, and closes the `__fresh` gap.

**Non-goals (hard):**
- NOT a rewrite of the node-runtime or the renderer. State ≠ execution ≠ pixels; this owns
  only *state*.
- NOT a new sandbox. Hooks still run in the Worker; this changes *what the engine does to
  `worldData` around them*, not how they execute.
- NO forced migration. **Legacy-neutral**: a world with no manifest behaves exactly as it
  does today (the reset law's empty-original path, hooks self-init). Opt-in first.
- NOT a visual/shader state store. "hook/shader state" in the motive means *the JS state
  that drives shaders via uniforms* — the manifest governs `worldData`, and shaders read
  uniforms as they already do. Shader *source* lives in the module/visual registry, which
  is out of scope.

---

## 1. What exists today (verified audit, Aug 9 2026)

Four disconnected pieces, no unifying layer:

| Piece | File | What it owns | Gap |
|---|---|---|---|
| **Reset law** | `lib/gameStateKeys.ts`, `lib/worldSave.ts` | `resetPatch`/`setOriginal`/`__original`; `PRESERVED`/`DERIVED` key categories; `__resets` declared holders | Categorization is GLOBAL heuristics (key-prefix + two static sets), not per-world declared. A world can't say "this non-`__` key is progress" except via the `__resets` array. |
| **Persist/save** | `FieldEngine.tsx` (~433–497) | `worldData.persist` → engine auto-load/save of the per-player `worldData.save` slot (debounced + pagehide flush) | The world must read/write `save` **by hand**; nothing says *what* of the game state belongs in it. No link to the reset law (save vs reset use different notions of "state"). |
| **Game-state machine** | `simulation.ts` (`defineGameState`/`setGameState`), `types.ts` `GameStateDef` | A named current-state string + `pausePhysics` + onEnter/onExit | Shallow and unpersisted (not in `SceneSnapshot`). Effectively a physics-pause toggle. Not a state manager. |
| **`__fresh`** | `FieldEngine.tsx` sets it; `world-sandbox.ts` clears (post-fix Aug 9) | Per-session "reset your worker-globals" signal | Just fixed to be a true one-shot. But it's still an *untyped signal each hook interprets*, not a declared lifecycle step. |

**The through-line failure:** every world invents *where* state lives (`__vf`, `__tg`,
`__g`), must *remember* to list it in `__resets`, hand-rolls its *init*
(`if (!wd.__vf) wd.__vf = {}` in ~7 veilfire hooks), hand-rolls its `__fresh` handling
(veilfire got it catastrophically wrong), and hand-rolls its save/load. The bugs live in
the hand-rolling. veilfire-3d today carries **two** reset hooks (`vf-freshreset`,
`vf-fresh-gate`) that exist *only* to compensate for the absence of this engine.

---

## 2. The manifest — what a world declares

One object in `worldData`, authored once (a build-time `set_world_data`, or emitted by the
first hook). Shape:

```js
worldData.__state = {
  holder: '__vf',            // THE key all game state lives under (like __tg, __g)
  version: 1,                // bump to invalidate incompatible saves (see §6)

  // field-level lifecycle classes — dotted paths inside the holder.
  // Anything not listed defaults to `run` (reset on restart, never persisted):
  persist: ['relics', 'crystals', 'hasW4', 'score'],   // survives a tab close (per-player save)
  keepOnDeath: ['relics', 'crystals', 'hasW4', 'score', 'hasBall'],  // survives respawn
  // everything else (px, pz, hp, bolts, enemies, timers…) = `run`:
  //   reset on death, reset on R, never persisted.

  // OPTIONAL explicit base state. If absent, "base" = {} and hooks self-init
  // (today's behavior). If present, the engine seeds the holder with this on
  // init/reset instead of an empty object — the declarative form of set_original.
  base: { hp: 1, weapon: 2, px: 0, py: 1.7, pz: -6 },
}
```

Design rules:
- **Dotted paths** (`relics`, `stats.hp`) address into the holder — the engine walks them;
  a missing path is a no-op, never an error.
- **`run` is the default class.** You declare only what's special (persists / survives
  death). This makes the common case (an arcade run) a two-line manifest.
- The manifest is **CONFIG** (in `PRESERVED_KEYS`): a reset never wipes it.
- Back-compat: a world with `__resets` but no `__state` is auto-adapted — `__resets`
  entries become the holder set with everything classed `run`. Zero-change for legacy.

---

## 3. The lifecycle the engine runs off it

All five operations become engine-owned, driven by `__state`. Each already half-exists;
the manifest makes them one coherent set instead of four disconnected ones.

### 3.1 INIT (world load)
Engine seeds `worldData[holder]` from `base` (or `{}`), then applies the loaded per-player
`save` over the `persist` paths (§3.2). Hooks then run and fill in `run` state. Removes the
`if (!wd.__vf) wd.__vf = {}` boilerplate from every hook (they can trust the holder exists).

### 3.2 PERSIST (save / load) — extends today's `persist` flag
- **Load:** on init, the engine reads the player's `save` slot and copies its `persist`
  paths into the holder. (Today: the world hand-copies `wd.save` → its state.)
- **Save:** the autosave loop already runs for `persist` worlds. It now writes **only the
  `persist` paths** of the holder into `save` — projected by the manifest, so position/HP
  never leak into a save meant to hold relics. (Today: the world must build `wd.save`
  itself and get the projection right — the July "one player's save went world-global" bug
  was exactly a projection error.)
- Presence of ANY `persist` path implies `persist: true` — the flag becomes derived.

### 3.3 RESET (R / `reset_world`) — THE RESET LAW, now manifest-aware
`resetPatch` already restores `__original`. With a manifest it restores the holder to
`base` (declared) rather than deleting-and-letting-hooks-reinit — deterministic, no drift.
`clearPlayer:true` additionally wipes the `persist` save slot (the open question from the
reset-law work — §7). Everything the manifest doesn't mention still clears. `__original`
stays the on-disk truth; `base` is the in-manifest shorthand the engine bakes into it at
`set_original`.

### 3.4 DEATH / RESPAWN — the currently 100%-hand-rolled one
veilfire's `vf-lifecycle` hand-codes "on hp<=0: restore hp/pos/ammo, clear enemies, KEEP
items." That "keep items" list is exactly `keepOnDeath`. The engine offers a **respawn
primitive**: `sim.respawn()` (or `worldData.__respawn = true`, honored like `__fresh`)
resets every `run` path to `base` while preserving `keepOnDeath`. `vf-lifecycle` shrinks to
"detect death → call respawn → play the death fx." One declaration, every game's
death-keeps-items works the same.

### 3.5 REFRESH (`__fresh`) — already fixed, now typed
`__fresh` stays the signal for un-serializable worker-globals (caches, timers). With a
manifest, the engine ALSO does the declared holder reset on `__fresh` (so a hook truly
needs `__fresh` only for its `globalThis.__VF_FNS`-style caches). The Aug 9 one-shot fix
guarantees it fires once; the manifest removes the reason most hooks touched it at all.

---

## 4. API surface

**worldData:**
- `__state` — the manifest (§2). CONFIG-classed.
- `__respawn` — one-shot death trigger (engine-cleared like `__fresh`).

**Bridge verbs (additive):**
- `define_state {manifest}` — set/replace `__state` (validated: holder is a string, paths
  are strings, no path collides with a PRESERVED/DERIVED key). Persisted in the snapshot.
- `set_original` — UNCHANGED verb, now manifest-aware: bakes `base` from the live holder's
  declared classes if a manifest exists.
- `reset_world {player?}` — UNCHANGED; `player:true` now also clears the save slot.

**Simulation (hook-callable, in the sandbox):**
- `sim.respawn()` — thin wrapper that sets `__respawn`.
- No new hook globals otherwise — the engine does the work *around* hooks, not inside them.

**Schema:** add `state?: StateManifest` to `SceneSnapshot` (space-store + serialize.ts) so
it persists and restores. This is the one schema change; everything else is worldData +
existing reset/persist plumbing.

---

## 5. Migration path (legacy-neutral → prove → default)

Mirrors how the node-runtime landed (`__nodes` shipped inert, proven on veilfire, then made
default):

1. **Ship inert.** `define_state` + manifest plumbing land; the engine reads `__state` only
   if present. No manifest = byte-identical to today (verified against the legacy reset/
   persist paths). Legacy `__resets` auto-adapts (§2).
2. **Prove on veilfire.** Author veilfire's manifest: `holder:'__vf'`,
   `persist:[relics/crystals/weapons/score]`, `keepOnDeath:[…]`, `base:{hp,weapon,pos}`.
   Delete `vf-freshreset` + `vf-fresh-gate` (engine now owns `__fresh`), shrink
   `vf-lifecycle` to `sim.respawn()`, drop the 7 `if(!wd.__vf)wd.__vf={}` inits. Verify with
   the existing headless harness (`scratchpad/restore-test.mjs` + a new state-lifecycle
   test): R restores base, death keeps items, tab-close persists relics, movement never
   pins.
3. **Prove on tideglass** (the persist reference). Its `__tg` + baked `__original` become a
   manifest; confirm R stays "perfect" and saves still resume.
4. **Default.** Once two worlds run on it, the brew flow emits a starter manifest, and the
   guide's game section leads with `define_state`. `__resets` becomes a documented legacy
   alias.

---

## 6. Edge cases (from real bugs this session)

- **`__nodes` must never be state.** The registry is infrastructure; it's already in
  `PRESERVED_KEYS`. The manifest validator rejects a holder or path that would touch
  `__nodes`/`__nodeSeq`/`__sandbox`/`__bridge_rev`. (Root cause of the Aug 9 "`__nodes`
  wiped" freeze — the generic `__`-sweep ate it. A manifest makes state EXPLICIT, so the
  sweep is no longer needed at all.)
- **Save version skew.** `version` bump invalidates an incompatible `save` (engine drops a
  save whose `version` < manifest `version`, rather than merging stale shapes) — the
  "progress reverted after a shape change" class.
- **Owner-tab sync vs reset race.** Already handled by the `__bridge_rev` stale-guard (the
  reset-law server-half work). The manifest doesn't touch sync; it only changes what INIT/
  RESET write, which flow through the same guarded path.
- **Two AIs editing live.** The manifest is one CONFIG key; `define_state` goes through the
  node push-gate like any write. It does not fight the node registry.

---

## 7. Open questions (need Galen)

1. **R on persist worlds — wipe the save or not?** Today R restores game-state but leaves
   the per-player save. The manifest makes both trivial; the question is the DEFAULT.
   Proposal: R = restart the run (keep save); a distinct explicit gesture (a "wipe save"
   button, or `reset_world {player:true}`) nukes the save. tideglass R currently "feels
   perfect" under keep-save, which argues for that default.
2. **Is `base` in the manifest, or only `__original` on disk?** `base` is friendlier to
   author but duplicates `__original`. Proposal: `base` is optional authoring sugar;
   `set_original` reconciles it into `__original`, which stays the single runtime truth.
3. **Scope of v1.** Minimal viable = manifest + INIT + RESET + `__fresh` (kills the veilfire
   bug class). DEATH/`respawn` and the persist-projection are phase 2. Recommend shipping
   v1 minimal, proving, then phase 2 — not one big drop.

---

## 8. Why this is the right shape (not over-engineering)

The test for a platform primitive (Galen's standing law): does it *remove* hand-rolled code
and prevent a bug class, or just move complexity? This removes, per world: the `__resets`
array, all `if(!wd.holder)` inits, all `__fresh` handling, all save/load projection, and the
death-keeps-items list — replacing them with one declared object. It prevents, by
construction: the stuck-`__fresh` freeze, the `__nodes`-wiped-by-sweep freeze, and the
save-projection leak — three distinct production freezes this session alone. It is the state
counterpart to the node-runtime's execution model, and it composes with the reset law and
persist/save rather than replacing them. That is a primitive, not a patch.
