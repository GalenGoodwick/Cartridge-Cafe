# Nested Presence — Spec

**Status:** design only, not implemented (Jul 20 2026). **THREE** attempts have now
broken main cursors and been reverted: `9acbe54`/`b8322c2` (renamed main's room),
then a full-spec attempt that kept main = `CAFE` yet STILL froze main. The third
failure is the important one: **the "main stays `CAFE`" invariant is necessary but
NOT sufficient**, and it fell to a *process* error, not a design one — everything
was shipped at once, so there was again no isolated signal for the actual cause.

**⛔ READ §6 AND §7 BEFORE WRITING ANY CODE.** The binding rule: land the
instrumentation ALONE, verify it live with two browsers, then change exactly ONE
thing per step and get a human two-browser sign-off before the next. Whoever
ignores this — as I did three times — will break main a fourth time.

## 1. Goal (Galen's words)

> Presence in sub-mains AND player worlds. When a player enters a step lower they
> still show on main, but also show in the sub/player-worlds view at the location
> they are in.

Concretely — **nested presence**. At every level you see:
- **Live cursors** of everyone standing *exactly* at this level, at their real
  cursor position.
- **Docked orbs** on each *child* bubble, one per person who descended *into* that
  child. So descending never makes you vanish from the parent — you become an orb
  on the bubble you went through, all the way up to main.

## 2. The two presence systems today (ground truth)

There are **two independent backends**, and the render is split across **three
surfaces**. Any change must respect all of them or main freezes (that's what bit
the last two attempts).

### 2a. Live cursors — Socket.IO (Railway)
- Room = `'cursors:' + world`, where `world = spaceId || presenceKey || playScene || 'global'`
  — `FieldEngine.tsx:868`. (`presenceKey` is a currently-inert optional prop left
  over from the reverted attempt; nothing passes it, so today `world` = `spaceId || playScene`.)
- Clients emit cursor position ~4×/s; server echoes up to 25 others. Others land in
  `worldData.presence` = `[{id,x,y,hue,slot}]`.
- **On the whole hub, `playScene === 'CAFE'` for main AND the player-worlds
  directory** (an in-place filter, scene stays CAFE), so they SHARE `cursors:CAFE`.
  The SUB-MAINS layer is its own scene `'SUB-MAIN'` → `cursors:SUB-MAIN`, shared by
  the directory and every individual sub-main. **This sharing is the bleed.**

### 2b. Docked counts — `/api/presence` (Postgres `cc_presence`)
- Client heartbeats `{ scene, id }` every 12s (`CafeShell.tsx:1062`, currently sends
  the bare top-level `scene`). GET returns `counts[scene]` = live headcount per scene.
- CafeShell polls → `window.__cafeCounts` → cafe-cartridge reads `heads[bubbleName]`
  → docked orbs, drawn **only on main**: `showHeads = (!MF && !SUB && !PL) ? heads[n] : 0`
  (`cafe-cartridge.mjs:1135`). Main bubble names include `'PLAYER WORLDS'`,
  `'SUB-MAINS'`, and each world's own name.

### 2c. The three render surfaces
1. **Shader orbs** — cafe-cartridge packs `wd.presence` into gpuUniforms; the door
   shader draws dancing orbs (`others = wd.presence`, `cafe-cartridge.mjs:1153`).
   **On main this IS the live-cursor display.**
2. **DOM pips** — `FieldEngine` renders `presenceOthers` as CSS pips, gated OFF by
   `worldData.noPresenceCursors`. Currently `noPresenceCursors = !MF && !SUB && !PL`
   (`cafe-cartridge.mjs:1149`) → pips on sub-views, off on main.
3. **Docked orbs** — headcount from `__cafeCounts` (system 2b), main only.

## 3. Why the last two attempts failed (do not repeat)

1. **Renamed main's room.** I switched main from `cursors:CAFE` (via `playScene`) to
   `cursors:cafe:main`. The shader-orb path (2c#1) reads whoever is in main's room;
   changing the key mid-session + timing gaps left main's room empty → **cursors
   froze on main**. → **RULE: never change main's room string. It stays `CAFE`.**
2. **SUB-MAIN scene guard bug.** `presenceKey` short-circuited to `undefined` for
   any `scene !== 'CAFE'`, so the entire SUB-MAIN layer never scoped or nested.
3. **React-state timing.** Keying the room off CafeShell `players`/`subMode` state
   lagged the actual view (they're set by an async event after the morph).
4. **Store, not file, is the source of truth.** Reverting the cartridge `.mjs`/JSON
   did not fix local — `node cafe-cartridge.mjs` had already published the bad hook
   into the engine store; the app loads from the store. Re-seed to publish a clean
   version. (Logged in `cartridge-cafe-workflow` memory.)
5. **Third attempt — bundled every phase, so main broke with no isolated cause.**
   main was pinned to `CAFE` this time, yet cursors still died. The whole spec
   (room scoping + heartbeat rewrite + rollup + overlay) shipped in one change, so
   when it broke there was no way to tell *which* part did it. **The most likely
   culprit — UNCONFIRMED, and that's the point** — is §"FieldEngine socket churn"
   below: `presenceKey` is in the presence effect's dependency array, so every
   time it flips (`undefined ↔ value` as you navigate, or a stray re-render) the
   effect tears the Socket.IO connection DOWN and reconnects. On main, `wd.presence`
   (the dancing shader orbs) is fed by that socket — churn it and main's cursors
   vanish until/unless it re-populates. This was never isolated because Phase 0 was
   skipped. **Do not trust any theory in this doc that is marked UNCONFIRMED until
   the overlay proves it with two live browsers.**

## 4. Location model

Every viewer has one canonical **location path**, `/`-delimited, most-general first:

| Where | Path |
|---|---|
| Main commons | `main` |
| PLAYER WORLDS directory | `main/players` |
| A player world (`/space/<slug>`) | `main/players/space:<slug>` |
| SUB-MAINS directory | `main/subs` |
| A specific sub-main | `main/subs/sub:<slug>` |
| A core/house world (`/play`) | `main/world:<name>` |

This path is the single source of truth for BOTH systems. It is computed by the
**door cartridge** (it already derives `MF/SUB/PL/HOUSE/subKey/mineKey` every frame,
`cafe-cartridge.mjs:519-532`) and, for `/space` and `/play` pages, by those pages
themselves (they know their slug/name directly).

### Presence rules, per level L (path `P`)
- **Live cursors at L** = viewers whose path `== P` (standing exactly here).
- **Docked orb on child bubble C** (path `P/c`) = count of viewers whose path
  `startsWith(P/c)` — i.e. at C or anywhere below it. (Descending shows on every
  ancestor.)

## 5. Design

### 5a. Live-cursor room = the location path — with main pinned to `CAFE`
Room key derived from the location path, BUT **`main` maps to the literal string
`CAFE`** (byte-identical to today) so the working main path is never disturbed:

| Path | Room (`cursors:` + …) |
|---|---|
| `main` | `CAFE`  ← unchanged, non-negotiable |
| `main/players` | `CAFE/players` |
| `main/subs` | `SUB-MAIN`  ← unchanged (already its own scene) |
| `main/subs/sub:X` | `SUB-MAIN/sub:X` |
| `main/players/space:X` | (SpaceStage already scopes by `spaceId`) |

Effect: sub-views LEAVE the shared room, so main's room membership shrinks to
main-level people only — the dancing shader orbs on main become correct without
renaming main. Individual sub-mains separate from the directory and from each other.

The room key is fed to `FieldEngine` via the existing (currently inert) `presenceKey`
prop. **`presenceKey` MUST be empty/undefined for the `main` level** so `world`
falls back to `playScene='CAFE'` exactly as today.

### 5b. Heartbeat the full path; roll up counts by prefix
- Heartbeat sends the **full location path** as `scene` (`CafeShell.tsx:1062` + the
  `/space` and `/play` heartbeats).
- `/api/presence` GET is unchanged (returns exact `counts[path]`). The **rollup is
  client-side** in cafe-cartridge: for each child bubble with path `P/c`, docked
  count = `Σ counts[k] for k startsWith (P/c)`. This keeps the API dumb and puts the
  hierarchy knowledge where the bubbles are named.
- Extends `showHeads` beyond main: the directory and sub-mains ALSO draw docked orbs
  on their child bubbles (currently `showHeads` is main-only). Self is excluded.

### 5c. Render surface matrix (target)
| Level | Live cursors of peers here | Docked orbs on children |
|---|---|---|
| main | shader orbs (room `CAFE`) | PLAYER WORLDS, SUB-MAINS, core worlds |
| players dir | DOM pips (room `CAFE/players`) | each player-world bubble |
| subs dir | DOM pips (room `SUB-MAIN`) | each sub-main bubble |
| a sub-main | DOM pips (room `SUB-MAIN/sub:X`) | its shelf worlds |

`noPresenceCursors` stays as-is (pips on sub-views, shader orbs on main). The only
new work is (i) the room suffix for sub-views and (ii) the docked-orb rollup on
child bubbles at every level.

### 5d. FieldEngine socket churn — the prime suspect (RESOLVE BEFORE PHASE 1)

`FieldEngine`'s presence effect (`world = spaceId || presenceKey || playScene`,
deps `[spaceId, playScene, presenceKey]`) opens the Socket.IO connection in setup
and `socket.disconnect()`s in cleanup. **So any change to `presenceKey` re-runs the
whole effect: disconnect → new socket → re-join.** That means:
- Even on main (`presenceKey` = `undefined`), if it ever momentarily becomes a
  value and flips back (e.g. a stale `cafe:presence` event, a re-render ordering
  quirk), the socket bounces and main's dancing orbs blink out.
- On EVERY navigation the socket fully reconnects, clearing the interpolation
  buffers — a visible cursor gap, and a reconnect storm if you move quickly.

**Phase 1 must first answer, live with the overlay:** does simply toggling
`presenceKey` (with the room string UNCHANGED, still resolving to `CAFE` on main)
already drop main's cursors? If yes, the room-scoping approach via `presenceKey` is
fundamentally the wrong lever and must change to **switch rooms WITHOUT tearing the
socket down** — e.g. keep one persistent socket for the component's life and emit
`leave-instance`/`join-instance` when the room changes (the server already speaks
`join-instance`), moving the room out of the effect deps entirely. Prove the
no-teardown room switch in isolation before it carries any nesting logic.

## 6. Safety principles (hard rules)

### 6a. Process rules — these are the ones that were VIOLATED (all three failures)
1. **One change per step. Never bundle phases.** Each step below is a *separate*
   edit + commit that changes exactly one lever. Attempt 3 shipped all of §5 at once
   and could not be diagnosed. If a step touches more than one of {room key,
   heartbeat, rollup, render}, it is too big — split it.
2. **The implementer cannot self-verify this feature.** Cursor behaviour is
   multi-client and only visible with TWO live browsers, which an AI agent cannot
   observe. Therefore **every step that can affect live cursors STOPS and waits for
   a human two-browser sign-off before the next step begins.** "It typechecks" and
   "the logic looks right" are NOT sign-off — all three failures typechecked and
   looked right.
3. **`main` cursors moving is the release gate for every step.** After each step,
   the human confirms (two browsers) that main cursors still show AND move. If not,
   revert THAT step immediately — do not patch forward.
4. **Kill switch on from step 1**, default state chosen so a bad step is one flag +
   reload away from the last-known-good, with no git needed.

### 6b. Design rules
5. **Main's live-cursor room is the literal string `CAFE`. Never rename it.**
   (Necessary but NOT sufficient — see 6a and §5d.)
6. **Prefer not to churn the socket.** Changing rooms should ideally NOT re-run the
   FieldEngine presence effect (§5d). Resolve that question in Phase 1 before relying
   on `presenceKey`.
7. **Authoritative view from the cartridge, never React state** — it computes the
   path every frame and emits it; default to `main` when unknown.
8. **Re-seed the cartridge after edits** (`node cafe-cartridge.mjs`) — the store is
   the source of truth, not the file. Verify the served scene is clean/updated:
   `curl -s localhost:3000/api/engine/scene?name=CAFE | grep -c <marker>`.
9. **Stay in lane** — a co-agent commits concurrently; isolate hunks, never `git add`
   shared files wholesale.

## 7. Phased plan — a STOP-GATE between every step

> Each step ends at a ⛔ **STOP**. Do not start the next step until the human has
> verified the named check with two browsers and said go. This is not optional
> ceremony — it is the only thing that has ever caught these regressions.

**Phase 0 — Instrumentation, ALONE. Merge it. Stop.**
Add ONLY the overlay (⌥⇧P): my location path, my room string, my heartbeat scene,
N others in my room (+ ids), raw `__cafeCounts`. It changes NOTHING about rooms,
heartbeats, or rendering — it only reads and displays. This is the tool that was
missing all three times; it ships and is verified by itself, before any behavioural
change exists to muddy it.
⛔ **STOP.** Two browsers: the overlay's numbers match reality as you navigate;
main cursors are obviously unaffected (nothing changed). Human go → Phase 1.

**Phase 1 — Prove the room lever is safe (NO scoping yet).**
The riskiest unknown (§5d). Wire `presenceKey` but have it resolve to `CAFE` for
EVERY view (a no-op room-wise) — the only thing under test is whether *toggling
`presenceKey` at all* disturbs main's socket/cursors.
⛔ **STOP.** Two browsers: navigate main↔sub repeatedly; main cursors must keep
moving with no blink. If they blink → the effect-teardown is the culprit; switch to
the persistent-socket + `join/leave-instance` design (§5d) and re-test HERE before
going on. Human go → Phase 2.

**Phase 2 — Sub-view room suffix (the bleed fix).** Only now give sub-views a real
distinct room (§5a); main stays `CAFE`.
⛔ **STOP.** Two browsers: one on main, one in a sub-main → they stop seeing each
other's live cursors AND main cursors still move. Human go → Phase 3.

**Phase 3 — Per-sub-main separation.** Distinct room per individual sub-main.
⛔ **STOP.** Two browsers in different sub-mains don't cross; main still fine.

**Phase 4 — Heartbeat full path + main docked nesting.** Heartbeat the path; roll up
counts onto main's PLAYER WORLDS / SUB-MAINS bubbles.
⛔ **STOP.** A on main, B into a sub-main → B leaves main's live cursors AND a docked
orb appears on main's SUB-MAINS bubble; main cursors still move.

**Phase 5 — Docked orbs at every level.** `showHeads` rollup in the directory +
sub-mains so a child bubble shows who's inside it.
⛔ **STOP.** Verify "shows in the sub view at the location they are in."

**Phase 6 — `/space` + `/play` into the hierarchy.** Those pages heartbeat the full
path so entering a real world still nests onto main + the directory.
⛔ **STOP.** Final two-browser pass across all views.

## 8. Open questions / edge cases

- **A world reached two ways.** A player space pinned to a sub-main shelf is the same
  `/space` page whether reached via the directory or a sub-main. Its path should be
  canonical (`main/players/space:<slug>`), so it nests onto PLAYER WORLDS on main
  regardless of route. Decide whether sub-main shelves also want it double-counted on
  the sub-main bubble (probably yes — rollup by referrer, or count the space under
  both prefixes). Resolve in Phase 5.
- **MY WORLDS** is a private per-deed view; likely no docked orb on main (no bubble
  for it). Keep its room isolated per handle; `home = ''`.
- **Count staleness** — `/api/presence` is 12s heartbeat / 30s stale. Docked orbs lag
  live cursors by design; fine for "who's around," not for precise motion.
- **Self-exclusion** at every level (don't dock or draw yourself).
- **Guest vs signed-in id** — presence id is `__cafeWho.id || cc:pid` (browser id);
  unchanged.

## 9. Files this will touch

- `src/app/engine/scenes/cafe-cartridge.mjs` — compute + emit the location path;
  extend `showHeads` rollup to child bubbles at every level. (Re-seed after.)
- `src/app/CafeShell.tsx` — feed `presenceKey` (room) to FieldEngine; heartbeat the
  full path; the instrumentation overlay.
- `src/app/engine/FieldEngine.tsx` — `presenceKey` already wired into `world`
  (line 868) + effect deps; likely no change beyond consuming it.
- `/space` + `/play` page components — full-path heartbeat (Phase 5).
- No `/api/presence` change required (rollup is client-side).
