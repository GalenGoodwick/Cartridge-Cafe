'use client'

// cards-tabs — one tab per BASE + OPEN GROUND last (MAP.cards: cards-tabs).
// The active tab lives in the URL (?tab=) so every catalog page is shareable.

export interface TabInfo { slug: string; name: string; count: number }

export function CardTabs({ tabs, openGround, active, onPick }: {
  tabs: TabInfo[]
  openGround: number
  active: string
  onPick: (slug: string) => void
}) {
  const all: TabInfo[] = [...tabs, { slug: 'open-ground', name: 'OPEN GROUND', count: openGround }]
  return (
    <div className="flex items-end gap-1 overflow-x-auto pb-0 -mb-px" role="tablist" aria-label="base archetypes">
      {all.map(t => {
        const on = t.slug === active
        return (
          <button key={t.slug} role="tab" aria-selected={on} onClick={() => onPick(t.slug)}
            className={`shrink-0 font-mono text-[12px] tracking-[0.18em] px-3.5 py-2 rounded-t-lg border border-b-0 transition-colors
              ${on
                ? 'bg-[#120c08] border-[#b97a2a]/50 text-amber-200'
                : 'bg-black/40 border-white/10 text-white/45 hover:text-amber-200/80 hover:border-[#b97a2a]/30'}`}>
            {t.name.toUpperCase()}
            <span className={`ml-2 ${on ? 'text-amber-200/50' : 'text-white/25'}`}>{t.count}</span>
          </button>
        )
      })}
    </div>
  )
}
