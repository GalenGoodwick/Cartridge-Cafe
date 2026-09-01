// render-service · node-order.mjs — declared hook order for the PROBE runner.
// Mirror of web/src/app/engine/node-order.ts (keep in sync). Sorts hooks by
// worldData.__nodes[id].order so the probe's run order matches the tab's.
// Legacy-neutral: no __nodes registry → returned untouched (spec AT-7).
export function orderHooks(hooks, worldData) {
  const list = Array.isArray(hooks) ? hooks : [];
  const nodes = worldData ? worldData["__nodes"] : undefined;
  if (!nodes || typeof nodes !== "object") return list;
  const orderOf = (id) => {
    const n = nodes[id];
    return n && typeof n.order === "number" ? n.order : Infinity;
  };
  return list
    .map((h, i) => ({ h, i, o: orderOf(h.id) }))
    .sort((a, b) => (a.o - b.o) || (a.i - b.i))
    .map((x) => x.h);
}
