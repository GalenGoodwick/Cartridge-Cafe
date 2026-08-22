'use client'

// /cards — the CARD MAIN, growing in parallel (MAP.cards: cards-grid owns this
// page; DESIGN-card-main.md). Flag-free while parallel: reachable only by URL;
// the cutover node (Galen-gated) is what makes it `/`. Icons come from the
// BATCH icons feed mapped by slug — a per-slug endpoint is a flagged map gap.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Card } from '@/app/api/cards/route'
import { CardTabs, type TabInfo } from './Tabs'
import { CardGrid } from './Grid'

type TabsResp = { tabs: TabInfo[]; openGround: number }
type GridResp = { base: Card | null; cards: Card[] }

export default function CardsMain() {
  const [tabs, setTabs] = useState<TabsResp | null>(null)
  const [active, setActive] = useState<string>('open-ground')
  const [grid, setGrid] = useState<GridResp | null>(null)
  const [pngBySlug, setPngBySlug] = useState<Map<string, string>>(new Map())
  const [q, setQ] = useState('')

  // tabs + the active tab from the URL (shareable catalog pages)
  useEffect(() => {
    const url = new URL(window.location.href)
    const want = url.searchParams.get('tab')
    fetch('/api/cards?tabs=1').then(r => r.json()).then((t: TabsResp) => {
      setTabs(t)
      setActive(want && (want === 'open-ground' || t.tabs.some(b => b.slug === want))
        ? want
        : (t.tabs[0]?.slug ?? 'open-ground'))
    }).catch(() => setTabs({ tabs: [], openGround: 0 }))
  }, [])

  // the active tab's grid
  useEffect(() => {
    if (!tabs) return
    setGrid(null)
    fetch(`/api/cards?tab=${encodeURIComponent(active)}`)
      .then(r => r.json()).then(setGrid).catch(() => setGrid({ base: null, cards: [] }))
    const url = new URL(window.location.href)
    url.searchParams.set('tab', active)
    window.history.replaceState(null, '', url.toString())
  }, [tabs, active])

  // baked shader photos — ONE batch fetch, mapped by slug (feed names are the
  // slug uppercased; tolerate display names by lowering both sides)
  useEffect(() => {
    fetch('/api/spaces/icons').then(r => r.json()).then((d: { icons?: { name: string; png: string }[] }) => {
      const m = new Map<string, string>()
      for (const it of d.icons ?? []) m.set(it.name.toLowerCase(), `data:image/png;base64,${it.png}`)
      setPngBySlug(m)
    }).catch(() => { /* placeholders carry the grid */ })
  }, [])

  const open = useCallback((slug: string) => { window.location.href = `/space/${slug}` }, [])

  const shown = useMemo(() => {
    if (!grid) return null
    if (!q.trim()) return grid
    const needle = q.trim().toLowerCase()
    const hit = (c: Card) =>
      c.name.toLowerCase().includes(needle) || c.type.includes(needle) ||
      c.tags.some(t => t.includes(needle)) || (c.maker.handle ?? '').includes(needle)
    return { base: grid.base, cards: grid.cards.filter(c => (grid.base && c.slug === grid.base.slug) || hit(c)) }
  }, [grid, q])

  return (
    <main className="min-h-screen bg-[#0a0705] text-[#f0e6d2]"
      style={{ background: 'radial-gradient(1100px 500px at 70% -10%, rgba(255,138,61,0.07), transparent 60%), #0a0705' }}>
      <style>{`
        .cardDeal { opacity: 0; animation: cardDeal .38s cubic-bezier(.2,.7,.3,1) forwards; }
        @keyframes cardDeal { from { opacity: 0; transform: translateY(14px) scale(.97); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .cardDeal { animation: none; opacity: 1; } }
      `}</style>

      <div className="max-w-[1240px] mx-auto px-4 pt-8 pb-20">
        {/* masthead */}
        <div className="flex items-baseline gap-4 mb-5">
          <h1 className="font-mono text-[15px] tracking-[0.4em] text-amber-200/90">THE CATALOG</h1>
          <span className="font-mono text-[11px] tracking-[0.2em] text-white/30">EVERY WORLD IS A CARD</span>
          <input
            value={q} onChange={e => setQ(e.target.value)} placeholder="search name · type · tag · @maker"
            className="ml-auto w-64 max-w-[45vw] bg-black/50 border border-white/15 rounded px-2.5 py-1.5 font-mono text-[12px] text-white/80 placeholder:text-white/25 outline-none focus:border-amber-300/50"
          />
        </div>

        {tabs === null ? (
          <div className="py-32 text-center font-mono text-[12px] tracking-[0.3em] text-white/30">DEALING…</div>
        ) : (
          <>
            <CardTabs tabs={tabs.tabs} openGround={tabs.openGround} active={active} onPick={setActive} />
            <div className="rounded-b-xl rounded-tr-xl border border-[#b97a2a]/25 bg-[#0d0906]/60 p-3.5">
              {tabs.tabs.length === 0 && active === 'open-ground' && (
                <p className="px-1 pb-3 font-mono text-[11px] tracking-[0.15em] text-white/30">
                  NO BASES FORGED YET — EVERY WORLD WAITS ON OPEN GROUND. THE FIRST ARCHETYPES ARE COMING.
                </p>
              )}
              {shown === null
                ? <div className="py-24 text-center font-mono text-[12px] tracking-[0.3em] text-white/30">DEALING…</div>
                : <CardGrid base={shown.base} cards={shown.cards} pngBySlug={pngBySlug} onOpen={open} />}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
