'use client'

// cards-tabs — THE TWO TABS (Galen's ruling): PUBLISHED (bases featured on
// top) and MY / OUR WORLDS (owned ∪ member, drafts included). A family page
// (?tab=<baseSlug>) appears as a contextual third tab while you're on it.

export interface TabCounts { published: number; bases: number; mine: number | null }

export function CardTabs({ counts, active, familyName, onPick }: {
  counts: TabCounts
  active: string
  familyName?: string | null    // set while visiting a base family page
  onPick: (slug: string) => void
}) {
  const tabs: Array<{ slug: string; label: string; count: number | null }> = [
    { slug: 'published', label: 'PUBLISHED', count: counts.published },
    ...(familyName && active !== 'published' && active !== 'mine'
      ? [{ slug: active, label: familyName.toUpperCase(), count: null }] : []),
    { slug: 'mine', label: 'MY / OUR WORLDS', count: counts.mine },
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
