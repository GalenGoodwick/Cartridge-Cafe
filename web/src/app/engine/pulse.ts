// THE TAB-SIDE PULSE MEMO — every effect that wants "did anything change?"
// shares ONE in-flight request per ~2.5s window instead of running its own
// poll family (the scalability ladder's 7×-cut, first slice: rev + build).
export type Pulse = { rev: number; build: { active: boolean; status: string | null; live: boolean } }

let last: { spaceId: string; at: number; p: Promise<Pulse | null> } | null = null

export function fetchPulse(spaceId: string): Promise<Pulse | null> {
  const now = Date.now()
  if (last && last.spaceId === spaceId && now - last.at < 2500) return last.p
  const p = fetch(`/api/pulse?space=${encodeURIComponent(spaceId)}`, { cache: 'no-store' })
    .then(r => r.ok ? r.json() as Promise<Pulse> : null)
    .catch(() => null)
  last = { spaceId, at: now, p }
  return p
}
