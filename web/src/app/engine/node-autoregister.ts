// node-autoregister — rung 3, the keystone that makes node-design the DEFAULT.
//
// Every hook IS a node. The FIRST time a hookId is seen we mint a __nodes entry with
// a STABLE order (from an insertion counter, so run order == insertion order — exactly
// today's behavior, legacy-neutral) and a best-effort owned uniform range inferred from
// the code's literal u[N] / gpuUniforms[N] writes. Re-pushing an existing auto-node does
// NOT change its order — that is the whole point: once a hook is a node, a re-push can no
// longer shove it to the END of the run array (the veilfire weapons clobber, ×3). No
// manual register_node is needed — the substrate is universal by default.
//
// A hook that was explicitly register_node'd (auto:false) is left untouched: explicit wins.
// This is a mirror of the .mjs used by the render-service + proofs — keep them in sync.

/** Infer an owned uniform range from a hook's source: the literal indices it assigns. */
export function inferOwns(src: string): number[][] {
  if (!src) return []
  const idx = new Set<number>()
  const re = /(?:\bu|gpuUniforms)\s*\[\s*(\d+)\s*\]\s*=(?!=)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) { const n = +m[1]; if (n >= 0 && n < 256) idx.add(n) }
  const sorted = [...idx].sort((a, b) => a - b)
  const ranges: number[][] = []
  for (const n of sorted) {
    const last = ranges[ranges.length - 1]
    if (last && n === last[1] + 1) last[1] = n
    else ranges.push([n, n])
  }
  return ranges
}

/**
 * Auto-register a hook as a node on worldData.__nodes. Idempotent on order:
 * first sight mints a stable order slot; a re-push only refreshes inferred owns.
 * Mutates worldData in place (adds __nodes / __nodeSeq). Returns the node record.
 */
export function autoRegisterHook(
  worldData: Record<string, unknown>,
  hookId: string,
  code: string,
): Record<string, unknown> | null {
  if (!worldData || !hookId) return null
  const nodes = (worldData.__nodes && typeof worldData.__nodes === 'object'
    ? worldData.__nodes
    : (worldData.__nodes = {})) as Record<string, Record<string, unknown>>
  const prev = nodes[hookId]
  if (!prev) {
    worldData.__nodeSeq = (Number(worldData.__nodeSeq) || 0) + 10
    nodes[hookId] = { id: hookId, order: worldData.__nodeSeq, owns: { uni: inferOwns(code) }, auto: true, rev: 1 }
  } else if (prev.auto) {
    // re-push of an auto-node: refresh owns (code may have changed), KEEP order fixed.
    prev.owns = { uni: inferOwns(code) }
    prev.rev = (Number(prev.rev) || 0) + 1
  }
  return nodes[hookId]
}
