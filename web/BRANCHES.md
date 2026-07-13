# Branches — worlds governed by Unity Chant

Every world can be branched by anyone signed in; the best branch BECOMES the world.
No deleting. No blank submissions. Authorship earns nothing but the credit line.

## What ships today (v0, live)
- **⑂ BRANCH** button (top right, every world): signed-out → auth; signed-in →
  forks the current world as `WORLD ⑂ user · v1` and the eye starts watching.
- **The Eye (client)**: all AI bridge traffic streams through the tab. Any mutating
  burst that then settles for 4s is cut as a new version (`· v2`, `· v3` …) —
  every AI edit becomes history, automatically. No blank version is ever written.
- **Version scroller** (◂ v3 ▸): ride a branch's history in place.
- **AI status lamp**: UNPLUGGED / LIVE / PROCESSING — the tab tells the truth
  about whether an agent is connected and currently editing.

## The contract to build next (v1)
1. **Branch registry**: branches move from name-convention scenes to records
   `{world, author, head, versions[], createdAt}`; the scene store stays the blob store.
2. **UC voting**: per world, an open deliberation. Browsers are dealt **5 branches
   at a time** (a cell). Each voter picks one; winners advance tiers exactly as
   Unity Chant runs it (small cells → adversarial consensus → champion).
3. **Promotion**: the champion branch is COPIED over the world's main scene,
   regardless of author. The old main is auto-branched first (`WORLD ⑂ history · vN`)
   — promotion never destroys, it re-parents. Lineage is append-only.
4. **No delete, enforced server-side**: the scene route refuses to delete any
   name containing `⑂`, and refuses saves with empty fields+hooks+visuals.
5. **The Eye (server)**: move burst-versioning into the bridge for tokened
   space agents, so headless edits version without a tab open.
6. **Browse UI**: the door grows a per-world "branches" ring — the 5-card cell
   view, vote, and a lineage tree (versions × branches).

## Why UC
The vote is the same law the Cradle runs on: small cells, real comparisons,
no global popularity contest. A world's future is whatever survives the cells.
