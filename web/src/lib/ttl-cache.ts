// A tiny in-memory TTL cache for expensive, tolerably-stale reads (shelf feeds,
// directory rollups). On serverless this lives per warm lambda instance, so it
// collapses the PER-VISITOR cost of a heavy query to at most once per `ttlMs`
// per instance — no KV, no schema change. The tradeoff is staleness bounded by
// ttlMs: a just-published world can take up to that long to surface. Fine for a
// gallery; do NOT use it where a caller must observe its own write immediately.
type Entry<T> = { at: number; val: T }
const stores = new Map<string, Map<string, Entry<unknown>>>()

export async function cached<T>(
  ns: string,
  key: string,
  ttlMs: number,
  make: () => Promise<T>,
): Promise<T> {
  let store = stores.get(ns)
  if (!store) { store = new Map(); stores.set(ns, store) }
  const now = Date.now()
  const hit = store.get(key) as Entry<T> | undefined
  if (hit && now - hit.at < ttlMs) return hit.val
  const val = await make()
  store.set(key, { at: now, val })
  // opportunistic prune so a churn of distinct keys (e.g. many signed-in uids)
  // can't grow the map without bound
  if (store.size > 256) for (const [k, e] of store) if (now - e.at > ttlMs) store.delete(k)
  return val
}
