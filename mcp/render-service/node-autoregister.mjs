// node-autoregister (mjs mirror of web/src/app/engine/node-autoregister.ts).
// Every hook auto-becomes a node with a STABLE order on first sight (== insertion
// order, legacy-neutral) + best-effort owned range inferred from literal u[N]/
// gpuUniforms[N] writes. Re-push never changes order → the reorder clobber is
// impossible by default, no manual register_node. Keep in sync with the .ts.

export function inferOwns(src) {
  if (!src) return []
  const idx = new Set()
  const re = /(?:\bu|gpuUniforms)\s*\[\s*(\d+)\s*\]\s*=(?!=)/g
  let m
  while ((m = re.exec(src))) { const n = +m[1]; if (n >= 0 && n < 256) idx.add(n) }
  const sorted = [...idx].sort((a, b) => a - b)
  const ranges = []
  for (const n of sorted) {
    const last = ranges[ranges.length - 1]
    if (last && n === last[1] + 1) last[1] = n
    else ranges.push([n, n])
  }
  return ranges
}

export function autoRegisterHook(worldData, hookId, code) {
  if (!worldData || !hookId) return null
  const nodes = (worldData.__nodes && typeof worldData.__nodes === 'object'
    ? worldData.__nodes
    : (worldData.__nodes = {}))
  const prev = nodes[hookId]
  if (!prev) {
    worldData.__nodeSeq = (Number(worldData.__nodeSeq) || 0) + 10
    nodes[hookId] = { id: hookId, order: worldData.__nodeSeq, owns: { uni: inferOwns(code) }, auto: true, rev: 1 }
  } else if (prev.auto) {
    prev.owns = { uni: inferOwns(code) }
    prev.rev = (Number(prev.rev) || 0) + 1
  }
  return nodes[hookId]
}
