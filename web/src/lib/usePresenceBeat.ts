'use client'
// usePresenceBeat — THE /api/presence heartbeat (audit #10). This loop was
// copy-pasted into CafeShell and SpaceStage with different key logic and
// slightly different gates; the /space copy only exists because the hub copy
// wasn't shared ("a world's own bubble always read 0" — the class of bug this
// file ends). One person = one cc-pid = one place; the beat reports a location
// PATH (presence nesting), sendBeacon says goodbye on the way out.
import { useEffect, useRef } from 'react'

/** The per-browser presence id (single-active-tab arbitration means one id =
 *  one person = one place). */
export function presencePid(): string {
  try {
    const pid = localStorage.getItem('cc-pid') || Math.random().toString(36).slice(2, 12)
    localStorage.setItem('cc-pid', pid)
    return pid
  } catch {
    return Math.random().toString(36).slice(2, 12)
  }
}

/**
 * Heartbeat /api/presence with the key `getKey()` returns AT BEAT TIME
 * (null/'' = skip this beat — a blocked tab, a version snapshot). Re-arms
 * when `deps` change (an immediate re-beat so counts update without waiting
 * out the interval). `byeOnCleanup` also says goodbye when the component
 * unmounts, not just on pagehide.
 */
export function usePresenceBeat(
  getKey: () => string | null | undefined,
  opts: { intervalMs?: number; byeOnCleanup?: boolean; enabled?: boolean; deps?: unknown[] } = {},
): void {
  const getKeyRef = useRef(getKey)
  getKeyRef.current = getKey
  const { intervalMs = 12_000, byeOnCleanup = false, enabled = true } = opts

  useEffect(() => {
    // enabled:false arms NOTHING — no interval, no pagehide, no unmount bye.
    // (A version-snapshot view must not beacon `leave` for the shared pid and
    // transiently erase the person's real presence — adversarial review.)
    if (!enabled) return
    const pid = presencePid()
    const beat = () => {
      const key = getKeyRef.current()
      if (!key) return
      fetch('/api/presence', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene: key, id: pid }),
      }).catch(() => {})
    }
    const bye = () => {
      try { navigator.sendBeacon('/api/presence', JSON.stringify({ id: pid, leave: true })) } catch { /* gone anyway */ }
    }
    beat()
    const iv = setInterval(beat, intervalMs)
    window.addEventListener('pagehide', bye)
    return () => {
      clearInterval(iv)
      window.removeEventListener('pagehide', bye)
      if (byeOnCleanup) bye()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, opts.deps ?? [])
}
