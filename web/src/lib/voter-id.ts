// The cafe's ONE anonymous voting identity (factored out of api/voter-id so the
// ♥ upvote route and the tournament spectator route share the SAME handle — one
// IP, one voice, everywhere). Stable, anonymous: a salted one-way hash of the
// caller's IP. The raw IP never leaves the server; only the short `v-…` rides
// any doc. People sharing a NAT share a seat — the cost of no sign-in.

const fnv = (s: string): number => {
  let h = 2166136261
  for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0 }
  return h >>> 0
}

/** ip → the `v-…` handle. Byte-identical to what /api/voter-id has always
 *  served (same salt env, same fnv, same base36) — existing voter docs keep
 *  recognizing their voters. */
export function voterIdFromIp(ip: string): string {
  const salt = process.env.VOTER_ID_SALT || 'cc-voter-v1'
  return 'v-' + fnv(salt + ':' + ip).toString(36)
}

/** Pull the caller's IP the way the cafe always has (proxy header first). */
export function ipOf(headers: { get(name: string): string | null }): string {
  return (headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || headers.get('x-real-ip') || 'local'
}
