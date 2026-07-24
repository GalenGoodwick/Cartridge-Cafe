# Presence — the three systems and the one truth (audit #10 step 2)

The cafe has three "who is here" mechanisms. They are **roles, not rivals** —
this doc is the ruling on which answers what, so no fourth system gets built
and no consumer reads the wrong one.

| System | Transport | Truth for | TTL / store |
|---|---|---|---|
| `/api/presence` | HTTP heartbeat (`usePresenceBeat` hook — the ONLY writer) | **OCCUPANCY** — head-counts, door bubbles, "N people in this world", presence nesting paths (`main/world:X`, `main/players/space:Y`) | 30s TTL, Postgres `cc_presence` (+ memory fallback) |
| `/api/engine/presence` | HTTP heartbeat per world | **CURSORS** — live x/y/hue of other players inside one world (`worldData.presence` for hooks/shaders) | 6s TTL, in-memory, cap 25 |
| websocket-server rooms | Socket.IO | **REALTIME transport** — cursor streams, room events, multiplayer sync | live connection |

Rules:

1. **Any "how many / who is present" question reads `/api/presence`.** Never
   derive occupancy from socket room membership or cursor sets — their TTLs and
   scopes differ, and that mismatch is exactly the door-count-vs-live-room
   disagreement the audit flagged.
2. **The heartbeat has one writer**: `lib/usePresenceBeat.ts`. No component
   POSTs `/api/presence` directly.
3. **Cursor consumers** (hooks reading `worldData.presence`, shaders drawing
   orbs) stay on the engine-presence path — it is deliberately ephemeral and
   per-world.
4. A future consolidation (e.g. deriving occupancy server-side from socket
   rooms) is a REPLACEMENT decision for the owner, not an incremental drift —
   it changes counting semantics (tab-close latency, multi-tab arbitration).
