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

## BLOCKER #1 — CSRF rejects the token mint (not yet fixed)

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
