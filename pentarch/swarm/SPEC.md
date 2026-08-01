# PENTARCH — swarm SPEC (the one truth every node imports)

The authoritative contract is **`../CONTRACT.md`** (interface: the hook-string
assembly, PRELUDE helpers, wd namespaces, entity-code registry, test harness,
chrome law) and **`../STRUCTURE.md`** (design: scene machine, mechanics, module
layout, Istrolid UI reference). Read both before touching code. Do not diverge from
them; if a contract must change, that is a heal-wave, not a silent edit.

## File ownership (the clobber law — edit ONLY your node's files)
```
penta-core.mjs, penta-holes.mjs   geometry    (DONE — verify, never rewrite)
parts.mjs                         parts
shader.mjs                        shader       (visual_pentarch + Istrolid chrome primitives)
build.mjs                         build        (assembleHook / assembleVisual / dist / --push gate)
test/harness.mjs                  harness
mod-menu.mjs                      menu
mod-designer.mjs                  designer
mod-finder.mjs                    finder
mod-lobby.mjs                     lobby
mod-battle.mjs                    battle
mod-debrief.mjs                   debrief
deploy.mjs                        integrate    (assemble full game + probe every scene)
```
A change you need in a neighbour's file is a **heal**, coordinated over the swarm —
never an edit-and-copy.

## Green here (DERIVED, never declared)
- **lib nodes** (parts/build/harness/menu/designer/finder/lobby/battle/debrief):
  key `unit-tested`. Write the node's test under `test/`, make `node --test
  pentarch/test/<node>.test.mjs` pass, then attest over the bridge:
  `swarm_release {node, evidence:{"unit-tested":true}}`.
- **geometry**: already proven — `node --test pentarch/penta-core.test.mjs` (38).
- **shader** + **integrate**: key `render-verified` — the EYE. Assemble via
  `build.mjs`, push the hook+visual to the **pentarch-stage** dev world, set the
  scene, and `swarm_probe {node}`. The server renders it; the node greens ONLY if it
  actually renders (and reacts). You cannot fake this — `swarm_release` refuses
  `render-verified`.

## Build order (dependency waves — build only on GREEN foundations)
1. contracts, geometry
2. parts, shader
3. build → harness
4. menu, designer, finder, lobby, battle, debrief (parallel)
5. integrate (assemble + probe every scene on pentarch-stage)

## Coordination (this dogfood)
The work-graph + claims live on the platform via the `swarm_*` bridge verbs against
the **pentarch-stage** world token. Loop: `swarm_jump` → `swarm_dock {node}` →
build only your files in `cafe-rec-wt/pentarch/` → verify (`node --test` or
`swarm_probe`) → `swarm_release {node, evidence}`. Edit disjoint files; the server's
atomic claims are the isolation for this run.
