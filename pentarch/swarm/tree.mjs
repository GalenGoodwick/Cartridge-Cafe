// tree.mjs — the map is a TREE. Nodes nest into finer sub-nodes (a parent shader
// into its sub-shaders, a system into its parts) down to whatever granularity is
// workable. These helpers let dock/status/loop walk that tree uniformly.

import { readFileSync } from 'fs'

export function loadMap(path) { return JSON.parse(readFileSync(path, 'utf8')) }

/** Depth-first walk yielding { node, depth, parentId } for every node + descendant. */
export function flatten(nodes, depth = 0, parentId = null) {
  const out = []
  for (const n of nodes || []) {
    out.push({ node: n, depth, parentId })
    if (n.children) out.push(...flatten(n.children, depth + 1, n.id))
  }
  return out
}

export const allNodes = (map) => flatten(map.nodes).map((x) => x.node)
export const findNode = (map, id) => allNodes(map).find((n) => n.id === id)
export const dependentsOf = (map, id) => allNodes(map).filter((n) => (n.dependsOn || []).includes(id))

/** childId → parentId (null at the top), for tree-aware edge reasoning. */
export function parentMap(map) {
  const m = {}
  for (const { node, parentId } of flatten(map.nodes)) m[node.id] = parentId
  return m
}
/** a node and all its ancestors — a child inherits its parent's contract edges. */
export function ancestors(map, id) {
  const pm = parentMap(map); const out = []; let cur = id
  while (cur) { out.push(cur); cur = pm[cur] }
  return out
}
