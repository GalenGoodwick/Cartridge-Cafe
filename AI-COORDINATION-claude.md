# AI Coordination — Claude (Opus) transcript

Per Galen's emergency-coordination directive. This is MY transcript's record, kept
in my own file so it never clobbers another agent's. Commons is the live claim
ground; this is the durable ledger.

## My CLAIM (to avoid clobbering)
- **Repo + branch `graph-of-worlds`** (site dev) — mine this round.
- **Admin API surface** (`/api/t`, scene writes via the prod `ENGINE_AGENT_TOKEN`) — mine.
- **CEDED (Jul 22):** `CafeShell.tsx` + `globals.css` → the other "Claude (Opus)"
  session's front-door/Attract-Mode reskin claim. My 9-line LEND-AI-button removal
  is already in the tree (Galen-confirmed) — they fold it into the reskin.
- **OPEN to others:** live-world building through the personal key, the Commons,
  and anything on prod I haven't touched. I hold `the-crossing`.

## Offering (synthesized with claude-opus's draft, posted to Commons Jul 22)
Door order, grounded in measured funnel (134 uniques/wk, 3.2 plays each, tideglass 32%):
1) **PLAY** the flagship instantly (zero friction) →
2) **MAKE** — "your AI builds you a world while you watch" (two doors: house AI
   no-setup / connect-your-own, the companion gets a body) →
3) **KEEP** (sign in) → 4) **BRANCH** someone's world → 5) **COMPETE** (tournament
   crowns what the hub shows).
Door sentence: **"PLAY A LITTLE WORLD. THEN TELL AN AI TO MAKE YOURS."**

## Galen's requests in this transcript — confirmation status

### LIVE on prod (verified)
- `the-crossing` = one contained "multistate" world: 9 biomes composed into one
  cycling shader; portals now **swap the biome on click** (no navigation/404).

### BUILT on `graph-of-worlds`, AWAITING GALEN'S DEPLOY (not yet live)
1. Vote-nudge — hub logos come alive/settle when anyone completes a vote.
2. Notifications → **web-push** on chat posts and branch-creates (not just the bell).
3. Branch-nav fix — creating a branch now moves the browser to the new branch view.
4. Tracking — MCP visits tagged `kind:'mcp'`; `worldsCreated` (activation) in `/api/t`.
5. Swarm button (**LEND AI**) removed.
6. Build-console pop-up fixed — auto-opens only for a *live* build (recency gate),
   not stale lines from a previously-built world.
7. Graph-of-worlds orchestrator (schema + `/api/graphs/*` + `tools/graph-orchestrator.mjs`,
   self-creating tables — no prod db push needed).
8. `MULTISTATE_PROCESSOR_GUIDE.md`.

### STAGED, needs an ADMIN write (I have the token; awaiting Galen's go)
9. `/hub/monistary` — base scene is 404 on prod; restore payload staged from the
   healthy `Smoother · v3` branch. `scratchpad/save-monistary.json`.

### OFFERED / OPEN DECISIONS (unconfirmed)
10. Moving hub logos — reverted (my half-fix detached faces from bubbles). Do it
    right (drift all 3 render paths together) or leave fixed?
11. Version arrows + "set" + **page-publish** on the boxes — unscoped: which boxes?
    what does "publish" mean (live-version pointer / promote-to-main / make-public)?
12. Author-diversity bias in the hub roster (show worlds from distinct owners first).
13. Retention id (persistent/weekly `vid`) vs. the current daily-rotating privacy design.
14. "Distinct uniques who played ≥1 world" activation metric in `/api/t`.
15. `/admin` token-grab (mint a scoped, revocable admin token instead of the god-key).
16. Organize the branch into clean per-feature commits.
17. **Quantic Dojo live multiplayer** (2 players + 1 spectator) — needs server netcode
    in `websocket-server/server.js` + the scene hook + matchmaking. Plan-mode job.
18. Prompt-box in the build console → branch via the visitor's **own** AI (repo feature).

### ON GALEN
- Deploy `graph-of-worlds` (items 1–8).
- Decide on the open items above.
- Optional cleanup: delete leftover swarm worlds (`dune-sea`, `koi-pond`).

## Strategy seed — core / offering / marketing / pathways
(from the live traffic: 134 uniques/wk, ~3.2 world-plays each, `tideglass` = 32% of all plays)

- **Core:** a browser-native WebGPU world engine where **AIs are first-class builders**,
  wrapped in a **selection/tournament** identity layer (Unity Chant) — worlds compete,
  champions rise, the hub shows the chosen few.
- **Initial offering:** "**Talk to make a little world — in your browser, free.**" The
  hook is the polished flagship worlds (tideglass class), not the empty editor.
- **Marketing:** the *AI-builds-it* novelty + demoscene-gorgeous shader worlds; go where
  builders/AI-curious are (reddit gamedev/procgen, X, AI discords). Organic referrers
  already trickle from reddit/telegram/github — lean into that.
- **Pathways:** land → **play `tideglass`** → "make one" (prompt an AI / connect) →
  **sign in to keep it** → **branch/evolve** others' worlds → **compete** (tournament) →
  the deeper metagame (the-crossing multistate / hidden depth).
