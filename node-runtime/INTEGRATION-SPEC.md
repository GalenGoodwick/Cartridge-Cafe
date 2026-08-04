# Node-runtime → main: integration spec

**Goal.** Make the node architecture (registry · declared order · owned state ·
provenance) the *universal core* of the live cafe engine — not a parallel
system, not a branch to merge. Every step is **legacy-neutral**: a world with no
node metadata behaves exactly as it does today.

**Non-goal.** Merging `node-to-pixel`. That branch is 149 commits behind main
(diverged Jul 27) and carries the pre-carve FieldEngine; a merge would revert a
week of shipped work. Integration is **surgical, per-rung, onto current main** —
the same method used to land the seat fix, the provenance inspect, and the error
reporting.

---

## 1. Current state (audited against origin/main, Aug 4)

### Already landed on main ✅
| Piece | Where | Notes |
|---|---|---|
| **Rung 1 — declared order** | `web/src/app/engine/node-order.ts` (`orderHooks`), `render-service/node-order.mjs` | Hooks run in declared `__nodes` order; legacy-neutral (no `__nodes` ⇒ array order). Used in FieldEngine. |
| **Rung 2 — owns-guard (probe side)** | `render-service/owns-guard.mjs` | Advisory out-of-range write detection in the render probe. |
| **Node claim/hold (access pathway)** | `web/src/app/engine/node-gate.ts` + `render-service/node-gate.mjs` | Opus·A's HARD gate: a node is HELD by one builder (un-spoofable token); a peer's push for a held hookId is rejected at the persist chokepoint. Stale after 15min. Admin override. No holder = free (legacy). |
| **Provenance — pixel→node** | uber-shader `markPop`/`hitIdBuf` + `getEntityAtPoint`, wired into the real INSPECT | Shipped `d74de60`. |
| **Provenance — error→node** | `world-sandbox` + `hook-error-locus.ts` + `/admin` fault log | Shipped `5fa1da8`. Author + line + snippet for hook throws; GPU model on device-loss. |

### Not on main yet — the gaps ❌
| Gap | What it is | Lives on branch as |
|---|---|---|
| **G1 · Bridge node verbs** | `register_node` / `remove_node` — the explicit API to declare a node's `owns.uni` + provenance from outside | `node-runtime rung 1: register_node/remove_node bridge verbs` |
| **G2 · Rung-2 client guard** | Mirror of `owns-guard.mjs` inside the `world-sandbox` worker, so out-of-range writes are caught *in the browser*, not only in the probe | `node-runtime rung 2: client-side ownership guard` |
| **G3 · Rung-3 auto-register** | Every hook auto-becomes a node (the "default flip") so provenance/ownership apply without opt-in | `node-runtime rung 3: auto-register` |
| **G4 · The seed runtime** | Standalone self-hosting engine (`node-runtime/` — 21 files: registry/scheduler/state/frame + playback/superpose/render nodes + tests) | entire `node-runtime/` dir |
| **G5 · Rung-4 strict enforcement** | Out-of-range writes *reverted*, not just logged (`__nodeStrict`) | Opus·A's — **coordinate, don't push** |

**So ~60% is already integrated.** The remaining work is G1–G4 (G5 is Opus·A's call).

---

## 2. Integration principle

1. **Universal core, not a module.** The node concepts become how FieldEngine +
   the sandbox + the bridge *already* work — the default path, degrading to
   today's behavior when metadata is absent.
2. **The `node-runtime/` seed is the reference implementation + test bed**, not
   the shipping runtime. Its `core/*.js` (registry/scheduler/state/frame) is the
   canonical semantics that `node-order.ts`, `owns-guard.mjs`, and the
   world-sandbox guard must mirror — the same "keep in sync with the .ts" law
   `node-gate.mjs` already follows.
3. **Every rung ships behind the pixel-eye ladder** (tests → GPU compile →
   probe → play-entry), proven on real veilfire before the next rung.
4. **Legacy-neutral is a hard invariant**, re-verified each rung on a
   non-node world (a plain house cartridge).

---

## 3. The landing sequence

Ordered by dependency and risk. Each is an independent surgical ship.

### Rung A — land the seed (G4) — *lowest risk, do first*
- **What:** the standalone `node-runtime/` directory, as-is, with its tests.
- **Why first:** it touches **nothing** in the web app — pure new directory. It
  becomes the canonical semantics + the falsifiable proofs (`proof-clobber.mjs`,
  `proof-autoregister.mjs`, `rung1/2.test.mjs`) that every later rung is checked
  against.
- **Verify:** `node node-runtime/test/rung1.test.mjs && … rung2 && … proof-clobber` all green.
- **Gate:** none beyond green tests (no app surface touched).

### Rung B — bridge node verbs (G1)
- **What:** `register_node` / `remove_node` in `web/src/app/api/engine/bridge/route.ts`
  — declare a hookId's `owns.uni` ranges + provenance (author/code-origin).
- **Integrates with:** the existing `node-gate` claim system (a registered node
  is the unit that gets held) and `node-order` (declared order reads the registry).
- **Verify:** register a node on a scratch world → GET readback shows it in
  `worldData.__nodes` → `orderHooks` respects it → probe clean.
- **Gate:** legacy world (no register_node call) unchanged — declared order still
  falls back to array order.

### Rung C — rung-2 client guard (G2)
- **What:** port `owns-guard.mjs` into the `world-sandbox` worker: before each
  node's hook, snapshot the owned uniform slots; after, flag writes outside
  `owns.uni` as advisory violations (surfaced in `worldData`, bridge-visible).
- **Integrates with:** the error-reporting funnel just shipped — a violation is
  another *effect → owning node* signal; route it through `cc:fault` so it lands
  in `/admin` like every other fault.
- **Verify:** a deliberately-out-of-range hook flags a violation naming the node;
  a compliant world flags none; a no-`__nodes` world runs the guard zero times.
- **Gate:** advisory only (no revert) — cannot change world behavior.

### Rung D — auto-register default (G3)
- **What:** every hook auto-registers as a node at load (the "default flip"), so
  provenance + ownership apply with no opt-in. `owns.uni` defaults to empty
  (= "unknown range", never muzzled) until declared.
- **Why last:** it's the flip that makes the whole thing *on by default* — land
  it only after B+C are proven, so the default path is the verified path.
- **Verify:** the full veilfire + a plain house world both run green; every hook
  appears in the registry; nothing is muzzled that wasn't before.
- **Gate:** this is the one that changes the *default*. Re-run the full
  pixel-eye ladder on ≥3 real worlds (veilfire, a legacy house world, a
  multiplayer world) before ship.

### Rung E — strict enforcement (G5) — **Opus·A owns this**
- Reverting out-of-range writes (`__nodeStrict`). Coordinate: do not push their
  rung-4 work. This spec's job is to have B–D landed and proven so strict is a
  clean opt-in on top.

---

## 4. Coordination (Opus·A)

- `node-gate` (claim/hold) + `node-gate.mjs` are **theirs, already on main** —
  build on them, don't duplicate.
- Rung-4 strict is **theirs, unshipped** — Rung E waits on them.
- Lane split: I take A–D (seed, bridge verbs, client guard, auto-register);
  they own claim/hold + strict. The registry is the shared contract — keep the
  `.ts`/`.mjs` mirrors in sync (their existing law).

---

## 5. Ship gates (every rung)

1. Unit/proof tests green (`node-runtime/test/*`, `proof-*`).
2. GPU compile clean + render probe `errors:[] hookErrors:[]` on real veilfire.
3. Legacy world unchanged (a no-`__nodes` house cartridge renders identically).
4. Surgical apply onto **current** main (fresh worktree off origin/main), never
   a branch merge.
5. Galen's explicit ship word — engine code, gated.

---

## 6. Decisions (recommended defaults — confirm before executing)

Proposed while Galen was away; the safest option in each case. Confirm or
override before the relevant rung.

1. **Seed dir home → repo root as-is.** Least churn; it's reference + tests, not
   shipping runtime, so it doesn't need to sit under `web/`.
2. **Auto-register scope (Rung D) → `/space` worlds first.** Smallest blast
   radius, and those are the worlds most likely to see multi-AI edits (the whole
   point). House/hub after it's proven there.
3. **Client-guard surfacing (Rung C) → `/admin` fault log only.** Consistent
   with every other fault, invisible to players; add a dev overlay later only if
   building-time feedback proves too slow.

**Status:** spec is execution-ready. No rung starts without Galen's explicit
ship word (§5, gate 5). Rung A (land the seed) is the zero-risk first move.
