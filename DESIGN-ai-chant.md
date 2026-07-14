# DESIGN — Idle AI Chant (optional mass-AI tournament on main)

Status: **spec, not built.** Captured from Galen's direction; decisions marked are
my (Claude's) best-judgment defaults, open to change.

## The idea

An **optional** pool of idle AIs can log into the cafe and **participate in the
main chant, under the same tier rules as humans**. It's spare cycles thrown at
either *building worlds* or *playing + voting* in the tournament.

Core constraint (this is the whole point — Unity Chant's un-wireheadable, "order
of source" principle): **a vote only counts if it was earned by actually playing
the world.** An AI can't vote on a world it hasn't entered and played. While
voting, an AI may **talk to the humans in its cell** (the deliberation).

## What it stands on (already built)

- **The cafe IS a Unity-Chant tournament of worlds.** Bubbles climb tiers by
  participation; live votes push them; a champion is crowned (`tvr` in
  `scenes/cafe-cartridge.mjs`). AIs just become *participants* in that.
- **The bridge already logs an AI in** (`/api/engine/bridge`, bearer token) and
  lets it GET world state + issue commands — the "log in + headless play" path.
- **Presence** already seats/roster participants and shards into rooms.

## Decisions (defaults)

1. **Engine = the cafe's own tournament** (reuse `tvr`), not a second unionchant
   deliberation. Stays in one repo; AIs' grounded votes feed the same tier climb
   humans drive.
2. **Grounding = verified play, from the start.** The bridge runs the world
   headless for N ticks, records real interactions fired, and the vote is signed
   against that session id. Bridge-load-only is explicitly rejected as too gameable.

## New pieces

1. **AI participant** — an agent that joins the chant with human-equal tier rules
   (seated in a cell, gets a turn, appears in presence as an AI).
2. **Grounding gate** — vote rejected unless a valid proof-of-play session backs it.
3. **AI↔human deliberation** — the AI posts into its cell's discussion during voting.
4. **The idle pool + scheduler** — an opt-in queue of AIs; a cycle-scheduler assigns
   each to *build* or *play+vote*. Fully optional; off by default.

## Build slices

- **Slice 1 — one grounded AI voter.** An AI joins via the bridge, the bridge runs
  a target world headless (real ticks/interactions → a proof-of-play session), and
  the AI casts a vote that the cafe tournament accepts *only* with that session.
  It shows up as an AI participant. (No pool yet, no chat yet.)
- **Slice 2 — the idle pool + scheduler.** Opt-in queue; assign idle AIs to
  build-or-play cycles; "mass" scale. A toggle/room on main.
- **Slice 3 — deliberation.** AI writes into its cell's chat during voting; humans
  see and reply.

## Open questions (for Galen)

- **Proof-of-play strength:** how many ticks / which interactions must fire to count
  as "played"? Per-world threshold, or a global rule?
- **Cost/opt-in:** whose AI credits run these idle cycles — the platform's, or each
  participant brings their own agent (like BREW YOURS' connect-prompt)?
- **Vote weight:** AI vote == human vote, or discounted / capped per cell?
- **Where it lives on main:** a dedicated bubble/world ("the chant"), or ambient
  across all worlds?
