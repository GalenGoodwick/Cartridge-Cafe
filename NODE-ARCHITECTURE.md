# NODE ARCHITECTURE — the law of core edits

Galen, Aug 22 2026: **further edits to core land as NODES.** Never loose file
writes. This repo enforces it through the swarm substrate:

- Declare the work as a node on a MAP (`swarm/MAP.cards.json` is the live
  example: element, owned files, dependsOn, kind→keys).
- CLAIM before edit; edit ONLY the node's owned files; shared-file touches are
  declared SEAMS owned by exactly one node.
- GREEN IS DERIVED (`node swarm/status.mjs <map>`) from tests + recorded
  evidence — never asserted.
- Parallel builders isolate in git worktrees (`swarm/tools/agent-dock.mjs`).
- World-layer twin: worldData.__nodes + the co-build dock
  (dock_node / undock-with-submitted-code / __nodeHist versions / node_revert).

A "quick edit" outside a map is the violation, regardless of size.
Mirror: memory `cafe-node-architecture-law`. Substrate: the /swarm skill.
