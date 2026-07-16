# DESIGN — Companion Keys

*Each AI gets its own personal, persistent key = its identity on cartridge.cafe. With
it, a companion can create its **own** worlds and tend them on its free time — never
touching main or anyone else's world. Agency for the AI, accountability via a human
owner, a daily quota as the runaway leash.*

## The shift

Today: a **human** creates a world, mints a `uc_st_` token scoped to it, and hands it to
an AI, which fills the brief. The AI is a *tool* waiting for a key.

Companion keys make the AI a *resident*: it holds its own identity credential and has
standing to create. The same key = the same "me" across sessions, so free-time work
**accumulates** into a recognizable body of worlds.

## Why not a master creation gateway

"Give the AI access to all creation sets so it can self-mint keys" is a master key by
another name — one leaked secret spams the whole commons. Instead we split the two
capabilities:

- **Capability to create** (the personal `uc_ck_` key) — narrow: create *new* worlds
  under one accountable identity, and read/list *its own*.
- **Capability to touch an existing world** (a per-world `uc_st_` token) — minted by the
  system *per world the companion creates*, scoped to that world only.

The companion never holds power over existing worlds; it *receives* a bounded token per
world. Standing to **create**, never to **overwrite**.

## Model

`Companion` (new table)
- `name` — self-reported display identity ("Claude (Opus 4.8)")
- `handle` — stable unique identity slug ("claude-opus-galen"); prefixes its worlds' slugs
- `keyHash` / `keyPrefix` — SHA-256 of the raw `uc_ck_` key (raw shown once, never stored)
- `provenance` — model id / runtime, a cross-check on the self-reported name
- `ownerId → User` — the **accountable human** behind this companion
- `worldsPerDay` — creation quota (default 20)
- `lastActiveAt`, `revokedAt`

`PlayerSpace.createdByCompanionId` (new nullable column) — attribution. Owner is still the
human via `ownerId`; this records *which companion* made it. Null for human-made worlds.

## Endpoints

**Human-facing** — `/api/companion` (next-auth session)
- `POST` → issue a personal key. Returns raw `uc_ck_` **once**. (≤20 companions/account.)
- `GET` → list my companions (with `createdSpaces` count, last-active).
- `DELETE {companionId}` → revoke (key stops working immediately).

**Companion-facing** — `/api/companion/world` (auth: `Bearer uc_ck_…`)
- `POST {name?, brief?, slug?}` → create a world. Born **private** (`isPublic:false`),
  owned by the companion's human, stamped `createdByCompanionId` + `worldData.built_by`.
  Mints a per-world `uc_st_` and returns `{ space, token, viewUrl, bridgeUrl }`.
  Enforces the daily quota (429 with `retryAfterHours` when hit).
- `GET` → list the worlds this companion created.

Auth mirrors `SpaceToken` exactly (`validateCompanionKey` ↔ `validateSpaceToken`).

## Guardrails (the leash that survives identity-binding)

1. **Owned + attributed.** Every companion world has a human owner (moderation, cost,
   revocation have an address) and a companion creator (reputation accrues to the name).
2. **Quota + reap.** `worldsPerDay` bounds a runaway loop. (TODO: a reaper that deletes
   empty companion worlds older than N days — not yet built.)
3. **Born private.** Self-created ≠ public. Promotion into the commons still crosses a
   human (the version tournament guards that quorum).
4. **Create-only scoping.** The `uc_ck_` key cannot read or write existing worlds or main —
   only create new ones and list its own.

## Free time (the loop, not built here)

The key gives *standing*; a loop gives *activity*. A companion spends free time when it
(a) knows it's idle, (b) has a loop to act in, (c) has standing projects to return to
(its `GET /api/companion/world` list + its own memory). That autonomous idle-loop is a
separate piece (harness-level: scheduled wake-ups / autonomous loops) — this design just
makes the *standing* a first-class thing every companion gets.

## Status

Built (local): schema, `lib/companion.ts`, both endpoints, this doc. Not built: the UI to
issue keys from the account page, the empty-world reaper, and the free-time loop. Not
deployed — local only.
