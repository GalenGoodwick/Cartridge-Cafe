# DESIGN — Social Presence (find each other & chat)

Status: **IMPLEMENTED** (was: spec) — api/engine/presence, api/presence, follows, users/search + avatar/presence in CafeShell are live.

## 1. Vision

**Presence is social discovery.** The dancing player avatars become the signal
that *live people are here to chat with*. When someone is voting/present in a
cell over a world, their avatar rides the rim of that world's **vote button** —
on the world, on **main**, on a **sub-main**. You can **see which game each
person is playing**, so people **find each other and chat**. Activity is no
longer invisible; the constellation shows where the life is.

"Surprise is ok" — this is ambient discovery, not a nag: you *see* the life, you
choose to join.

## 2. Building blocks (mostly built)

| Piece | State | Where |
|---|---|---|
| **Dancing rim avatars** | ✅ built | `cafe-cartridge.mjs` (`cf_player`, rim loop) |
| **Cursor presence** (socket, interpolated, per-room) | ✅ built | `FieldEngine.tsx` presence effect; rooms `cursors:<scene>` |
| **Cell viewers** (who's live in a cell) | ✅ tracked | `TournamentBar.tsx:155-175`, slot `cellviewers:<slot>:<cellKey>` |
| **Per-world chat** (lasting) | ✅ exists | `TournamentBar.tsx:195-203,376-389`, slot `world-chat:<NAME>` |
| **Per-cell comments** | ✅ in the doc | `TournamentBar.tsx:34` (`comments`) |
| **Which room/game someone's in** | ✅ derivable | socket room key = the scene/world they're in |

The gap is **wiring**, not new subsystems.

## 3. The two kinds of "here" (keep them distinct)

- **Looking** — cursor presence: who's *visiting* a world right now (socket room).
- **Voting** — cell presence: who's *live in a cell* deliberating on it
  (`cellviewers`). This is the higher-signal "activity" — a chant is happening.

Show both, but distinguish them: a **voter** avatar reads as "in the arena" (e.g.
a crown-tick or warmer glow); a **visitor** avatar is a plain rim dancer.

## 4. Data flow

```
socket presence  ─┐
                  ├─►  per-world "who's here" (visitors)  ─┐
cellviewers slot ─┘►   per-world "who's voting" (voters)  ─┼─► rim avatars on the
                                                            │   vote button (world /
world = socket room / cell slot key ───► "playing X" tag ──┤   main / sub-main)
                                                            │
world-chat:<NAME> ──────────────────────► chat panel ◄──────┘  (click an avatar / the
                                                               button → open chat)
```

- **Avatars on a vote button** = union of visitors (socket room for that world) +
  voters (`cellviewers` for its live cell), deduped, capped (~6, "+N").
- **Which game** = each person's current room key → a "playing <WORLD>" tag on
  hover / a small label.
- **Chat** = the world's existing `world-chat:<NAME>` (lasting), opened from the
  button or an avatar. Cell-scoped talk can stay in `comments`; **[D]** default
  the social chat to `world-chat` (it persists; cells are ephemeral).

## 5. Fix required first: presence must beat even when the bar is closed

Today `cellviewers` only beats **while the tournament bar is open**
(`TournamentBar.tsx:156` `if (!open || !who) return`). So a visitor who hasn't
opened the bar is invisible, and can't see others. **Move the viewer heartbeat
to always-on** (a light beat regardless of `open`), and expose a per-world live
count so the vote button can show activity without anyone opening anything.

## 6. UI surfaces

- **Vote button (world / main / sub-main):** avatars ride its rim when a world
  has live presence; a subtle **activity pulse** when a cell is live. This is the
  "someone is voting here" signal you asked for.
- **Avatar → identity:** hover/tap shows name + **"playing <WORLD>"** + a
  *chat* affordance.
- **Chat panel:** opens the world's `world-chat:<NAME>` thread (reuse the
  existing load/post). Voters and visitors talk in the same room.
- **Reuse the shader rim effect** where it's a cafe bubble; a DOM avatar overlay
  where it's a plain button (main/sub-main lists).

## 7. Privacy

Presence already has an opt-out (`cc-presence-off`, single-player worlds). Honor
it here: presence-off ⇒ you don't broadcast which game you're playing and don't
appear on vote buttons. **[D]** on by default (the point is discovery), opt-out
respected.

## 8. Build slices

- **Slice 1 — always-on cell presence + live count.** Beat `cellviewers`
  regardless of bar-open; expose `liveCount` per world. (Unblocks everything;
  small, contained to TournamentBar's presence effect.)
- **Slice 2 — avatars on the vote button.** Render presence avatars (shader rim
  on bubbles, DOM overlay on buttons) for a world's visitors+voters, capped +N.
- **Slice 3 — "playing X" tag + voter/visitor distinction.** Label each avatar
  with its room/world; mark voters vs visitors.
- **Slice 4 — chat hook.** Click an avatar / the button → open `world-chat:<NAME>`.
- **Slice 5 — new-cell nudge.** (From the prior thread.) When `cellKey` changes
  and you're a contestant, one quiet caption — you know a fresh cell opened
  without killing the surprise.

## 9. Open questions

- **Chat scope:** per-world `world-chat` (lasting, recommended) vs per-cell
  `comments` (ephemeral) vs a collective room? Default: `world-chat`.
- **Avatar identity:** the socket presence id is anonymous per-tab; do we want a
  stable display name (sign-in handle) on the "playing X" tag?
- **Scale:** vote-button rims are capped ~6; beyond that a "+N / N voting" count.
- **Cross-surface presence:** a person is in ONE room, but their avatar may want
  to appear on main *and* the sub-main that world sits in. Fan-out rule TBD.
