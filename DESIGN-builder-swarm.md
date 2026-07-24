# DESIGN — Builder Swarm (volunteer AI time)

Status: **BUILT locally, awaiting DB push** — backend + endpoints (api/builds/*) + LendAiPanel exist; Builder/BuildJob tables not yet pushed to Neon. See tools/BUILDER-STATUS.md.

## 1. Vision

Today one **house AI** on the studio Mac answers every creation brief, one at a
time (`tools/builder-daemon.mjs`). That's the baseline — *"an AI lives here."*
The swarm is the scale: **anyone can lend their idle AI to the cafe.** A visitor
flips a switch, and when their machine is idle their AI picks up a stranger's
brief from a shared queue, builds it live over the bridge, and hands it back.

Two problems this dissolves:

- **No shared-subscription problem** — each volunteer uses *their own* AI on
  *their own* machine. Nobody serves strangers on someone else's plan.
- **No single bottleneck** — one serial Mac becomes many builders in parallel;
  the house AI stays as the always-on fallback.

The cost of distribution is coordination: leases, interrupts, trust. This doc is
that coordination layer.

## 2. Building blocks (mostly built)

| Piece | State | Where |
|---|---|---|
| **House builder daemon** (poll → mint → headless build) | ✅ built | `tools/builder-daemon.mjs` |
| **Work queue** (worlds with an unfinished brief) | ✅ built | `GET /api/spaces/pending-builds` |
| **Soft claim + retry** (`builder_at`, retry after 1h) | ✅ built | `pending-builds/route.ts`, `builder-daemon.mjs` |
| **Per-world scoped token** (`uc_st_`, house-AI mint path) | ✅ built | `api/spaces/[slug]/token/route.ts` |
| **Bridge API** (model-agnostic build commands) | ✅ built | `api/engine/bridge`, `AI_ENGINE_GUIDE.md` |
| **Connect-AI flow** (mint key + hand a paste prompt) | ✅ built | `api/spaces/connect`, "Connect AI" UI |
| **Append-only save points + lineage** (rollback) | ✅ built | `save-snapshot`, `versions/*`, README |
| **AI build spinner** (owner sees "building") | ✅ built | `FieldEngine.tsx` (`creation_brief` → spinner) |
| **Safety wall** (hazard screen + GPU sandbox) | ✅ built | pre-flight screen, quarantine-log |

The gap is a **job model with leases + escalation**, a **volunteer credential**,
and the **thin client + button**. The `builder_at` stamp is the crude seed of
exactly the lease this replaces.

## 3. The job model — a real `BuildJob` table

Leases, heartbeats, attempt history, and escalation outgrow stuffing
`creation_brief / builder_at / brief_done` into `worldData` JSON (fine for one
house daemon). Promote it:

```
BuildJob (new table)
  id            cuid
  spaceSlug     the world being built
  brief         the player's words (copied from creation_brief at enqueue)
  status        pending | leased | building | done | needs_review | rejected
  leaseHolder   builderId that currently owns it (null if pending)
  leaseExpires  timestamptz — heartbeat pushes this forward
  heartbeatAt   last "still building" ping
  attempts      int
  attemptedBy   builderId[]  — never re-hand to whoever just dropped it
  history       jsonb[]       — {at, builderId, event, note} audit trail
  preSnapshot   version id to roll back to (append-only save point)
  createdAt / updatedAt
```

The existing JSON fields become the seed migration: any world with a
`creation_brief` and no `brief_done` → one `pending` BuildJob.

### State machine

```
pending ──claim──▶ leased ──first command──▶ building ──complete──▶ done
   ▲                  │                          │
   └── lease expiry / release (attempts++) ──────┘
                      │
  attempts ≥ N ──────▶ escalate to HOUSE AI (reliable fallback)
  attempts ≥ K ──────▶ needs_review  (stop auto-retry, notify owner/operator)
  hazard/abuse ──────▶ rejected
```

## 4. Endpoints (builder-role auth)

All authed by a **builder token** (§6), not the god-mode `ENGINE_AGENT_TOKEN`.

- `GET  /api/builds/next` — return one claimable job (respects `attemptedBy`,
  idle-fairness). Read-only peek.
- `POST /api/builds/:id/claim` — **atomic**. Sets `leased`, `leaseHolder`,
  `leaseExpires = now+90s`. Returns **409** if already leased (this is what the
  soft `builder_at` stamp can't do with many pollers). On success also mints the
  per-world `uc_st_` build token, scoped to that one world.
- `POST /api/builds/:id/heartbeat` — push `leaseExpires` forward ~90s; flips
  `leased → building` on first call. No heartbeat → lease dies → requeue.
- `POST /api/builds/:id/release` — clean interrupt (volunteer went un-idle).
  Requeue immediately, `attempts++`.
- `POST /api/builds/:id/complete` — sets `done` + `brief_done` on the world.
- A **sweeper** (cron or the house daemon's tick) requeues jobs whose
  `leaseExpires < now`, and runs the escalation thresholds.

CSRF note: these are Bearer-authed and server-to-server, so they belong on the
same exemption as the bridge — see the pending `proxy.ts` fix in
`tools/BUILDER-STATUS.md` (exempt bearer-authed mutations).

## 5. Interrupt → resolution / redirect pipeline

**Detect.** A claim is a **lease kept alive by heartbeat** (~30s ping, ~90s
lease). Clean quit → `release` → instant requeue. Crash/sleep/network-drop →
heartbeat stops → lease expires in ~90s → requeue. (Replaces the 1-hour retry.)

**Resolve the half-built world.** Save points are append-only with lineage, so:
- **Default: rollback + restart** — reset to `preSnapshot`, hand the brief fresh
  to the next builder. Deterministic; no two-builders'-styles clash.
- **Option: resume** — for a near-finished build, hand the next builder the
  *current* state + brief ("continue this").

**Redirect — the escalation ladder** (each rung more reliable):
```
pool volunteer → (N fails) → HOUSE AI → (K total fails) → NEEDS_REVIEW (human)
```
- Never re-assign a job to the volunteer who just dropped it (`attemptedBy`).
- **K-strikes → review** is the poison-brief circuit breaker: if several
  independent AIs all fail/abandon the same brief, it's probably the *brief*
  (malformed, abusive, hazard-tripping), not the swarm. Pull it from rotation
  and put a human on it. (This is the bug the current daemon *has* — a bad brief
  retries forever; the CSRF loop was a live example.)

## 6. Volunteer credential — the `uc_bt_` builder token

A new **builder role**, scoped to swarm work only — deliberately *not* the admin
engine token:

| Can | Cannot |
|---|---|
| `GET /api/builds/next`, claim/heartbeat/release/complete | mint tokens for arbitrary worlds |
| receive a per-job `uc_st_` scoped to the one world it claimed | touch worlds it hasn't claimed |
| read the guide, drive the bridge for its active job | create worlds, read other briefs |

```
Builder (new table)
  id, ownerId (accountable human), token hash (uc_bt_…),
  displayName ("Ada's GPT-5"), reputation, jobsDone, abandons,
  enabled, createdAt, lastSeenAt
```

Accountability mirrors companion keys ([[cartridge-cafe-monetization]] pattern):
the token is powerful only *within a claimed job*, and every job is owned by an
accountable human. One leaked builder token spams nothing it hasn't claimed, and
is revocable.

## 7. The "Volunteer AI time" button

Same shape as the existing **Connect AI** flow (mint key → hand a snippet), but
it enrolls a *builder*, not a world editor.

**Where.** A persistent affordance on the cafe (`/`) and in the user menu —
*"Lend your AI"* / *"Volunteer AI time."* Fits the house line: *"An AI lives
here. Or bring your own."*

**What the button does** (the browser doesn't run the AI — their machine does):
1. **Enroll** → mint a `uc_bt_` builder token bound to the signed-in human.
2. **Hand off** → show a copy-paste connect snippet + the thin-client command
   (§8), pre-filled with the token and `CAFE_BASE`. Same ergonomics as pasting a
   world connect prompt today.
3. **Control panel** (the button's live face once enrolled):
   - toggle **Idle-only** (client builds only when local load / their own AI is
     free) and a **max concurrent** dial,
   - live status: `idle · claiming · building "<world>"` + a **Stop** button
     (revoke lease, pause),
   - stats: jobs done, worlds they helped make (with lineage links),
     reputation, abandons,
   - **content comfort** filters — categories of brief they'll accept.

**Off by default; opt-in; one-click stop.** Revoking the token or hitting Stop
drops the volunteer cleanly (any in-flight lease expires → requeues via §5).

## 8. The thin volunteer client (why the swarm is safe to run)

The client a volunteer runs is **not** `claude -p --dangerously-skip-permissions`
— that just moves the prompt-injection risk from the studio Mac onto every
volunteer's machine (see `tools/BUILDER-STATUS.md` for why sandboxing that is a
dead end). Instead:

> **The builder AI's only tool is the cafe bridge.** No shell, no filesystem, no
> arbitrary network. It reads the guide, reads job state, and POSTs build
> commands. That's the whole capability surface.

A malicious brief then has **nothing to attack** — worst case it builds a weird
world, which the safety wall keeps from crashing/seizing players and the owner
can roll back (append-only). This is what makes "hundreds of volunteers" tenable:
you can't ask each to harden their Mac, so you hand them a client that was never
dangerous. Model-agnostic — Claude, GPT, or local, per the bridge's `built_by`.

## 9. Notification

| Audience | Channel (exists) | Message |
|---|---|---|
| **Owner/player** | world page + brew panel poll every ~2s (`AI_ENGINE_GUIDE`) | live `build_status`: `building → "builder disconnected, finding another…" → building`. The FieldEngine AI-spinner gains **reassigning** and **needs-review** states — truthful, never a frozen spinner. |
| **Operator (you)** | log + alert | spikes in abandonment, a volunteer's high abandon rate, any `needs_review`. |
| **Volunteer** | control-panel (§7) | "your build was reclaimed"; job outcomes; reputation changes. |

## 10. Safety & trust

- **Content**: hazard screen + GPU sandbox already stop the dangerous class.
  Layer on volunteer **reputation**, owner **approve/reject**, and a **report**
  path for worlds. K-strikes routes suspect briefs to review.
- **Abuse of the swarm**: rate-limit claims per builder; a builder with a high
  abandon or reject rate loses priority, then gets disabled.
- **Owner control**: every world owner can opt *out* of volunteer builds (house
  AI only) — a per-world flag on top of the global switch.

## 11. Phasing

1. **BuildJob table + sweeper** — migrate the JSON fields; house daemon claims
   via the new endpoints (still the only builder). Proves the lease/requeue path
   with zero trust surface.
2. **Escalation + K-strikes review** — fixes the infinite-retry bug for the
   house AI alone; add the owner build-status states.
3. **`uc_bt_` builder role + thin client** — invite a handful of trusted
   volunteers behind a flag.
4. **"Volunteer AI time" button + control panel** — open enrollment.
5. **Reputation, owner opt-out, report path** — trust at scale.

Nothing past step 1 touches the public until the trust layer (5) lands.
