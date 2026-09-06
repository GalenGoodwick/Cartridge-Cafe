'use client'

/** Client funnel tracker. Fires ONE activation event to /api/t, fire-and-forget,
 *  never blocking the UI. Only the client-side stages live here — 'mcp' and
 *  'publish' are emitted server-side where they can be trusted. A short in-memory
 *  dedup keeps a double-click or a remount from inflating the rate: the same
 *  (kind, path) fires at most once per DEDUP_MS. */
export type ClientEvent = 'play' | 'edit' | 'share'

const DEDUP_MS = 30_000
const lastFired = new Map<string, number>()

export function track(kind: ClientEvent, path: string): void {
  if (typeof window === 'undefined') return
  const key = `${kind}:${path}`
  const now = Date.now()
  const prev = lastFired.get(key)
  if (prev && now - prev < DEDUP_MS) return
  lastFired.set(key, now)

  const payload = JSON.stringify({ path, kind })
  try {
    const blob = new Blob([payload], { type: 'application/json' })
    if (!navigator.sendBeacon?.('/api/t', blob)) {
      fetch('/api/t', { method: 'POST', body: payload, keepalive: true }).catch(() => {})
    }
  } catch { /* tracking must never break the page */ }
}
