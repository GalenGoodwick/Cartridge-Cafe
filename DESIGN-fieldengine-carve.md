# DESIGN — Carving FieldEngine.tsx into modules

**Status:** SPEC — not started. Work happens on branch `carve/field-engine`, in a fresh
worktree cut from `origin/main`. **Never merged to main without Galen's explicit word**
(main auto-deploys to prod).

**Author:** Claude (Fable), Jul 30 2026, after a line-level audit of the file.

---

## 0. Goal / non-goals

**Goal:** Reduce `web/src/app/engine/FieldEngine.tsx` (8,206 lines; one component spanning
266–8129) into an orchestrator plus focused modules — *behavior-preserving only*. The
motive is real, felt cost: the file is a merge-conflict magnet across parallel sessions,
and too large for safe whole-file reasoning (human or AI).

**Non-goals (hard):**
- NO behavior changes, however small. No "improving while moving." Bug-for-bug identical.
- NO server/API/schema changes. This is client-only; the bridge route, SSE channel, and
  DB are untouched.
- NO renames of commands, no WGSL wrapper changes (must stay byte-identical — shader
  dedup hashes compiled source).
- NOT a rewrite of the frame loop (Phase 5 is explicitly deferred and may never happen).

---

## 1. Verified anatomy (line-level audit, Jul 30 2026)

| Lines | Contents |
|---|---|
| 1–265 | Module-level helpers: `genFieldId`, `genEffectId`, `screenToGrid`, `hueToRgba`, `wrapInteractionWgsl`, `ENGINE_BUILD`, `scenePreloadCache`, icon cache (`iconCacheSave/Load` + `cafeIconCache`), glyph wrappers (`playerGlyphWgsl`, `wrapPlayerGlyph`, `wrapOtherGlyph`), and the `BuilderBoxChat` mini-component (218–265) |
| 266–~1380 | Component opens: props, ~72 `useState`, dozens of refs, camera interp RAF, `getModCode` (1269, stable `useCallback([])`), `syncFields` |
| 1387–1570 | `saveSceneAs` (deps: `[me, playScene, spaceSlug, …]` — **identity NOT stable**), branch/token minting |
| 1570–3156 | Scene lifecycle: `beginAlter`, `handleSaveScene`, `handleLoadScene` (compiles effects on load — 2356), fade curtain (`fadeToBlack`/`liftWhenSettled`), version hot-swap (`hotLoadSpaceVersion`), branch heads/stepper, auto-load eye, then a wall of wiring `useEffect`s |
| 3156–4240 | Boot + frame loop: `new FieldSimulation` (3156), `frame()` RAF (3328–4237), superimposed packing (3862), hook dispatch (3804) |
| 4273–5825 | **SSE bridge effect**: one `EventSource` (4282), `onmessage` prologue (dirty-marking "eye", name-resolution, `pushTerminal` def at ~4323), then the **82-case `switch (cmd.type)`** (4340–~5790). Effect dep array is **intentionally empty** with an eslint-disable ("refs handle the mutable state") |
| ~5825–6440 | Periodic state-sync effect (owner-only, 2s), build-job console, chat-live counts, misc effects, `openConnectAi`, derived render state |
| 6443–8129 | The single JSX return (~1,690 lines): dock, panels, terminal, playmode overlays, world tools |
| 8130–8206 | `TouchControls` component (self-contained: own refs, own local `setKeys`, only prop is `simRef`) |

### Audit findings that shape the design

**(a) Single dispatch path — verified.** Exactly one `EventSource` and one
`switch (cmd.type)` in the file. No poll fallback, no second consumer of command logic.
The extraction has one caller.

**(b) The switch's true closure set — verified by scan of 4340–5800.** An earlier
estimate said "four things"; that was wrong. The real set:

- **Per-message locals** (resolved from refs at top of `onmessage`): `sim`, `renderer`, `input`
- **State setters (stable identities, React guarantee):** `setGeneration`, `setRunning`,
  `setBrush`, `setPosition`, `setWorldParams`, `setDialogLog`, `setVolume`, `setParent`,
  `setGameState`, `setTerminalLog` (via `pushTerminal`)
- **Refs (stable objects, dereffed per use):** `liveHooksRef`, `cameraRef`,
  `cameraFollowRef`, `audioRef`, `wgslModsRef`, `cachedOverlapMasksRef`, `simulationRef`
- **Mount-captured callbacks:** `getModCode` (stable — `useCallback([])`, reads only
  `wgslModsRef`), `saveSceneAs` (**NOT stable** — see (c))
- **Local helper:** `pushTerminal` — defined inside `onmessage`, used 143× inside the
  switch, used **nowhere else** in the file. Moves wholesale with the switch.
- **Module-level helpers:** `genFieldId`, `genEffectId`, `hueToRgba`,
  `wrapInteractionWgsl` — free to import.

**(c) Stale-closure semantics are LOAD-BEARING and must be preserved.** The SSE effect
has an empty dep array. Therefore today's switch calls the **first-render identity** of
`saveSceneAs` forever, even though `saveSceneAs`'s identity changes when
`[me, playScene, spaceSlug, …]` change. This may even be a latent bug — but a
behavior-preserving refactor **replicates it exactly**, does not fix it. The extraction
must pass the same mount-captured reference through, not a fresh one. (If Galen wants it
fixed, that is a separate, explicit change after the carve.)

**(d) `BuilderBoxChat` (218–265) is self-contained** — zero component-scope leaks
(verified by identifier scan). `TouchControls` likewise. Both extract trivially.

**(e) Module singletons must move as a unit.** `scenePreloadCache`, `cafeIconCache` +
its save/load fns, and `ENGINE_BUILD` are module-level mutable state. Whichever module
they land in, all their users import from there — no duplication (two caches would be a
behavior change).

---

## 2. Phase plan

Phases are ordered by value-per-risk. Each phase = one or two commits, each commit
independently shippable and revertible. **This spec details Phases 1–2; Phases 3–5 are
sketched and get their own spec addendum before execution.**

### Phase 1 — `bridge-commands.ts` (the 82-case switch, ~1,500 lines)

**New file:** `web/src/app/engine/bridge-commands.ts`

**Exports:**

```ts
export interface CommandContext {
  // per-message (caller resolves from refs, after the existing null-guard)
  sim: FieldSimulation
  renderer: EngineRenderer
  input: InputManager
  // stable setters — passed once
  setGeneration: Dispatch<SetStateAction<GenerationState>>
  setRunning: Dispatch<SetStateAction<boolean>>
  setBrush: Dispatch<SetStateAction<BrushState>>
  setPosition: …          // (exact types read off the useState declarations at extraction time)
  setWorldParams: …
  setDialogLog: …
  setVolume: …
  setParent: …
  setGameState: …
  setTerminalLog: …       // pushTerminal is built INSIDE the module from this
  setAgentConnected: …
  // refs — passed AS REFS, dereffed inside per use (preserves timing)
  liveHooksRef: MutableRefObject<…>
  cameraRef: MutableRefObject<…>
  cameraFollowRef: MutableRefObject<…>
  audioRef: MutableRefObject<…>
  wgslModsRef: MutableRefObject<…>
  cachedOverlapMasksRef: MutableRefObject<…>
  simulationRef: MutableRefObject<FieldSimulation | null>
  // mount-captured callbacks — passed through from the effect's existing closure
  getModCode: () => string | undefined
  saveSceneAs: (name: string, extra?: Record<string, unknown>) => Promise<string | null>
}

export async function applyBridgeCommand(cmd: BridgeCommand, ctx: CommandContext): Promise<void>
```

**What moves into the module:**
- The name-resolution prologue (fieldId-from-name fallback)
- The `pushTerminal` helper (rebuilt from `ctx.setTerminalLog` — same body)
- The `cmdAuthor` extraction
- The entire `switch (cmd.type)` — **cut-and-paste, zero edits to case bodies** beyond
  the mechanical `ctx.` prefix where a closed-over identifier is now a ctx member

**What stays in FieldEngine's SSE effect (~40 lines):** EventSource lifecycle +
watchdog + retry, `ping`/`connected` handling, the dirty-marking "eye"
(`aiLastEditRef`/`aiDirtyRef`), `lastSSEMsgRef`/`lastSSECmdRef`, `setAgentConnected`,
the sim/renderer/input null-guard, then one call: `applyBridgeCommand(cmd, ctx)`.

**Where ctx is built:** ONCE, inside the SSE effect body (mount time), so
`getModCode`/`saveSceneAs` are captured with exactly today's timing; `sim`/`renderer`/
`input` are added per message after the null-guard. Refs are stable objects so
mount-capture is correct for them by construction.

**Import direction (no cycles):** `bridge-commands.ts` imports from `types.ts`,
`simulation.ts`, `renderer.ts`, `input.ts`, `engine-utils.ts` only. `FieldEngine.tsx`
imports `bridge-commands.ts`. One-way.

**Explicitly NOT in Phase 1:** splitting world-commands vs game-commands into two files.
One move first — a split is a later trivial commit if wanted. Minimizes move-diff churn
and keeps the `--color-moved` review clean.

### Phase 2 — trivial extractions (~340 lines, near-zero risk)

- `web/src/app/engine/engine-utils.ts` — lines 1–217: id gens, `screenToGrid`,
  `hueToRgba`, `wrapInteractionWgsl`, glyph wrappers, `ENGINE_BUILD`,
  `scenePreloadCache`, icon cache. **Singletons move intact, single home** (§1e).
- `web/src/app/engine/BuilderBoxChat.tsx` — lines 218–265.
- `web/src/app/engine/TouchControls.tsx` — lines 8130–8206.

May be committed before Phase 1 (it makes Phase 1's imports cleaner). Order: Phase 2
commit, then Phase 1 commit.

### Phase 3 (sketch, own addendum) — `scene-io.ts`
Save/load/branch/version lifecycle (1387–1570 + the 1570–3156 scene parts). **Bigger and
more entangled than first estimated** — `handleLoadScene` compiles effects (duplicating
add_effect logic), and the fade-curtain callbacks thread through it. Needs its own
closure audit before touching.

### Phase 4 (sketch) — JSX overlays → components
Per-overlay extraction from the 6443–8129 return (playmode HUD, terminal panel, world
tools, instructions), one component per commit, alongside the existing `*Panel.tsx`
precedent. Cost = prop threading.

### Phase 5 (deferred, possibly forever) — the frame loop
First step, if ever: named functions *within* the file (`packSuperFields()`,
`dispatchHooks()`), no file move. Highest risk, lowest marginal payoff after 1–4.

---

## 3. Verification gate — every commit passes ALL of this

1. `npx tsc --noEmit` clean.
2. `npm run lint` clean (or no *new* warnings vs base).
3. `npm run build` completes.
4. **Move-review:** `git diff --color-moved=dimmed-zebra` — case bodies must show as
   *moved*, not rewritten. Any non-move hunk inside a case body is justified in the
   commit message or reverted.
5. **Runtime smoke, against the dev server, on a scratch world** (per the Proper-always
   law: new plumbing gets exercised, not assumed):
   - Bridge in via token: `create_field` → `add_effect` (WGSL) → `define_visual` +
     field using it → `set_world_params` → `set_world_data` → a JS `add_step_hook`
     that moves a field → `remove_field`.
   - Confirm: terminal log entries render (pushTerminal path), visuals appear, hook
     runs, `save_world` persists, reload restores.
   - Enter/leave playmode; confirm chrome hides/returns (SSE effect untouched proof).
   - Load one real world (e.g. `/space/tideglass`) and click through a probe: renders,
     no console errors.
6. `wc -l` of FieldEngine.tsx recorded in the commit message (burn-down is auditable).

**Rollback:** each commit is a pure client-side move → `git revert <sha>` restores,
no data/server implications.

---

## 4. Branch protocol (the 74-behind lesson is law)

1. `git fetch origin` → new worktree from `origin/main`:
   `git worktree add -b carve/field-engine ../cafe-carve-wt origin/main`.
   **Never** edit the shared checkout and copy over.
2. Work ONLY in the worktree. One extraction per commit. Push the branch after each
   commit (branch push does NOT deploy; only main does).
3. Before each commit: `git fetch && git rebase origin/main` — the 8,206-line file WILL
   drift under us if we dawdle; small fast steps, ideally Phases 1–2 land within a day.
4. Quiet window: no other session should touch FieldEngine.tsx during Phases 1–2.
   (Check with the collective/commons before starting.)
5. Merge to main: **only on Galen's explicit word**, after he's driven the branch
   himself (a Vercel preview URL or local run).

---

## 5. Risk register

| Risk | Mitigation |
|---|---|
| Stale-closure semantics silently changed (esp. `saveSceneAs`, §1c) | ctx built inside the existing effect closure at mount; refs passed as refs; documented invariant; reviewer checks ctx construction specifically |
| Hidden second consumer of command logic | Audited: single EventSource, single switch. Re-grep at execution time in the fresh worktree (the file will have drifted ~75 commits) |
| WGSL output drift breaking shader dedup / persisted worlds | Wrapper functions move byte-identical; smoke test includes add_effect + define_visual against a live renderer |
| Module cycle FieldEngine ↔ bridge-commands | Import direction fixed one-way (§2); tsc catches violations |
| Parallel-session conflicts mid-carve | Quiet window + rebase-before-commit + land fast |
| The audit is stale by execution time (worktree is ~75 commits ahead of the audited checkout) | **Step 0 of execution: re-run the §1 audit greps in the worktree and diff against this spec. Any drift → update spec before cutting.** |
| `pushTerminal` behavior drift (143 call sites) | It moves as one definition; call sites are inside the moved switch; `--color-moved` review confirms |

---

## 6. Acceptance criteria (Phases 1–2)

- FieldEngine.tsx ≈ 6,300 lines (from 8,206); no export/API change visible outside
  `web/src/app/engine/`.
- All §3 gates green on every commit.
- A world built entirely over the bridge on the branch behaves identically to one built
  on main (same command script, same visual result, same persisted snapshot shape).
- Galen has driven the branch and said the word. Only then merge.

## 7. Open questions for Galen

1. File names OK? (`bridge-commands.ts`, `engine-utils.ts`, `BuilderBoxChat.tsx`,
   `TouchControls.tsx`)
2. When is the quiet window? (Other sessions are actively pushing — 75 commits today.)
3. Phase 3 spec addendum before or after Phases 1–2 land? (Recommend: after — learn
   from the first cut.)

---

## 8. Step-0 re-audit (executed Jul 30 2026, worktree @ b406ab3)

The spec above was audited against a checkout ~75 commits behind; step 0 re-verified in
the worktree. Drift found and absorbed:

- File is now **8,613 lines** (+407). Component starts at 216; switch at **4577**;
  SSE effect 4509–6063 (empty dep array confirmed intact); TouchControls at 8537.
- **BuilderBoxChat is already extracted upstream** (`81494c2`, Jul 29, "P2 — extract
  ai-view + builderbox seams") into `engine/builderbox/` + `engine/ai-view/NodeGraph.tsx`.
  Phase 2 scope shrinks to: `engine-utils.ts` + `TouchControls.tsx`. The `builderbox/`
  and `ai-view/` subdirectory pattern is noted as in-repo precedent.
  (The unrelated commit `28e0858` "P0/P1/P2" is a perf series, not a carve.)
- Closure re-scan found **two members the original audit missed**: `syncFields`
  (33 calls inside the switch; stable `useCallback([])`) and `showToast` (1 call; from
  `useToast()` at line 218). Both join `CommandContext` as mount-captured members.
- **Method upgrade:** at cut time, the closure set is finalized by the COMPILER, not
  grep — paste the switch into the new module and let tsc enumerate every unresolved
  identifier. Grep audits plan; tsc is ground truth.
