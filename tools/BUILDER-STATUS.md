# House-AI builder — status & findings (2026-07-18)

The "watcher that fires, starts an AI, and builds what a player asked for" already
exists. This documents what's wired, the one blocking bug, and the sandbox finding.

## The pipeline (already built)

1. **Player entry** — a player leaves a `creation_brief` on their world
   (`api/spaces/route.ts`, `api/spaces/[slug]/route.ts`, `api/companion/world/route.ts`).
2. **Queue** — `GET /api/spaces/pending-builds` lists worlds with an unfinished
   brief (`creation_brief` set, `brief_done` not).
3. **Watcher** — `tools/builder-daemon.mjs` polls every 20s, mints a build token,
   spawns a headless `claude -p <prompt> --dangerously-skip-permissions` that
   builds the brief live and sets `brief_done`. One build at a time, 15-min cap,
   retry after 1h.

## Phase 1 — BUILT (local, not migrated/deployed) — 2026-07-18

The `BuildJob` swarm backend from `DESIGN-builder-swarm.md §3–4` is written and
typechecks clean (tsc 0 errors, eslint clean). Nothing applied to the DB yet.

- **Schema** (`web/prisma/schema.prisma`): `Builder`, `BuildJob`, `BuildJobStatus`
  enum + relations on `User`/`PlayerSpace`. `npx prisma generate` run (client
  only — no DB touched).
- **Coordination** (`web/src/lib/builds.ts`): holder auth (admin token → house,
  `uc_bt_` → Builder), per-world token mint, `reconcile()` (briefs → jobs, deduped
  on space+brief), `sweep()` (lease-expiry requeue + house/review escalation).
- **Endpoints** (`web/src/app/api/builds/`): `GET next`, `POST :id/claim`
  (atomic, 409 on race), `heartbeat`, `release`, `complete`.
- **CSRF fix** APPLIED in `proxy.ts` (exempt bearer-authed mutations) — this also
  fixes Blocker #1 below.
- **House daemon** (`tools/builder-daemon.mjs`) rewired: `next → claim →
  heartbeat-while-building → complete/release`. Replaces the old
  `pending-builds` + `builder_at` soft-claim + 1h-retry (that infinite-retry bug
  is gone; poison briefs now escalate to `needs_review`).

**TO ACTIVATE — one command you run (writes to the Neon DB):**
```
cd web && npx prisma db push        # then restart the dev server
```
Use `db push`, NOT `migrate dev` — this project has no migration history
(`prisma/migrations/` is empty), so it's a db-push workflow; `migrate dev`
against the Neon prod DB would try to baseline/shadow and complain. The push is
purely additive (Builder + BuildJob tables, BuildJobStatus enum, one FK — zero
changes to existing tables/data). Restart `npm run dev` afterward so the running
server loads the regenerated client + new tables.

CONFIRMED 2026-07-19: the tables do NOT exist yet — a `SELECT 1 FROM "Builder"`
probe returned `P1014 (table does not exist)`. That is exactly why the LEND AI
panel shows "could not enroll": `prisma.builder.create()` throws → 500. Nothing
in the swarm works until the push runs. Left for you on purpose — I don't write
to your production DB without an explicit yes. The old
`GET /api/spaces/pending-builds` route still exists (harmless; superseded).

## Phase 3+4 — BUILT (local, not migrated/deployed) — 2026-07-18

The volunteer path from `DESIGN-builder-swarm.md §6–8` (tsc 0, eslint clean):

- **Enroll endpoint** (`web/src/app/api/builds/enroll/route.ts`): session-authed
  GET (list) / POST (mint `uc_bt_`, shown once) / PATCH (pause/idle-only/concurrency)
  / DELETE (revoke). Fleet capped at 10 per human.
- **Thin volunteer client** (`tools/volunteer-client.mjs`): runs on a volunteer's
  machine with their `uc_bt_`; idle-gated (per-core load < 0.6), claims one job,
  heartbeats, builds via their own `claude`, complete/release. Header comment
  documents the hardened bridge-only (MCP + deny-all) form for untrusted briefs.
- **"Lend your AI" button + panel** (`web/src/app/LendAiPanel.tsx`, wired into
  `CafeShell.tsx` CAFE dock as `🤝 LEND AI`): enroll → token + one run command +
  pause/stop + per-builder stats (jobs built / dropped). Session-gated like the
  other AI panels.

Activation is the SAME single migration as phase 1 (the `Builder`/`BuildJob`
tables) — nothing extra to run. After migrating, the button works end to end.

Still open (later): owner-facing build-status UI states (§9 — reassigning /
needs-review on the world spinner), volunteer reputation/moderation at scale (§10).

## Parity gap — "use house AI" only works for WORLDS (2026-07-19)

The house-AI/swarm build path is keyed to **PlayerSpace.creation_brief** — `reconcile()`
scans PlayerSpaces only. Other create surfaces don't feed it:

- **Branches** are file-store SCENES (mint `uc_sc_` via `/api/engine/scene/token`,
  NOT `uc_st_`; see `FieldEngine.tsx:1055-1072`, `createBranch` at 1084). The swarm
  never sees them → a "use house AI" button on a branch would enqueue nothing.
  Branch create panel is the "plug box" (`plugOpen`/`plugBrief`/`plugToken`); it has
  a connect flow but lacks the brew-style name+brief+copy parity.
- **Brew-icon** is a `set_player_icon` action (`uc_it_` token, `player-icon` route),
  not a world — the house AI has no icon job type.

To make "use house AI" real on these, the swarm must accept non-world targets.
Decision pending (asked, user away) — options:
  1. Branch bring-your-own-AI parity (name+brief+copy on the plug box) — UI only, no swarm change.
  2. House AI builds branches — enqueue scene briefs; daemon builds via uc_sc_.
  3. House AI brews icons — new job type: icon description + uc_it_ → set_player_icon.
  4. Unify: one "build request" (world|branch|icon) the swarm handles; wire all panels to it.
Recommendation: 1 now (direct fix for the stated complaint), then 4 to end the copy-paste.
Also still queued: live build console (stream a world's bridge commands under the spinner).

## BLOCKER #1 — CSRF rejects the token mint (FIXED in phase 1)

The daemon mints via `POST /api/spaces/[slug]/token`, but `src/proxy.ts` (CSRF
middleware) 403s any mutating `/api/` request with no `Origin` header, and a
server-side fetch sends none. Log shows it looping: `no token … "Forbidden:
missing origin"`. The token route already authorizes the house AI by Bearer, so
the fix is to exempt bearer-authed mutations from CSRF (they carry no ambient
cookie → not a CSRF vector):

```ts
// in proxy.ts, right after the CSRF_EXEMPT_PATHS check:
const authz = req.headers.get('authorization')
if (authz?.startsWith('Bearer ')) return NextResponse.next()
```

NOT applied yet — it edits production auth middleware; awaiting Galen's OK.

## BLOCKER #2 — sandbox-exec can't run Claude's auth

Goal was: let the build agent reach cartridge.cafe, wall it off from the Mac.
`tools/build-sandbox.sb` (deny-list profile) was written and **the file wall
works** — verified inside it: `~/.config/gh`, `~/.config/neonctl`,
`~/Documents/**/.env.local` all return EPERM ("Operation not permitted"), while
`~/.config/configstore` (claude needs it) stays readable.

**But Claude Code will not run reliably under `sandbox-exec`.** It EPERMs at
native startup — and does so even with a bare `(version 1)(allow default)`
profile, proving it's not the deny rules. It's sandbox-exec wrapping Claude's
binary + its Keychain (`securityd`) auth. Subscription creds live in the macOS
Keychain (`security -s "Claude Code-credentials"`); a file credential at
`~/.claude/.credentials.json` did NOT help (macOS claude prefers Keychain).

Lesson: **sandbox-exec is the wrong isolation for Claude Code.** Use a separate
macOS user instead — its own Keychain (no securityd fight), and Unix perms hide
`/Users/galengoodwick` from it natively. That closes both the file exposure and
the credential exposure without touching sandbox-exec.

## Daemon wiring

`builder-daemon.mjs` launches each build via `sandbox-exec` by default
(`CAFE_SANDBOX` unset). Given Blocker #2, that currently **fails closed** — every
build EPERMs rather than running unsandboxed. `CAFE_SANDBOX=off` runs unsandboxed
(trusted testers only). `CLAUDE_BIN` overrides the CLI path.

## Decision pending (Galen)

- **A. Separate macOS `cafebuilder` user** (recommended) — robust; needs a
  password + one interactive Claude sign-in under that account.
- **B. Unsandboxed, invite-only** — set `CAFE_SANDBOX=off`, apply the CSRF fix,
  install LaunchAgent `com.cafe.builder`. Works now, no wall; keep off the public net.
- **C. Keep digging on sandbox-exec** — low odds (allow-default already fails).

Not installed as a LaunchAgent. Not pointed at the public.
