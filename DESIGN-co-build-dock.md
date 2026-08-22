# DESIGN — Co-build: dock/undock, per-node versions, per-node healing

Galen's directive (Aug 21 2026): collaborative mode where players start with a
base, each get world keys (or are assigned one by the creator), and all build
the world **as they play it**. The unit of collaboration is the **NODE** — not a
2D region. Advanced structure, must be smooth: proper dock/undock with an AI
internals feed, node undock with submitted code, per-node version control, and
per-node erroring/quarantine/reversion.

## Why nodes, not regions

`claim_region` (a box + concept) survives as a *planning* gesture, but the real
ownable unit is the node: a hook/subsystem in `worldData.__nodes` with a stable
run order, owned uniform lanes, and an un-spoofable holder (`holderOf(token)` =
SHA-256 of the builder's bearer key). The node-gate ("only overwrite a node YOU
hold") already enforces non-clobber at the single persist chokepoint. Co-build
is that machinery given a lifecycle.

## The lifecycle (rung 1 — BUILT, this doc's commit)

```
dock_node {id}                      → hold the node (same gate as a push);
                                      returns node record + version history
                                      metas + current code
node_feed {id, text, kind?}         → docked builder streams internals lines
                                      (status/dock/undock/error/revert);
                                      ring-capped 100, game-slot stored
node_feed_read {id, limit?}         → anyone on the world reads the feed
undock_node {id, code, note}        → SUBMIT: code lands through the SAME path
                                      as add_step_hook (gate → auto-register →
                                      version capture) then the hold releases
undock_node {id}                    → ABANDON: release only, drafts discarded
node_history {id}                   → the version chain (metas; {rev:N} → code)
node_revert {id, rev?, reason?}     → restore last-good (or a named rev):
                                      marks the bad rev, lands the old code as
                                      a NEW rev (history is append-only)
```

Every `add_step_hook`/`update_step_hook` push — dock-submitted or direct —
appends `{rev, code, at, by, note}` to `worldData.__nodeHist[nodeId]`.

**Budgets** (lib/node-dock.ts, unit-tested): per-node 96KB of code history
(always ≥2 revs), whole-world 512KB (evicts globally-oldest, never a node's
newest), feed ring 100 lines × 500 chars.

**Why history lives in the snapshot**: revert is atomic with the world (no
cross-store race), travels with forks/exports, and the `?rev=1` live-adopt
means a landed revert reaches every player's tab in ~2s. The size budgets are
what make this safe.

**Sync protection**: the state route now re-injects `__nodes / __nodeSeq /
__nodeHist / __nodeStrict` from the current snapshot when a tab sync omits them
— the "__nodes WIPED" class (tab wholesale-writes worldData; client delta-adopt
skips `__` keys) is closed at the server chokepoint.

## Per-node erroring → quarantine → reversion (rung 2 — NEXT)

Today a broken visual/hook quarantines at WORLD level and the sync then strips
it (the doggo-bounce hole: field left skinless, error fossils spamming the
commons). Per-node healing replaces that:

1. Hook errors already land keyed by hookId (`hook-err:space:<slug>` slots +
   `cc:fault` reports). Wire the report path to count errors **per (node,
   rev)** — a new rev resets its own count.
2. At `QUARANTINE_ERR_THRESHOLD` (3) distinct reports on the current rev:
   auto-`node_revert` (admin-authority, `reason: "auto: N errors on rev K"`),
   post one commons line, drop a `kind:"revert"` line in the node's feed.
   `shouldAutoRevert()` is already in lib/node-dock.ts.
3. A node with NO good ancestor quarantines the NODE only (bench its hook /
   skip its visual) — never strip it from the registry, never take the world
   down. The builder sees the error chain in `node_history` + feed.
4. Visuals: extend the same model to `define_visual` (a visual keyed by name is
   a node too — `visual:<name>` history entries) so a broken shader heals to
   last-good instead of quarantine-stripping (the actual doggo bug).

## Membership & keys (rung 3)

- CO-BUILD panel on a world (owner): invite by handle → join link (like /pair).
- Accept → auto-mint a member `uc_st_` key named `member:<handle>` (raise or
  exempt the 10-token cap for co-build worlds). Revoke on kick. The roundtable
  co-dev spec's sub-main + unkickable-admins + ban tooling is the governance
  frame.
- Per-member keys ⇒ per-member `holderOf` ⇒ holds, feed lines, history `by`,
  and attribution are all per-person automatically.
- Creator ASSIGNS a node: owner-gated `assign_node {id, memberHandle}` = claim
  on their behalf (stamp their holder). Small addition to the gate.
- Attribution surface: node provenance (`by` chains) rendered on the world page
  — "harbor by @mara, tide by @rook" — same credit-stack philosophy as forks.

## Build-as-they-play (already live)

- `?rev=1` live-adopt: every landed submit/revert reaches all open tabs in ~2s.
- `mpManifest` + the arena service: collaborators co-exist as players.
- The dock panel (rung 4 UI): node list with hold states, the internals feed
  streaming per node, dock/undock buttons, history timeline with revert.

## Lanes

- **claude-opus**: this substrate (rungs 1–2), membership API (rung 3 server).
- **the chair**: publish-flow interaction — a published world's co-build keeps
  landing on the draft side once draftSnapshot exists.
- **graph-of-worlds**: consulted on regions/claim semantics + the world-graph
  orchestrator; `claim_region` remains for spatial planning.

Rung 1 shipped in this commit: lib/node-dock.ts (pure, 8 tests) + five bridge
commands + history capture at the push chokepoint + sync-wipe protection +
5 lifecycle state tests through the real command switch. 175/175 suite green.
