// PER-IP SLIDING WINDOW (scalability audit, Sep 6): the first line against
// write-amplification on unauthenticated endpoints that do real DB/upstream
// work per request (/api/t analytics INSERT, /api/brain's 3 upstream fetches).
// Per-lambda memory — a distributed burst multiplies the budget by instance
// count, which is exactly the acceptable posture for a FIRST line (Vercel
// Firewall rate rules are the durable second line, set in the dashboard).

const buckets: Map<string, { n: number; at: number }> =
  ((globalThis as unknown as { __ccIpThrottle?: Map<string, { n: number; at: number }> }).__ccIpThrottle ??= new Map())

/** true = over budget (drop the request). windowMs defaults to one minute. */
export function ipThrottled(req: { headers: { get(k: string): string | null } }, key: string, perMinute: number, windowMs = 60_000): boolean {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const k = key + '|' + ip
  const now = Date.now()
  const b = buckets.get(k)
  if (!b || now - b.at > windowMs) {
    buckets.set(k, { n: 1, at: now })
    if (buckets.size > 10_000) buckets.clear()   // memory floor — resets budgets, never grows
    return false
  }
  b.n++
  return b.n > perMinute
}
