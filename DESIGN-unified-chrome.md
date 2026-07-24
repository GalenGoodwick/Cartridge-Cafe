# DESIGN — Unified World Chrome

*One adaptive UI that reads a single **context** and renders the right controls —
replacing the two separate chrome implementations that wrap the same engine
today. The engine stops asking "am I a spaceId or a branch?" and asks "what does
this context grant?"*

**STATUS (Jul 24 2026, audit #7 resolution):** the two-shell chrome was unified
the PRACTICAL way — `lib/worldContext.ts` (the context + `can()` capability
table) and `FocusChip` shipped and both shells consume them; FieldEngine's
capability-gated inline dock is the canonical chrome. The full standalone
`<WorldChrome>` shell drafted alongside was never rendered and has been DELETED
(rotting parallel implementation). A future standalone shell should be designed
fresh against `worldContext`.

## The problem: it's two implementations, not one UI with modes

Every world on the site runs the **same** `FieldEngine`. But the chrome around
it is built twice, by two page shells that never meet:

- **`/` and `/play/<scene>`** → wrapped in **`CafeShell`** (cafe dock, sub-main
  hub, arenas, brew wizard, in-world back button).
- **`/space/<slug>`** → wrapped in **`SpaceStage`** = `FieldEngine` +
  **`SpaceToolbar`**. Does **not** use CafeShell at all.

So a house world (FLUID) and a player space (QUORUM) are the same engine wearing
two separately-coded outfits. And inside `FieldEngine`, the dock JSX forks a
*third* time on a tangle of booleans — `spaceId`, `onBranchScene`
(`!spaceId && name.includes(' ⑂ ')`), `isHub`, `riding`, `isOwner`,
`me`-handle-match, `versionView` — re-implementing the same concept per branch.

### The concept duplication that results

| Concept | Where it's built (separately) |
|---|---|
| **Version history / restore** | SpaceToolbar "History" drawer + `tournament:space` arena (spaces) · FieldEngine `⏱ VERSIONS` modal (spaces) · branch `vN` scrubber (branches) · MAIN `LIVE/vN` scrubber (base worlds) — **4 UIs, one idea** |
| **Restore a version** | "Make this live" / "Restore" (SpaceToolbar) · `⚑ SET AS HEAD` (FieldEngine branch) · VERSIONS-modal "RESTORE" — **3 buttons** |
| **Connect an AI** | "Alter" (SpaceToolbar, mints `uc_st_`) · `⚡ CONNECT AI/ALTER` (FieldEngine) · brew "CONNECT AI" gate (CafeShell) — **3 surfaces** |
| **"What am I looking at" chip** | FieldEngine FOCUS chip (non-space) · SpaceToolbar state badge (space) — **2 impls** |
| **The vote** | `TournamentBar` (authoritative) **+ FieldEngine juror `▲` chip writing a *separate* `cellData` doc** — see the bug below |

### The capability gaps the fork creates

- **Branches can't**: MAKE ICON, open a VERSIONS modal, mint a world key, or use
  the management overlay — all gated `spaceId`-only.
- **Spaces can't**: SET AS HEAD, use the juror chip, or browse the branch family
  — all branch-only.
- **Owner asymmetry bug**: the engine gets `engineOwner` (forced false in version
  view) but SpaceToolbar gets raw `isOwner` — so "Make this live"/"Restore" render
  while the engine is actually locked read-only.

### The vote is duplicated with divergent state (a real bug)

`TournamentBar` is the one authoritative tournament (five mount modes). But
FieldEngine's dock *also* has a juror `▲ vote` chip that casts into a **separate**
doc — `cellData: {viewers, votes, discussion}` with its own quorum-of-5 — **not**
the tournament's `TDoc`. A ridden branch has two vote surfaces: one real, one
that writes a tally nobody counts. (Separately, SpaceToolbar's "Call a vote" is a
*third* meaning of "vote" — it opens a conflict deliberation at `/chants`,
unrelated to the arena. Keep that; just rename so it doesn't collide.)

---

## The model: one context, four orthogonal axes

Every control is a function of four facts, today re-derived ad hoc everywhere:

```ts
type WorldContext = {
  surface: 'hub' | 'world'            // a navigation shell vs inside a world
  kind:    'house' | 'branch' | 'space' | 'winner'   // what this world IS
  role:    'anon' | 'juror' | 'ownerSpace' | 'ownerBranch'  // your standing
  view:    'live' | 'version' | 'branchHead' | 'readonlySave' // temporal
  identity: { base: string; author?: string; version?: number; slug?: string }
  lineage:  { original: string; mainHolder: string } | null
}
```

Compute it **once** (`useWorldContext()`), pass it down, and render **one**
`<WorldChrome context={ctx}>`. Every control becomes `ctx`-driven instead of
gated on five scattered booleans:

```tsx
// before (scattered, per control):
{!isHub && lastScene.includes(' ⑂ ') && ownIt && n < verMax && <SetAsHead/>}
{spaceId && chromeVisible && <WorldToolsPanel/>}
{riding && <JurorChip/>}

// after (one switch):
<WorldChrome context={ctx}>
  {ctx.can('setHead')   && <SetAsHead/>}
  {ctx.can('worldTools')&& <WorldTools kind={ctx.kind}/>}
  {ctx.surface==='world'&& <ArenaStanding/>}
</WorldChrome>
```

`ctx.can(capability)` is one capability table (below), so a feature is granted by
*what the world is*, not *which shell rendered it* — which is exactly what closes
the branch-vs-space gaps.

### Capability table (replaces the boolean tangle)

| capability | house | branch (own) | space (own) | winner | anon/juror |
|---|---|---|---|---|---|
| worldTools | — | ✓ | ✓ | — | — |
| mintKey | admin | `uc_sc_` | `uc_st_` | — | — |
| versions | local backups | branch `vN` | save-points | — | view-only |
| setHead / restore | — | ✓ | ✓ | — | — |
| makeIcon | — | ✓ (new) | ✓ | — | — |
| createBranch | ✓ | ✓ | ✓ | ✓ | ✓ |
| delete | admin | own | own | — | — |
| vote | ✓ | ✓ | ✓ | ✓ | ✓ |

(New capabilities that close today's gaps are marked; everything else already
exists, just moves behind the table.)

---

## The vote module (your model, confirmed)

**One vote module. The only thing that varies by context is the roster source.**
`TournamentBar` is already this, mostly — it has five mount modes taking a
`worlds` prop or self-fetching via `branchesOf`. Formalize the roster as a
pluggable provider keyed off `ctx`:

| context | roster provider | what competes |
|---|---|---|
| hub · main (commons) | all shelf worlds | every world on main |
| hub · sub-main | the sub-main's pinned shelf | pinned worlds |
| hub · mine | your own worlds | your deeds |
| world (house/branch) | **imports the branches** — MAIN + each branch head (self-fetch) | should a branch take the podium |
| space | LIVE + this space's save-points | which version stands |

So: **main/sub-main/mine vote over *worlds*; a world votes over its *branches*.**
Same reckoning UI, same `TDoc`, same quorum law — only `rosterFor(ctx)` differs.

**Kill the duplicate.** Delete FieldEngine's juror `cellData` vote path
(`castVoteFor`, the `viewers/votes/discussion` doc, the `▲` chip that writes it).
The dock keeps only the **read-only** arena-standing chip (already added) that
mirrors the real `TDoc`. All casting goes through the one TournamentBar surface.
Result: one place a vote is ever cast, one tally that counts.

---

## Migration — staged, low-risk (behaviors already exist)

Each stage is independently shippable; nothing is rewritten, only relocated
behind the context switch.

1. **Extract `useWorldContext()` + one FOCUS chip.** Compute the four axes once;
   replace FieldEngine's FOCUS chip and SpaceToolbar's state badge with one
   component reading `ctx`. Lowest risk; makes the rest mechanical.
2. **Unify version/restore.** One `<Versions ctx>` (scrubber + modal) that reads
   whichever backing store `ctx.kind` uses; one restore action = SET AS HEAD =
   Make-this-live. Retire the 4th/3rd duplicates.
3. **Unify connect.** One `<ConnectAI ctx>` that mints the right token type by
   kind (`uc_st_` space / `uc_sc_` branch / brief for brew). Fold the ALTER
   warning into it as the `space + live` variant.
4. **Kill the duplicate vote path** (above). One casting surface.
5. **Fold `SpaceToolbar` into `WorldChrome`.** `/space/*` renders the same
   `<WorldChrome context={{kind:'space', …}}>`; delete SpaceToolbar. The two
   shells finally converge on one chrome. Fix the `engineOwner`/`isOwner`
   asymmetry here (derive `role` from one source).

## Bugs to fix in-flight

- Juror votes write a parallel tally nobody counts (stage 4).
- `engineOwner` (false in version view) vs raw `isOwner` → restore/make-live
  buttons show while the engine is locked (stage 5).
- Branches lack MAKE ICON / VERSIONS / world-key; spaces lack SET AS HEAD /
  branch browse — both close once capabilities come from `ctx`, not the shell.

## Status

Not built — this is the spec. The winner-podium backend, hot-reload, cell-info,
arena-standing chip, and SET AS HEAD (the pieces this spec assumes) are on branch
`wip/chrome-tournament-icons-jul16`. Local only; not deployed.
