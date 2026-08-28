'use client'

// cards-tabs — THE TABS: LIVE EDITING · PUBLISHED (finished worlds only —
// an OPEN world is an indefinite expansion, so it lives on LIVE, never
// PUBLISHED) · PREMIUM · MY WORLDS. (FORKABLE tab retired, Galen Aug 27 —
// bases surface in the /create FORMAT picker, not a browse tab.) A base's
// family page (?tab=<baseSlug>) rides as a contextual tab while you're on it.

export interface TabCounts { published: number; live?: number; premium?: number; forkable?: number; mine: number | null }

export function CardTabs({ counts, active, familyName, onPick, engine }: {
  counts: TabCounts
  active: string
  familyName?: string | null
  onPick: (slug: string) => void
  /** THE MODE SPLIT (Galen, Aug 28): two catalogs, not one filtered.
   *  PLAY  → GAMES · PREMIUM (a console: finished products only)
   *  ENGINE → LIVE EDITING · SOURCES · PREMIUM · MY WORLDS (the workshop) */
  engine?: boolean
}) {
  const fixed = ['live', 'published', 'premium', 'mine']
  const tabs: Array<{ slug: string; label: string; count: number | null }> = engine
    ? [
      // THE WORKSHOP — building first
      { slug: 'live', label: '◉ LIVE EDITING', count: counts.live ?? 0 },
      { slug: 'published', label: 'SOURCES', count: counts.published },   // finished worlds as fork-sources
      ...(counts.premium ? [{ slug: 'premium', label: '✦ PREMIUM', count: counts.premium }] : []),
      ...(familyName && !fixed.includes(active)
        ? [{ slug: active, label: familyName.toUpperCase(), count: null }] : []),
      { slug: 'mine', label: 'MY WORLDS', count: counts.mine },
    ]
    : [
      // THE CONSOLE — finished games only; zero creation surface
      { slug: 'published', label: '▶ GAMES', count: counts.published },
      ...(counts.premium ? [{ slug: 'premium', label: '✦ PREMIUM', count: counts.premium }] : []),
    ]
  return (
    <div className="flex items-end gap-1 overflow-x-auto pb-0 -mb-px" role="tablist" aria-label="the catalog">
      {tabs.map(t => {
        const on = t.slug === active
        return (
          <button key={t.slug} role="tab" aria-selected={on} onClick={() => onPick(t.slug)}
            className={`shrink-0 font-mono text-[12px] tracking-[0.18em] px-3.5 py-2 rounded-t-lg border border-b-0 transition-colors
              ${on
                ? 'bg-[#120c08] border-[#b97a2a]/50 text-amber-200'
                : 'bg-black/40 border-white/10 text-white/45 hover:text-amber-200/80 hover:border-[#b97a2a]/30'}`}>
            {t.label}
            {t.count !== null && <span className={`ml-2 ${on ? 'text-amber-200/50' : 'text-white/25'}`}>{t.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
