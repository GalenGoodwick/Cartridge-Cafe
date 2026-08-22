'use client'

// cards-presence — the catalog is INHABITED (MAP.cards: cards-presence).
// One page heartbeat (you are in the cafe when you browse the catalog) + one
// rollup poll shared by every card — never per-card fetches. Per card:
// `here` = live head-count inside that world · `devLive` = its maker (human
// dev:<slug> or AI ai:<slug>) is building RIGHT NOW.

import { useEffect, useState } from 'react'
import { usePresenceBeat } from '@/lib/usePresenceBeat'

export interface CardPresence { here: number; devLive: boolean }

export function useCatalogPresence(): Map<string, CardPresence> {
  // browsing the catalog IS being in the cafe — same beat the hub pages send
  usePresenceBeat(() => (typeof document !== 'undefined' && document.visibilityState === 'hidden') ? null : 'main/cards',
    { intervalMs: 12_000, byeOnCleanup: true })

  const [bySlug, setBySlug] = useState<Map<string, CardPresence>>(new Map())
  useEffect(() => {
    let stop = false
    const poll = async () => {
      try {
        const d = await fetch('/api/presence', { cache: 'no-store' }).then(r => r.json()) as
          { counts?: Record<string, number>; devLive?: string[] }
        if (stop) return
        const m = new Map<string, CardPresence>()
        // world head-counts: any scene path ending in `space:<slug>` rolls onto that card
        for (const [scene, n] of Object.entries(d.counts ?? {})) {
          const i = scene.lastIndexOf('space:')
          if (i < 0) continue
          const slug = scene.slice(i + 6)
          if (!slug) continue
          const cur = m.get(slug) ?? { here: 0, devLive: false }
          cur.here += n
          m.set(slug, cur)
        }
        for (const slug of d.devLive ?? []) {
          const cur = m.get(slug) ?? { here: 0, devLive: false }
          cur.devLive = true
          m.set(slug, cur)
        }
        setBySlug(m)
      } catch { /* the catalog reads fine uninhabited */ }
    }
    poll()
    const t = setInterval(poll, 10_000)
    return () => { stop = true; clearInterval(t) }
  }, [])
  return bySlug
}
