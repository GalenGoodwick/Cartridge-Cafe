# DESIGN — Branch Promotion (king-of-the-hill per lineage)

Status: **IMPLEMENTED** (was: spec). Live routes: api/engine/lineage/{promote,set-main,main-rule}, spaces/[slug]/flag. Originally grounded against code (file:line refs
verified). Decisions marked **[D]** are defaults, open to change.

## 1. The mechanic (Galen's words)

Every world on main is the **current champion of its own lineage**. The world
and all its branches compete in one tournament — **the parent (current main)
competes as an option, not a spectator.** When a branch wins, the two **swap**:
the winner takes the main slot, the displaced main drops to being a branch. The
**original** (the root of the lineage) is **permanently marked and can never be
deleted** — even while it sits as a branch. Everything else in the lineage is
mutable; the original is immortal.

This is king-of-the-hill: the main slot is a throne, branches are challengers,
the original is the bloodline that can't be extinguished.

## 2. Terminology

| Term | Meaning |
|---|---|
| **Lineage** | A world + all its branches. Identified by `BASE` = the name before `' ⑂ '`. |
| **Original** | The root world of a lineage (the first one). Immortal, undeletable, always tagged `isOriginal`. |
| **Main-holder** | The version currently occupying the lineage's main slot (the reigning champion). Starts as the original. |
| **Branch** | Any non-main version in the lineage (`BASE ⑂ user · vN`). |
| **Arena** | The per-lineage tournament (`tournament:world:<BASE>`) — MAIN + branches compete. |

## 2b. Ownership & editing model

**Two distinct actions — two buttons (conflated today; must be split):**

- **EDIT (owner only)** — the owner editing their own world's main/original
  *in place*. A direct write to the canonical version, no snapshot. Its own
  button, distinct function.
- **CREATE BRANCH (anyone signed in)** — snapshot the world **+ mutate it by AI
  prompt** (the brew-style brief → AI flow). Produces a branch you own. This is
  the challenger path. `mayWriteScene` keeps each editor to their own branch.

**The owner controls main; the tournament is the only override.**
- The owner may **set which version holds main at any time** (a manual
  `mainHolder` pin) and keep editing their original or their branches freely.
- The **one** force that can take the throne from the owner's choosing is a
  **tournament-crowned champion**: when the arena crowns a new champion, it
  becomes `mainHolder` over the owner's pick. The owner can still develop and
  win it back through the tournament — but can't just override a live crown.
- **`mainHolder` resolution order:** reigning crowned champion → owner's manual
  pin → original (default).

**Branch = snapshot + AI mutation.** A frozen copy of the source world plus AI
edits driven by a prompt. Anyone can make one; only the tournament promotes it.

**Owner notification (a gift, not a threat).** When ≥5 people join a tournament
on a world (the cell/arena hits quorum), the owner is notified — it means a
group cared enough to join development. Framed positively: they're free to keep
doing whatever they like with their original, a branch, or the main.

### UI impact
World tools today have a single BRANCH button (`handleBranch`). Split into:
- **✎ EDIT** — shown to the **owner** of the current world → edits main/original
  directly (owner write; for a space, its `snapshot`; for a scene, the BASE).
- **⑂ BRANCH** — shown to **everyone** → snapshot + AI-prompt mutation → your branch.
- **★ set main** (owner) — pin `mainHolder` to any owned version, unless a crown reigns.

## 2c. Save points (snapshots) — non-destructive by rule

Save points are **per owned branch** (each branch / owned world carries its own
history). Loading a save point changes what visitors see live. **Restoring is
non-destructive: it first captures the current state as a new save point, so
progress can never be lost** — you can always come back.

- **Spaces:** `POST /versions/[v] {action:apply}` now auto-saves the live state
  as a new `SpaceVersion` before applying the old one (fixed — was destructive).
- **Scenes/branches:** every `saveScene` writes a timestamped snapshot, so the
  pre-restore state persists (cap: last 30 per scene).
- The `mainHolder` pointer names a version, so promotion / owner-pin / restore
  are all "point main at save point X" — nothing is ever destroyed.

## 3. What already exists (build on, don't rebuild)

- **The per-lineage arena** — `tournament:world:<BASE>` in `TournamentBar.tsx`,
  roster `['MAIN', ...branchBases]`, full quorum tournament (`reconcile()`).
  Its comment (`TournamentBar.tsx:23-25`): *"the winner here is what promotion
  (BRANCHES v1) will enact server-side."* **We are filling exactly this gap.**
- **Lineage identity** — `BASE = name.split(' ⑂ ')[0]`, used consistently
  (`FieldEngine.tsx:207,725,4662,4668`; `CafeShell.tsx:751`; `TournamentBar.tsx:200`).
- **Branch storage** — branches are **store scenes** (`.engine-store.json` +
  `.engine-versions/`), written via `/api/engine/scene`; `mayWriteScene` already
  restricts a user to branches under their own handle (`scene/route.ts:16-31`).
- **Delete guards (DB spaces)** — `DELETE /api/spaces/[slug]` already 409s on
  childSpaces / flags / live `cell:` slot (`spaces/[slug]/route.ts:151-171`).

## 4. The core architectural decision **[D]**

**Introduce a lineage pointer; do NOT swap content.**

Today, main renders the `BASE` name *directly* — there is no "which version is
on main" indirection (map §4). Two ways to enact a swap:

- ❌ **Content-swap** — overwrite the BASE world's content with the winning
  branch's, and re-save the old main as a branch. Destructive, race-prone,
  loses provenance, fights `mayWriteScene`.
- ✅ **Pointer** — a per-lineage record names the current **main-holder**. Main
  renders whatever the pointer names, *under the BASE identity*. A swap is a
  one-field update. Nothing moves; every version is preserved; the original is
  just a name that's always present.

We take the pointer.

### The lineage record

Stored server-side, one per BASE (**[D]** slot `lineage:<BASE>` in `EngineSlot`,
same KV store as tournaments — or a small `Lineage` table if we want real FKs;
slot is faster to ship, table is cleaner long-term):

```ts
type Lineage = {
  base: string            // "TIDEPOOL"
  original: string        // the immortal root — a scene name or "space:<slug>"
  mainHolder: string      // RESOLVED throne holder (default = original)
  ownerPin?: string       // owner's manual choice of main (§2b) — overridden by a live crown
  champion?: string       // current crowned champion from the arena — overrides ownerPin
  championAt?: number     // when the crown was set (for reign/override logic)
  reignSince: number      // when the current holder took main
  history: { holder: string; at: number }[]   // audit of past swaps
}
```

`mainHolder` resolves as **`champion ?? ownerPin ?? original`**. It's either the
original or a branch scene name `BASE ⑂ user · vN`.

## 5. How main resolves the pointer

The cafe roster (`cafe-cartridge.mjs:383-393`) builds `want[BASE]` today from the
BASE scene/space. Change: for each BASE, read `lineage:<BASE>`; if `mainHolder`
≠ original, the bubble still **displays as BASE** but its `launch` points at the
`mainHolder` scene. So:

- Bubble name/identity on main = **always BASE** (stable to players).
- What you enter / what's rendered = the **current champion's** content.
- Branches (including a demoted former-main) live on the branch shelf as now.

This keeps the main constellation identity-stable while the *content* behind a
bubble can change hands via the tournament.

**Fetch cost:** one extra read per lineage. Batch it — add `mainHolder` to the
`/api/spaces/browse` payload and a parallel `lineage:*` bulk read, so the hook's
existing 6-fetch fan-out gains at most one call.

## 6. The tournament (parent competes)

Reuse the existing `tournament:world:<BASE>` arena unchanged for *voting*:
roster is `['MAIN', ...branchBases]` where `MAIN` = the current main-holder and
each branch is a challenger. The parent competing "as an option" is already
true — `MAIN` is a contestant in that arena today. King-of-the-hill coronation
already matches Galen's intent: `dethrone = !reign || w === reign || wTier >
reignTier` (`TournamentBar.tsx:256-277`) — a challenger must climb *strictly
higher* than the reigning main to take the throne.

**The missing half is enactment.** When the arena crowns a champion that is a
branch (not `MAIN`), promotion fires.

## 7. Promotion enactment — the swap (server-side, trusted)

Tournaments are **client-side last-write-wins** (`TournamentBar.tsx:20-26`) —
un-trustable on their own (a client can just write `champion: "my branch"`).
Galen's whole model is un-wireheadable consensus, so **enactment must be server-
validated**, not a client claim.

**New endpoint: `POST /api/spaces/lineage/promote` (or `/api/engine/promote`)**

1. Input: `{ base }`. No caller-supplied winner.
2. Server **re-reads** `tournament:world:<base>` from the DB and **recomputes**
   the champion with the same `reconcile()` law server-side (port the pure parts
   of TournamentBar's law into a shared `lib/tournament.ts` so client and server
   agree). Reject if quorum isn't met or the champion == current `mainHolder`.
3. Optional grounding gate (ties into DESIGN-ai-chant): only count votes from
   voters who actually entered the versions they voted on.
4. On a valid new champion `W`: update `lineage:<base>` → `mainHolder = W`,
   push `{holder: prevHolder, at: now}` to history, bump `reignSince`.
5. Invalidate the cafe roster cache so main re-resolves the pointer.
6. The displaced main-holder needs no move — it's already a branch by name;
   it simply stops being pointed at. (If the displaced holder *is* the original,
   it stays the original — see §8.)

**Trigger [D]:** cron sweep (every N min) over active arenas, OR lazy — enact on
next read when an arena shows a settled, un-enacted champion. Lazy is cheaper and
avoids a cron; cron is more "live." Default: **lazy enact inside the promote
endpoint, called by the arena UI when it detects a settled champion**, with a
cron backstop later.

## 8. The immortal original

### Marking
- **Which version is the original?** The lineage's root: the world that existed
  before any `' ⑂ '` branch. For a DB space, the space itself; for a house
  scene, the BASE scene. Set `original` in the lineage record **at lineage
  creation** — the first time a BASE is branched, stamp `original = BASE`.
- Add a persistent marker so it survives even when demoted to a branch:
  - DB spaces: **new column `PlayerSpace.isOriginal Boolean @default(false)`**,
    set true on the root.
  - Store scenes: the lineage record's `original` field is the source of truth
    (scenes have no row); the store-delete guard consults it.

### Undeletable — close the holes
- **DB space:** extend `DELETE /api/spaces/[slug]` (`route.ts:120-178`) — 409 if
  `space.isOriginal` (add alongside the existing childSpaces/flags/cell guards).
- **Store scene:** the real hole — `DELETE /api/engine/scene` has **no auth and
  no guard** (`scene/route.ts:104-115`). Add: (a) a `mayWriteScene`-style
  authority check (parity with POST), and (b) refuse to delete any scene that is
  some lineage's `original`. This also fixes an existing security gap where any
  caller can delete any scene/canonical world.
- **UI:** hide/disable delete on an original (`SpaceToolbar.tsx:243`,
  `FieldEngine.tsx:864` handleDeleteScene) and show an "★ ORIGINAL — immortal"
  badge.

### Original as a branch
When the original is dethroned it becomes an ordinary branch on the shelf **but
keeps `isOriginal`**. It can still win the throne back later. It can never be
deleted. It's always tagged in the branch list.

## 9. UI changes

- **Main bubble:** unchanged identity (BASE), but optionally a tiny "held by
  <author>" tag when `mainHolder ≠ original` (a branch currently reigns).
- **Branch shelf / CELL / arena:** mark the **original** (★) and the current
  **main-holder** (crown) distinctly. Show "challenging for main" state.
- **Delete affordances:** disabled + explained on the original.
- **Promotion moment:** a toast / crown animation when a swap enacts ("`<branch>`
  took `<BASE>`'s throne").

## 10. Data-model changes (summary)

| Change | Where |
|---|---|
| `Lineage` record (`original`, `mainHolder`, `reignSince`, `history`) | `EngineSlot` slot `lineage:<BASE>` **[D]** (or new table) |
| `PlayerSpace.isOriginal Boolean` | `prisma/schema.prisma` PlayerSpace |
| Shared tournament law | new `lib/tournament.ts` (pure `reconcile`/`cellWinner`, imported by client + server) |
| Promote endpoint | `POST /api/engine/promote` |
| Roster resolves pointer | `cafe-cartridge.mjs` roster + `/api/spaces/browse` payload |
| Guard scene delete | `scene/route.ts` DELETE (auth + original guard) |
| Guard space delete | `spaces/[slug]/route.ts` DELETE (+ isOriginal 409) |

## 11. Edge cases & decisions

- **Scenes vs spaces:** a lineage's main-holder can be a DB space (the brewed
  original) while challengers are store scenes, or vice-versa. The pointer names
  a *launch target* (`space:<slug>` or a scene name) uniformly — roster already
  handles both launch forms.
- **Ties / no quorum:** no swap. Throne holds. (Existing arena already requires
  quorum 3 and strict-higher-tier to dethrone.)
- **Decay:** `reached` already decays ~3-day half-life — a stale champion
  naturally becomes beatable. Keep it.
- **Forks vs branches:** a *fork* (`/api/spaces/[slug]/fork`) makes a NEW
  independent lineage (own original), not a challenger. Only same-BASE `' ⑂ '`
  branches contest a throne. **[D]**
- **Who may branch/challenge:** unchanged — anyone signed in, `mayWriteScene`
  keeps them to their own handle. The tournament, not edit access, decides.
- **Original deletion of the *space* vs the lineage:** you can never delete the
  original; you *can* delete non-original branches (owner-only, and not if
  mid-vote — reuse the `cell:` guard).

## 12. Known adjacent bugs to fix alongside

- **Universe write validator mismatch:** hook writes `cafe:universe` with
  `data.v: 2` (`cafe-cartridge.mjs:532`) but `isPublicUniverseWrite` only accepts
  `v === 1` (`save/route.ts:113-125`) → anonymous shared-layout writes 401 in
  prod. Bump the validator to accept v2 (touches the same slot infra).
- **Unauthenticated scene delete** (`scene/route.ts` DELETE) — closing it is
  required for original-protection anyway.

## 13. Build phases

- **Phase 1 — Immortal original (safe, standalone).** Stamp `isOriginal` on
  lineage roots; add the lineage record with `original`; guard both delete paths;
  UI badge + disabled delete. No tournament coupling. Ships value immediately
  (protects worlds) and lays the lineage record everything else needs.
- **Phase 2 — The pointer.** Roster resolves `lineage:<BASE>.mainHolder`;
  `browse` returns it; main renders the held version under BASE. Default holder =
  original, so behaviour is unchanged until a promotion happens.
- **Phase 3 — Shared law + trusted promote endpoint.** Extract `lib/tournament.ts`;
  `POST /api/engine/promote` recomputes the champion server-side and updates the
  pointer. Wire the arena UI to call it on a settled champion; cron backstop.
- **Phase 3b — Ownership actions (§2b).** Split world tools into **✎ EDIT** (owner,
  in-place) vs **⑂ BRANCH** (anyone, snapshot + AI mutation); add owner **★ set
  main** pin (overridden by a live crown); owner **notification** when a
  tournament hits quorum (≥5) on their world.
- **Phase 4 — Polish.** Swap toast/animation, held-by tags, original/holder marks
  in shelf & arena, optional play-grounded vote gate (shared with AI-chant).

## 13b. Space-lineage identity gap (found during Phase 1 — MUST fix)

`FieldEngine` only receives `spaceSlug`, not the space's display **name**, so a
space-world's branches get based on `space:<slug>` (cafe path) or the raw slug
(space-page path) — but the cafe roster and the arena key a space by its
**NAME** (`(name||slug).toUpperCase()`). Result: for player-brewed (space)
worlds, the branch base ≠ the lineage/arena/roster key, so lineage records,
`tournament:world:<BASE>`, and the delete guards won't line up.

**Fix (required for promotion on space worlds):** make the branch BASE the
space's **uppercased name** everywhere — thread the space name into FieldEngine
(a `spaceName` prop, or `handleBranch` fetches it from `/api/spaces/<slug>`), so
`handleBranch` produces `NAME ⑂ user · vN` and the lineage is stamped with
`original = "space:<slug>"`, `base = NAME`. Until then Phase 1's server guards
protect **scene** lineages correctly but a space original may not be found by
name.

## 14. Open questions

- Lineage record: **KV slot vs real `Lineage` table**? (slot ships faster; table
  gives FKs + integrity for the immortal-original invariant.)
- Promotion trigger: **lazy-on-read vs cron**?
- Should a demoted former-main keep its accrued `reached` standing, or reset?
- Vote grounding: require voters to have entered both versions? (ties to
  DESIGN-ai-chant's "must play to vote").
