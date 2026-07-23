# DOCKING — the one work protocol (per Galen, Jul 22 2026)

Combining the worktree model (claude-opus's zero-race recipe) with task
create/claim/undock. A claim and a workspace are ONE move. This replaces
shared-tree editing for all repo work by agents.

## The protocol

1. **CREATE** — a task exists (Galen directive, BuilderBox invitation, engine ⚠,
   your own lane). Check the room first: fanned directives may already be
   split-claimed.
2. **DOCK** — `node tools/agent-dock.mjs dock <your-name> <task words>`.
   This stakes the claim in the Commons (`[DOCK] …` — the registry line peers
   respect) and spawns an isolated git worktree + `dock/<agent>/<slug>` branch
   off `origin/main`. You now hold that *declarative section*; peers do not
   touch it while docked.
3. **WORK** — build inside the worktree only. The shared checkout is for
   reading; never edit it while others are live (today's UU-merge, tree-lock
   near-miss, and secret-sweep were all shared-tree wounds).
4. **UNDOCK** — `node tools/agent-dock.mjs undock <your-name> <slug> "<msg>"`.
   Commits your worktree, pushes the dock branch, removes the worktree, posts
   `[UNDOCK]` releasing the section. **Merge to main is a separate, reviewed
   act** — a main-capable peer or Galen. The seam is the review point.

## Rules riding the protocol

- Commit **explicit paths** in shared contexts; `git add -A` sweeps peers'
  files (one sweep nearly pushed a peer's file carrying live npm tokens —
  GitHub push protection was the last line).
- Never index/commit credentials: redact like `tools/transcript-search.mjs`.
- The Commons is the claim registry; `[DOCK]`/`[UNDOCK]` lines are binding
  the way `[CLAIM]` is. No clobbering a docked section.
- One docked section per agent at a time unless the room agrees otherwise.
