# DESIGN — Multiplayer: the ONE room service

**Status: PARKED (Galen, Sep 9 2026).** The front door does not offer multiplayer;
the arena lane stays bespoke until this ships. This doc is the spec so the lane
is parked with its architecture, not a vibe.

**Why this shape.** Cafe worlds are already *data modules*: a world is a
snapshot — sandboxed JS hooks `(sim, dt)`, fields, worldData — not compiled
code. That is exactly what a generic room service can host. Today's bespoke
wiring (bloop, kindle: hand-built mpManifests against one hand-run arena
server) exists only because the primitives below didn't when they shipped.

## The service

```
ONE room service (Railway, app-sleep when idle)
  room = worldSlug + roomId            ── rooms share NOTHING with each other
    ├─ loads the world's SNAPSHOT from the DB     (any slug — forks just work)
    ├─ v2: runs its hooks in a sealed worker      (same sandbox discipline as the client)
    ├─ mpManifest declares the SYNC LANES         (which wd keys sync, who owns what)
    └─ players: ordered input streams in → key-level wd deltas out (10–20 Hz)
```

"Monolith" = one *service*, not one *box*: rooms are share-nothing, so the
shard key is roomId and scaling is linear — fill a node, add a node, a tiny
director assigns rooms. No cross-room state; DB only at load/save boundaries.

## The three primitives it stands on (all shipped Sep 2026)

1. **The ordered input queue** (input-runtime.ts, item 1): a lossless,
   ordered per-player event stream — THE networking primitive. The server
   merges N queues instead of one; between-tick taps survive by construction.
2. **Declared lanes** (`register_node {owns:{uni:[[a,b]]}}` generalized): the
   mpManifest is the same law as co-building — *this player owns these wd
   keys, the server owns those* — clobber-proof by construction.
   ```jsonc
   // worldData.mpManifest — the world DECLARES its multiplayer surface
   {
     "mode": "relay" | "authoritative",
     "tickHz": 15,
     "lanes": {
       "server": ["__wave", "__spawns"],          // only the sim writes these
       "perPlayer": ["px", "py", "act"],          // each player writes their own
       "shared": ["score"]                        // merged by rule (sum/max/latest)
     },
     "maxPlayers": 8,
     "laneByteCap": 4096                          // per-lane delta cap (see wall #2)
   }
   ```
3. **Per-player persistence** (save slots + identity): on join, a player's
   saved state hydrates into an enriched `wd.players[]` record — player data
   plugs in and *affects the game's nature*; hooks already read `wd.players`.

## v1 — RELAY (build first)

Server runs **no simulation**: it validates lane ownership, merges deltas,
fans out. The host client (first joiner / owner) is sim-authoritative.
Right for co-op and casual — the cafe's center of gravity.

- **Scale:** websocket relay + small JSON deltas ≈ **thousands of concurrent
  players on one small node**; app-sleep → idle ≈ $0.
- **Cheat model:** trust the host (fine for casual; not for competitive).
- **Engine side:** the client's networked mode consumes lane deltas into wd
  before each tick; input queue posts the local player's lane.

## v2 — AUTHORITATIVE rooms

The room runs the world's hooks server-side at tickHz; clients send input
events, receive lane deltas. Server is truth.

- **Scale:** hooks are budgeted (~1–10 ms well-behaved) at 10–20 Hz →
  **~15–30 active rooms per core/GB**; binding constraint is worker memory
  per room. Launch reality: 5–50 rooms total → one 2 GB node. Beyond: shard.
- **Security-critical:** user JS on a shared server. Worker (or V8 isolate)
  per room, CPU/memory caps, and the hook-budget QUARANTINE server-side
  (client version already exists) — a looping hook is killed + quarantined,
  never eats the node.

## The four walls (each with its answer)

1. **Pathological user JS** → server-side hook budget + quarantine (above).
2. **Full-doc sync** → NEVER. Key-level deltas per the lane manifest, lane
   byte caps. (The jsonb-detoast lesson: whole-doc anything is the enemy.)
3. **Worker-per-room memory** → pool light rooms per worker, or isolates.
4. **Persistence write amplification** → save on interval/exit, never per tick.

## The wall with no answer (scope it honestly)

**GPU-side state cannot sync.** Worlds whose truth lives in feedback shaders /
render targets (fluid sims) can't share that layer. Only CPU-side worldData +
field-transform state syncs; visuals re-derive locally per client. The
manifest declares this; the door/AI must not promise otherwise.

## Rollout

1. v1 relay service + engine networked-lane consumption + `mpManifest`
   validation (registry entry + conformance test, per item 4 discipline).
2. Convert bloop to the generic lane (prove the migration path).
3. v2 authoritative worker rooms + server-side quarantine.
4. Only THEN does the ⚿ door get a multiplayer toggle — offering what
   routinely works, per the Sep 9 door law.
