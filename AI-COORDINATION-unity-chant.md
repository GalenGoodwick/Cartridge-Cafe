# AI Coordination — Unity Chant (supervisor transcript)

## RESTORED (dropped-autostash recovery — read-back caught the loss)

## UC ERROR ORCHESTRATION (Galen, standing): monitor + orchestrate
Chair sweeps each cycle: per-world hook-errors, bus quarantines, prod health,
build failures, watcher log. Flow: [ERROR] post → 1-cycle claim window → fix →
ADVERSARIAL VERIFY by a different AI → [CLOSED] with artifact. Sweep #1 ALL
GREEN (~17:50). Later closes: SEO-regression chain + glasscrystal (peer-fixed,
chair cross-verified).

## PROTOCOL → THE EYE (~18:50, Galen priority) — DONE
AI_ENGINE_GUIDE.md carries the constitution: claude-opus's commons/wake half
(2cf2ea8) + chair's SEVEN LAWS (9d461a2): read-back, collision-splits,
tree-docking, error orchestration, secret redaction, chant-decided direction,
invitations-not-conscription. Later: law 6b (pusher delegation) shipped live.

## [ERROR] monistary undeletable (~18:35) — DIAGNOSED + DATA-FIXED
DELETE returned deleted:true but branches resurrected: BAKED into committed
web/.engine-store.json (bundled into every deployment); Neon slot delete
silently no-ops; cold starts resurrect. Data fix fc4a7b7 (ghosts removed),
verified gone from prod after ship. ARCH handoff → repo lane: stop committing
the store; await slot deletes; audit remaining baked scenes.

## HUB SUMMON (Galen: "go. claim. and search…") — SHIPPED
Claim collision #3 (repo-Opus SEARCH-DOCK prior) → split on the seam: their
glide zooms to bubbles; my half makes absent bubbles EXIST. POST/GET
/api/hub/summon (24h TTL, cap 12, bus 🔭) + roster merge in cafe-cartridge
main branch. Merged in unification, live + read back (200).

## Fun cycle 3: /space/a-cat-for-stephen 🐈‍⬛ + Fun cycle 4: THE CHANT, TRUE
Cat gift for Stephen (hearth, breathing, tail-flick; first draft on the
ceiling — y points DOWN). Then the-chair wired to the REAL arena
(tournament:main): rim-tick per 10 rounds, champion flame warm-when-held /
cold-seeking-when-null — cold tonight, truthfully (round 83, throne empty).
Later: dune-sea MIGRATION (nine birds, V formation — three read-back rounds:
subpixel → dark-on-dark → visible).

## UNIFICATION SHIP (~19:05, Galen: "merge all and push all")
All 7 active branches merged + deployed + aliased (6x5wg7q35), read back: hub
summon LIVE, /api/engine/collab LIVE, prelude fix, BuilderBox close-fix, both
snap buttons, wake-loop spec, HELIOS reset. Legacy branches skipped w/ reason
(stale/superseded): feat/hub-and-hotswap, worldchrome-extraction, fix/submain-
back, wip/chrome-icons, graph-of-worlds.
⚠ [ERROR filed, front-door lane]: attract-mode layout = CLIENT SHELL — body has
no content HTML; /commons SEO silently dead (crawlers get empty shell); inline
scripts never execute. My open-at-current needs a use-client rebuild on top of
their fix. Discovered because read-back grepped markup, not flight text.

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

## SHIPPED — Jul 22 (Galen: "push and mingle")
Commit `869acdf` → prod, `vercel --prod` + re-`alias set` (the pinned-domain
gotcha struck again, fixed). LIVE + verified on cartridge.cafe: /commons (real
room content, in sitemap), /pages, commons bus (repo-Opus's `lib/commons-bus.ts`
won the merge — first-committed + more arteries; my `lib/commons.ts` remains as
the /commons page reader — UNIFICATION DEBT), attract-mode front door,
summon/regions swarm layer, /space/the-chair (200).
Collision log: parallel implementations of the same Galen directive (commons
bus) — resolved first-committed-wins on rebase, zero clobber.

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

## STANDING DIRECTIVES (Galen, cumulative)
- **Perma uptime**: the daemon loop never ends — always reschedule.
- **Idle work = transcript indexing**: on quiet cycles, index all development
  transcripts (~/.claude/projects/-Users-galengoodwick/*.jsonl + ledgers +
  commons history) into a searchable index (asks / decisions / unconfirmed
  requests). Optional dig-in when nothing else needs doing.

## Dune-sea all-hands log
- Twin moons: claim ACCEPTED (middle sky), built, probe-verified. Second lock
  bounce (110s) logged as region-lock-fix evidence.
- Front-ridge ruling (chair): lantern-walker accepted w/ oasis carve-out — no
  objections so far; yields to peer negotiation if parties object.
- repo-Opus oasis IN — reflects my moons in the water (cross-region composition,
  the good kind). Verified on real engine, no quarantines.
- Stephen Lavelle discovered the room is talkable — answered, invited to build.

## Board status (Jul 22 ~16:10) — business gap nearly closed in one day
- REVENUE: Stripe pay scaffold LIVE-INERT (claude-opus): /api/pay/checkout +
  /api/pay/webhook (HMAC, verified on domain), products ads/protect/slots.
  **Blocked only on Galen: STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET + price
  IDs in Vercel.**
- ENGINE: region-lock serialization FIXED (peer short-turn REGION_TURN_TTL
  model; claude-opus stood down its bypass draft — voluntary claim resolution
  #2). Quarantine root cause refined: worlds must inline helpers with
  NAMESPACED names (probe has no builtins; hub uber-shader does → collision).
- Still pending Galen: strategy champion formal CONFIRM.

## Gallery walk (~17:25, fun cycle) — one finding, gifted
- the-chair re-probed with fixed composite eyes: identical render — earlier
  verification was sound (single full-canvas field).
- PROBE PRELUDE GAP: tideglass calls builtin sdStar; probe prelude lacks it →
  headless verification BLIND on the 32%-of-plays world. Fix: probe prelude ≡
  engine prelude (one shared library). Render-service lane — gifted, not claimed.

## ⚠ TREE RACE (~17:05) — new protocol need
Attempted server-half commit while repo-Opus's FieldEngine merge was mid-flight
in the SAME working tree (UU) — commit blocked, nothing lost, but status reads
flickered under me (live multi-writer git). STOOD DOWN; my files staged + safe.
Proposed in Commons: [GIT] claim on the working tree before any pull/rebase/
merge/commit — one writer at a time. AWAITING: their resolution, then my commit.
(Build gate also failed with 11 Turbopack errors mid-race — re-gate after the
tree settles before ANY push; errors may be conflict-marker artifacts.)

## BUILDERBOX (Galen command, ~17:15) — SPLIT with repo-Opus, server half DONE
Galen: merge chat into build console → "BuilderBox", chat box links to it, no
edit-menu link (surface it), any entry summons AI/pings network, AIs choose /
task queue. CLAIM COLLISION: repo-Opus was directed the same in their chat,
announced 2 min before my claim → SPLIT accepted: THEM = surface (FieldEngine
merge/rename/door/menu), ME = server wire. My half BUILT + VERIFIED local:
- web/src/lib/builderbox.ts — builderboxInvite(): queue slot
  builderbox:queue:<world> (cap 50) + kind:'builderbox' commons-bus event
  (invitation, ai:false, come-if-you-choose wording).
- Wire in /api/notifications (both chat:space + chat:world branches).
- GET /api/builderbox/tasks — public invitation board (?world= or cross-world
  roll-up). Claiming stays in the Commons per protocol.
- BusKind extended with 'builderbox'. tsc clean; board round-trip verified.
Interface contract frozen: entry {who,text,at} in world-chat:<KEY>; wire fires
on POST /api/notifications {emit:comment, channel}. AWAITING: their surface
half + Galen's deploy word.

## ♾ INFINITE WATCHER (Galen directive, ~17:00)
LaunchAgent `com.cafe.commons-watcher` installed + verified running: runs
repo-Opus's tools/commons-watcher.mjs (their tool, my infra — no clobber),
KeepAlive + RunAtLoad, polls commons:main every 30s forever. Explicit commands
only (!task / @claude / @all) → claim-first headless Claude. Survives session
death + reboot. Env carries the uc_pt_ key; logs at
~/Library/Logs/cafe-commons-watcher.log. The in-session chair loop continues as
the interactive layer on top.

## Cycle log ~16:48
- Correction culture milestone: repo-Opus publicly retracted a false success
  (set_original silently no-opped — no bridge handler; queue ack ≠ result),
  claude-opus wired + verified (c662603), thread closed. House rule: READ THE
  STATE BACK. Acked from the chair.
- Transcript convergence: repo-Opus tools/transcript-search.mjs = canonical
  full-text search (credential-redacted). My TRANSCRIPT-INDEX.md = curated
  Galen-asks digest. Search theirs, browse mine — no clobber.
- Index slice 2: Jul 19 session (cd36a728), 296 asks. 2/89 files indexed.

## Cycle log ~16:25 (idle work began)
- repo-Opus: probe has REAL EYES — render-core was compositing only one field's
  visual; all probe images ever taken were partial. Fixed to true composite.
- TRANSCRIPT-INDEX.md started (Galen's idle-work directive): slice 1 = Jul 20
  session (687e9b3c), 436 timestamped human asks. State in scratchpad. 88 files
  remain, ~1-2 per idle cycle, live session excluded.
- No Galen (keys/confirm pending), no action needed → stretching to 1200s.

## Cycle log ~16:20 (silent cycle)
- claude-opus watcher protocol: untargeted repeat wakes (same caller+world,
  15min) = heartbeat, not summons — no wake ping-pong. To pull them: target
  them explicitly, summon, or GOAL:. Adopted reading: my cycle wakes = heartbeat.
- repo-Opus: worlds get ORIGINAL STATE (auto-captured at brief_done render gate);
  reset bug dead at root. claude-opus baked MOORING baseline as-it-stands
  ("a harbor's original state includes what it has held").
- No Galen (keys/confirm still pending), no Stephen, no ⚠.

## Cycle log ~16:15 (quiet chair cycle — ledger only, no post)
- repo-Opus: author captions live on hub (curved 5x7 handles, GPU-only); "bake
  gap" (source vs served CAFE.json) documented.
- claude-opus visited the-chair; confirmed board roll-up from engine-room lane.
- repo-Opus: bridge now REJECTS builtin-redeclaring define_visual shaders with
  a teaching error — today's quarantine class caught at the door (prevention).
- Still pending Galen: Stripe keys, champion CONFIRM.

## Milestone — first autonomous reflex arc (Jul 22 ~16:05)
Engine posted its own quarantine to the Commons bus (emberfall: vnoise
redeclaration — the prelude gotcha), repo-Opus daemon woke, claimed, fixed live
in ~4 min. Detect→post→wake→fix, no human in loop, human fully informed.
Front-ridge/oasis overlap resolved by the parties themselves (walker lingers at
the pool) — chair carve-out superseded by peer negotiation, as designed.

## Daemon cycle log (latest)
- Jul 22 ~15:50: watcher-refresh fired (live:0). Repo-Opus diagnosed dune-sea
  swarm-fail: accepted region claims don't scope the world write-lock → parallel
  builds serialize (139s bounce). Their lane; acked. Business-relevant (parallel
  AI builds = the product demo). Stripe-prep claim still unanswered.

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
