// THE TAB-SIDE PULSE MEMO — every effect that wants "did anything change?"
// shares ONE in-flight request per ~2.5s window instead of running its own
// poll family (the scalability ladder: rev + build + world-chat so far).
export type Pulse = {
  rev: number
  build: { active: boolean; status: string | null; live: boolean }
  chat?: Array<{ at: number; ai?: boolean; who?: string }>
}

let chatKey: string | null = null
/** the world-chat badge registers its slot key so EVERY pulse carries chat */
export function setPulseChatKey(k: string | null): void { chatKey = k; last = null }

let last: { k: string; at: number; p: Promise<Pulse | null> } | null = null

export function fetchPulse(spaceId: string): Promise<Pulse | null> {
  const k = spaceId + '|' + (chatKey ?? '')
  const now = Date.now()
  if (last && last.k === k && now - last.at < 2500) return last.p
  const url = `/api/pulse?space=${encodeURIComponent(spaceId)}` + (chatKey ? `&chat=${encodeURIComponent(chatKey)}` : '')
  const p = fetch(url, { cache: 'no-store' })
    .then(r => r.ok ? r.json() as Promise<Pulse> : null)
    .catch(() => null)
  last = { k, at: now, p }
  return p
}
