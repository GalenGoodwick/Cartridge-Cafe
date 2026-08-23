'use client'

// the catalog's LIVE TICKER (owned by cards-grid) — the same behavior as
// main's slogan line: resting on the shared SLOGAN, a new world (or a rework)
// glows in over it for a few seconds, then fades back. One quiet line that
// proves the cafe is alive, now on the catalog too.

import { useEffect, useState } from 'react'
import { SLOGAN } from '@/lib/slogan'

export function useCatalogTicker(): { text: string; live: boolean } {
  const [ticker, setTicker] = useState({ text: SLOGAN, live: false })
  useEffect(() => {
    const seen = new Map<string, number>()
    let primed = false
    let revert: ReturnType<typeof setTimeout> | null = null
    let stop = false
    const show = (text: string) => {
      if (stop) return
      setTicker({ text, live: true })
      if (revert) clearTimeout(revert)
      revert = setTimeout(() => { if (!stop) setTicker({ text: SLOGAN, live: false }) }, 7000)
    }
    const poll = async () => {
      try {
        const d = await fetch('/api/spaces/browse', { cache: 'no-store' }).then(r => r.json()) as
          { spaces?: { slug: string; name: string; updatedAt?: string | number }[] }
        for (const s of d.spaces ?? []) {
          const at = new Date(s.updatedAt ?? 0).getTime()
          const prev = seen.get(s.slug)
          if (primed && prev === undefined) show(`⚙ ${(s.name || s.slug).toUpperCase()} was just born`)
          else if (primed && prev !== undefined && at > prev) show(`✦ ${(s.name || s.slug).toUpperCase()} was just reworked`)
          seen.set(s.slug, at)
        }
        primed = true
      } catch { /* quiet line stays quiet */ }
    }
    poll()
    const t = setInterval(poll, 20_000)
    return () => { stop = true; clearInterval(t); if (revert) clearTimeout(revert) }
  }, [])
  return ticker
}
