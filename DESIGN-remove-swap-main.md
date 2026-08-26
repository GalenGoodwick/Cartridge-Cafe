# Remove the swap-main throne (tournament pulled from worlds)

**Branch:** `opus/remove-swap-main` (worktree, off `origin/main` @ ede61d9) — UNPUSHED.
**Author:** Opus · **Status:** PLAN ONLY — gated on (1) Galen scope-confirm, (2) @the-chair ack (this collides head-on with the `branchfork` branch→fork / reckoning-main-only rework).

## Why
The tournament that crowned a branch is being removed from worlds. Its one downstream effect was **king-of-the-hill promotion**: the champion branch was crowned `mainHolder` and `/` served *it* under the base name instead of the immortal original. With no tournament, nothing legitimately crowns a holder — the swap-main throne is dead code that can only be driven by the manual `♛ SET MAIN` button. Removing it means **main always serves the original founder version.**

## The surface (what "swap main" is — 7 files)
| File | What to remove | Keep |
|---|---|---|
| `web/src/app/api/engine/lineage.ts` | `mainHolder`, `setMainHolder()`, `reignSince`, `history` (the throne) | `base`, `original`, `getLineage`, `ensureLineage`, `isOriginal` — these serve branch creation + delete-guards, NOT swap-main |
| `web/src/app/api/engine/lineage/set-main/route.ts` | **delete the whole route** (the swap-main API) | — |
| `web/src/app/CafeShell.tsx` (~L950-957) | the door→`mainHolder` resolution; `target = name` always | door launch of original |
| `web/src/app/api/engine/scene-icons/route.ts` (4) | `mainHolder` icon resolution → serve original | base/original icon |
| `web/src/app/api/spaces/icons/heal/route.ts` (2) | `mainHolder` icon-heal resolution → original | — |
| `web/src/app/engine/FieldEngine.tsx` (8) | the `♛ SET MAIN` button (~L7059-7072), `worldLineage.mainHolder` display (~L6400), the snag-toast (~L2128-2134), `worldLineage` state if it only carried the throne | branch/fork UI the chair owns |
| `web/src/lib/worldContext.ts` (1) | `mainHolder` from the type | — |

## End state
- `/` and every door serve the **original**; a branch/fork launches only as itself.
- No API or button can promote a branch into main.
- Lineage still tracks `original` (immortal root, delete-guarded) and branch membership.

## NOT in scope (leave for the chair / already "removed from worlds")
- `TournamentBar.tsx`, the `⚔ reckoning` UI, `mainRoster`/`champion` wiring in CafeShell — that's the **tournament itself**, the chair's branchfork domain. Only remove if Galen picks "Throne + tournament".

## Collision risk — READ before landing
`branchfork` reworks branch→fork with "reckoning main-only." If that design **keeps or transforms `mainHolder`** (e.g. forks still elect a served version), this removal undoes it. **Do not land until @the-chair confirms `mainHolder` is truly dead in the fork model.** No `mainHolder` reader/writer outside these 7 files (verified by grep).

## Verify before land
`tsc --noEmit` + `next build` green; grep shows zero remaining `mainHolder`/`setMainHolder`/`set-main` readers; manual: enter a world that had a non-original holder → it now serves the original.
