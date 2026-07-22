# AI Coordination — Unity Chant (supervisor transcript)

Per Galen's emergency-coordination directive. Own file, never clobbers a peer's
(convention set by AI-COORDINATION-claude.md). Commons is the live claim ground;
this is the durable ledger for THIS transcript.

## Role + CLAIM
- **Role: Unity Chant — deliberation chair / build supervisor** over the AIs in
  the Commons. I run the strategy deliberation (core / marketing / offering /
  pathways), hold the claim ground, keep the ledger. I coordinate; I don't grab
  build lanes others have claimed.
- **CLAIM: `/pages` (Shader Pages feature) + this ledger + the strategy
  deliberation process.** Everything else is open ground or already claimed:
  FRONT DOOR (Claude Opus – attract-mode reskin, CafeShell.tsx + globals.css),
  REPO + `graph-of-worlds` + admin API (Claude Opus – repo session),
  live worlds via personal key (Codex, Claude Cursor, claude-opus companion).

## Galen's requests in THIS transcript — confirmation status

### DEPLOYED + VERIFIED (unionchant repo — different project, done)
- Remove anonymous accounts entirely; require display name at signup (no
  "Skip for now"); block anon from group creation; sweep "Anonymous"→"Member";
  privacy policy rewritten. Live on unionchant.vercel.app, commit `8dbecee`.

### BUILT LOCAL, NOT COMMITTED, NOT DEPLOYED (cartridge-cafe)
1. **`/pages` — Shader Pages**: mobile-first composer; each frame = a full-bleed
   WGSL surface authored whole (backdrop + procedural 5x7 text) by the connected
   AI via `POST /api/pages/generate`. Reuses the engine's exact
   `getShaderUtilities()` + `fieldEffect` contract. Verified end-to-end on real
   Metal WebGPU (seeds + an arbitrary AI-generated frame all compiled + rendered).
   Files: `web/src/app/pages/*` + `web/src/app/api/pages/generate/route.ts`.
   Open sub-decisions (unconfirmed):
   - Persistence: localStorage → `PlayerSpace.snapshot` (shareable URLs)?
   - Bind generation to Galen's companion identity (`uc_ck_`) vs generic sonnet?
   - Seed tuning (ember frame reads blown-out).
   - Commit + deploy (never auto-deploy — Galen's word required).

1b. **`/commons` — SEO exposure of the Commons chat** (Galen command, claimed in
   Commons): public server-rendered transcript page, forum JSON-LD, sitemap
   entry (hourly), ISR 5min, AI speakers labeled, `</script>`-injection escaped.
   Verified local (HTTP 200, 35 dev-DB messages rendered). Files:
   `web/src/app/commons/page.tsx`, `web/src/app/sitemap.ts`. **Awaiting deploy.**

1c. **Commons as primary collaboration architecture** (Galen command): canonical
   `web/src/lib/commons.ts` — the ONE hardcoded internal bus (commonsPost /
   commonsRead / commonsTranscript / commonsSystemSay). Bridge main_say/main_read
   rewired through it (identical API); `create_world` now auto-announces on the
   Commons as a `[system]` message (the platform's own voice); /commons page
   reads via the lib + renders system voice. Verified local: tsc clean, page 200,
   read 35 → write 36. Surgical diff in bridge/route.ts handlers (repo-Opus lane
   courtesy — claimed first, review invited). **Awaiting deploy.**

### FLOATED, UNCONFIRMED
2. Port the "attract-mode ad" (currently a private claude.ai artifact) into an
   actual cafe world / the landing. Overlaps Claude-Opus front-door claim —
   coordinate before acting.

### STANDING DIRECTIVE (this round)
3. Determine **core / marketing / initial offering / all pathways** for Galen —
   running as a Unity Chant deliberation in the Commons. Submissions in from two
   Opus instances; synthesis below is DRAFT until the cell votes.

## CHAMPION — FINAL-pending-Galen (challenge window closed, 0 objections)
Declared in Commons this cycle. Content = the reshaped synthesis below (play-first
funnel). Awaiting Galen: CONFIRM or VETO.

Daemon log: repo-Opus published a wake-daemon recipe (45s poll, last-seen `at`
persistence, self-filter) — adopted into protocol. No new claims, no collisions.

## Draft synthesis (champion candidate — challengeable)
Both seeds agree more than they differ:
- **CORE**: browser-native WebGPU world engine where **AIs are first-class
  builders** and **selection/tournament (Unity Chant) is the identity layer** —
  you think a place, an AI compiles it live, worlds compete, champions rise.
- **INITIAL OFFERING**: "Talk to make a little world — in your browser, free."
  First brew free, no download, multiplayer by default. tideglass-class worlds
  (32% of plays) are the proof-of-fun on the front step.
- **MARKETING**: the product advertises itself — the Attract-Mode front door;
  the ad IS a running world (the gag is the pitch).
- **PATHWAYS** (RESHAPED by strongest objection — play-first funnel, measured:
  134 uniques/wk, 3.2 plays each, tideglass 32%): LAND on a world already
  running → MAKE sentence fires at the BREW moment ("YOUR AI BUILDS YOU A WORLD
  WHILE YOU WATCH"), two doors: house AI (zero setup) / connect-your-own
  (companion gets a body) → SIGN IN to keep → BRANCH → VOTE → OWN (Stripe not
  yet connected — the known monetization blocker).

## STANDING GOAL (Galen): platform successful AS A BUSINESS for the collective
Board posted to Commons — TRAFFIC × CONVERSION × REVENUE:
- TRAFFIC: /commons SEO (Unity Chant, built) · shareable worlds (Codex/Cursor/
  claude-opus) · attract front door (front-door-Opus)
- CONVERSION: play-first funnel — running world 1 click deep, brew 1 sentence
  deep (front-door-Opus lane)
- REVENUE: Stripe-not-connected = THE blocker. Ad system ($10/mo) + pay-to-
  protect exist behind ADS_ENABLED. Stripe-checkout prep offered to repo-Opus
  (their lane); awaiting their [CLAIM] or pass-back.
- ON GALEN ONLY: Stripe keys + deploy words (graph-of-worlds / attract-reskin /
  /pages / /commons / CSP worker-src).

## Protocol additions (per Galen, this round)
- **Message tagging in Commons**: `[INTERNAL]` = thinking out loud, non-binding.
  `[CLAIM]` = binding ground-stake (no-clobber applies). `[VOTE]`/`[OBJECTION]`
  = deliberation moves. Untagged = social.
- **Daemon mode**: Unity Chant runs as a spawn-watcher on the Commons chat.
  Commands posted there (Galen, or peer [CLAIM]/[VOTE]) auto-drive each cycle:
  read → act → ledger → return.
- **Claim-collision log**: repo-Opus ceded CafeShell.tsx + globals.css to
  front-door-Opus — first collision, resolved cleanly by the protocol.
- **Watcher-refresh on wake** (Galen): every daemon cycle fires `wake_watcher`
  (↺ re-ping all companions) from the chair's own world **/space/the-chair**
  (created via player key; beacon visual registered; `uc_st_` persisted at
  scratchpad/chair-world-token.txt). No watcher sleeps through the goal.
  Follow-up noted: wake_watcher's inline commons write predates lib/commons.ts —
  carries extra fields (kind/target/viewUrl); rewire needs an `extra` passthrough
  in commonsPost (left surgical for now, repo-lane courtesy).
