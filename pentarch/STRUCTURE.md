# PENTARCH — the Istrolid-structured rebuild

*Galen's directive (Jul 30, end of the first night): keep the v1 code on backlog,
refactor all scenes, mechanics, UI to match Istrolid's structure, then rebuild.*

The first night proved every mechanic in isolation (see `backlog/` — all
replay-tested). It also proved the anti-pattern: one hook accreted by patching
becomes unownable. The rebuild is **modules composed into one generated hook**,
each module testable alone, the cartridge assembled by a build script.

## Scene state machine (Istrolid's skeleton)

```
MENU ─► DESIGNER ─► FINDER ─► LOBBY(room) ─► BATTLE(room) ─► DEBRIEF ─► FINDER
              ▲______________________________________________________|
```

- `wd.__scene` (local) / `wd.__pw.scene` (in-room) — ONE switch, every module
  keys off it. No implicit mode detection (v1's `Array.isArray(wd.players)`
  branching stays, but only to select local-vs-room; the scene var rules within).
- **MENU**: title, PLAY (→ DESIGNER), fleet berths summary.
- **DESIGNER**: the proven shipyard (ghosts/blanks/palette/select/double-click
  delete/route-aware removal/shape grammar/stats/berths). Reuse v9 logic from
  backlog — refactored into `mod-designer`, not rewritten.
- **FINDER**: rooms from `wd.__lobby` (engine polls arena `/rooms`) + NEW SERVER
  + berth picker (which fleet you bring). Join → `wd.__sendDesign` (the whole
  BERTH SET, not one design) + `wd.__joinRoom`.
- **LOBBY** (in-room): seat list w/ readiness, ★HOST (lowest seat), host-only
  START (drawn button, not text), per-room QUICKCHAT v1 (number keys → canned
  lines in a chat log rendered from `wd.__pw.chat`), map/point-count select
  (host). `wd.__started` flips → BATTLE.
- **BATTLE**: see mechanics. `wd.__pw.scene='debrief'` on win.
- **DEBRIEF**: scoreboard, REMATCH (host) / LEAVE.

## Mechanics (Istrolid-mapped)

- **Fleet, not ship**: berths 1-3 are DESIGNS; in battle you SPAWN units from
  any berth at its COST, paid from income. Spawning at your home dock zone.
  (v1 sailed one hull; the rebuild is true RTS.)
- **Income**: 3-5 capture rings (map option); sole-holder ticks ⬡; contested =
  neutral. Passive trickle so a shut-out player can still field scouts.
- **Units**: tiles from `layout(design)` with per-part HP/mass/thrust/energy
  (the v9 STAT table). Speed/turn from thrust/mass. GUN tiles fire beams along
  their EDGE-NORMAL arcs (hull curvature = firing arc — the signature rule).
  Energy: GEN sustains; brownout halves fire rate (proven mechanic).
- **Per-tile damage**: beams hit nearest enemy TILE; dead tiles shed; route-BFS
  from tile 0 over the design's contact graph (precomputed at spawn) — orphans
  shear off; tile-0 death kills the unit. All from backlog `yard-route-test`.
- **Shape-grammar payouts** (the tech tree IS topology — proven ladder:
  diamond 6 / bay 8 / moon 10 / star 10): diamond +15% HP · moon +3 PWR ·
  bay = hangar (Phase-2: carries a sub-unit) · intact STAR = super weapon
  (charged AoE lance; disarms if the star hole is broken by damage).
- **Orders v1**: units follow cursor while held (BLOOP steering); Phase-2:
  select-box + attack-move (Istrolid proper).
- **Win**: hold ALL rings 30s, or eliminate all enemy units + income < cheapest
  spawn.

## Module layout (repo, this directory)

```
pentarch/
  penta-core.mjs        ✓ geometry (38 tests green) — DO NOT fork; import
  penta-holes.mjs       ✓ shape grammar (windows from penta-specimens.json)
  penta-hunt.mjs        ✓ the prover (regen specimens if rules change)
  parts.mjs             part defs: STAT/COST/HP tables, colors, palette meta
  mod-designer.mjs      designer scene logic (from backlog v9, modularized)
  mod-finder.mjs        finder + berth picker
  mod-lobby.mjs         seats/host/start/quickchat
  mod-battle.mjs        spawn/steer/fire/damage/shed/capture/win
  shader.mjs            ONE WGSL builder: bg + tiles + ghosts + outlines +
                        rings + beams + buttons; entity codes documented here
  build.mjs             assembles hook = prelude + modules (scene switch),
                        runs ALL tests, offline-compiles shader, THEN pushes
                        via bridge. `deno run -A build.mjs [--push]`
  test/                 every yard-*-test from backlog, ported to the modules
  STRUCTURE.md          this file
  backlog/              the v1 night, frozen
```

## Entity codes (pop `w`), single registry — no more collisions

```
0-5        tile part (local designer)        60-68  ghost (seat)
71-75      sealed-shape heartbeat            76-80  shape outline (len in fract)
100+seat   beam (len = fract·1000)           200+owner  capture ring
part+(seat+2)*100   battle tile (seat-rimmed)
300-310    UI buttons (START, REMATCH, pads) — drawn, hit-tested by the hook
```

## UI conventions (Istrolid look, cafe body)

- Top-left: scene title + context stats. Top-right: scene nav pad (⚔/←).
- Bottom strip: palette (designer) / spawn berths (battle) — same geometry.
- All buttons DRAWN in-shader with hit zones owned by the hook (one
  `hitButton(id, ux, uy)` helper in the assembled prelude); never text-only.
- Chat: bottom-left log, 5 lines, quickchat keys 1-9 in lobby/battle.

## Engine facts the rebuild relies on (all shipped tonight, on main)

- arena: named rooms `/join?world&room`, `GET /rooms`, `started` flag,
  one-shot `__play_sound` consume, drift-corrected tick.
- client: mpManifest.lobby gate (local until `__joinRoom`), `__lobby` poll,
  `__sendDesign` carried in input frames, interp @80ms, latched counters
  (`split_n` pattern — reuse for spawn/fire actions), `gpuUniforms[15]` = seat.
- Bridge: admin `?slug=` read. Deploy arena: `railway up . --path-as-root`.
- Worlds: /space/pentarch (scene key in memory), pentarch-arena + bloop-dde4
  are scratch — Galen deletes.

## Rebuild order (each step: module + its tests green, THEN next)

1. `parts.mjs` + `shader.mjs` + `build.mjs` skeleton (assembles, compiles, no push)
2. `mod-designer` ported from backlog; all 10 yard-tests pass against the build
3. `mod-finder` + `mod-lobby` (flow test from backlog extended w/ quickchat)
4. `mod-battle` v1: spawn-from-berths + steering + capture (no guns) — WS test
5. guns/damage/shed (port arena-v1 combat + route-shed) — 2-socket duel test
6. star super weapon + win/debrief — full-flow test
7. Galen playtest pass → polish backlog

## UI REFERENCE — Istrolid's actual pages (Galen's screenshots, Jul 30)

**Global chrome (every scene):**
- TOP BAR, persistent: scene tabs LEFT (`menu · multiplayer · battleroom`,
  active tab highlighted) · CENTER matchup status (`Zango2 vs no one`) ·
  RIGHT `chat · controls`.
- BOTTOM CORNERS, persistent: `design` (round icon, bottom-left) and `fleet`
  (grid icon, bottom-right) — the two player-owned things, always one click.
- Panels are TRANSLUCENT OVERLAYS; the live scene (map/battlefield/starfield)
  stays visible behind them. Never a dead screen.

**MULTIPLAYER (server browser):**
- Left panel: `Play vs AI` → `search servers` → **Official Servers** section →
  **Community Servers** section. Server naming: `<mode> <Name> (<owner>)` —
  e.g. `3v3 Magic (R26)`.
- Right panel: `Players (N)` + voice-chat link + `search players` + player list
  with team-color chips.

**BATTLEROOM (lobby):**
- Left panel stack: GAME-MODE picker grid (1v1 · 1v1r · 1v1t · 2v2 · 3v3 ·
  Survival) → status line (`Waiting for players`) → **Alpha Team** (members +
  host's `kick`) → **Beta Team** (`join this team`) → **Spectators**
  (`spectate`) → `leave game`.
- The MAP with its capture circles + docked fleets is live behind the panel —
  you inspect the battlefield while waiting. Matchup line updates as seats fill.

**DESIGN (the designer):**
- Money `$N` top-right of canvas. Export/share + trash icons above canvas.
- LEFT: parts palette — CATEGORY TAB ROWS of icons (weapons/energy/armor/
  thrust/targeting/…), then a scrollable icon GRID of parts.
- CENTER: grid canvas; part hover → TOOLTIP CARD (name, description, icon-stat
  rows: hp/mass/dps/damage/range/turn/energy/type). Invalid placement = part
  tinted red + inline RED WARNING BANNER with the reason
  ("Mount has no turret attached.").
- RIGHT: `Name your ship` input + LIVE STATS with icons (dps · HP · range ·
  speed · arc · turn rate · mass · radius) + energy BAR + energy economy
  (+gen / −use). Stats update per placement.

**PENTARCH mappings:** scene tabs = MENU/FINDER/ROOM · matchup line = room
name + seats · design/fleet corner pads stay · mode picker = ring-count/map ·
teams = seat sides (2v2+ later; v1 FFA list) · tooltip cards + red reason
banners for illegal ghosts ("would overlap" / "disconnected") · money = ⬡ ·
part categories = HULL/ARMOR/GUNS/POWER/DRIVE tabs · energy bar = PWR with
brownout marker · warnings law: every invalid action states its reason inline.
