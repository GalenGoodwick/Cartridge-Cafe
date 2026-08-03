// node-runtime · rung 1 — declared execution order.
//
// Hooks run in the order their node DECLARES (worldData.__nodes[id].order), not
// the accident of push order. This is the single change that makes the veilfire
// clobber impossible: re-pushing a hook can no longer move it in the run order.
//
// Legacy-neutral (spec AT-7): a world with no __nodes registry is returned
// untouched — byte-identical to today. The sort is a VIEW; it never mutates or
// re-persists the stored hook order. Applied at every runner's entry
// (FieldEngine.installHooks for both client paths; render-core.mjs for the probe).

export type OrderableHook = { id: string };

type NodeRec = { order?: number };

export function orderHooks<T extends OrderableHook>(
  hooks: T[] | undefined,
  worldData: Record<string, unknown> | undefined,
): T[] {
  const list = hooks || [];
  const nodes = worldData ? (worldData['__nodes'] as Record<string, NodeRec> | undefined) : undefined;
  if (!nodes || typeof nodes !== 'object') return list; // no registry → preserve today's order

  const orderOf = (id: string): number => {
    const n = nodes[id];
    return n && typeof n.order === 'number' ? n.order : Number.POSITIVE_INFINITY; // unregistered trail, stably
  };

  // Stable sort by declared order; ties (and unregistered hooks) hold their
  // original position via the decorated index. Never throws — a malformed
  // registry entry just falls to +Infinity.
  return list
    .map((h, i) => ({ h, i, o: orderOf(h.id) }))
    .sort((a, b) => (a.o - b.o) || (a.i - b.i))
    .map((x) => x.h);
}
