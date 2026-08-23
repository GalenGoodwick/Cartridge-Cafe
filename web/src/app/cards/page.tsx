'use client'

// /cards — the CARD MAIN, growing in parallel (MAP.cards: cards-grid owns this
// page; DESIGN-card-main.md). Flag-free while parallel: reachable only by URL;
// the cutover node (Galen-gated) is what makes it `/`. Icons come from the
// BATCH icons feed mapped by slug — a per-slug endpoint is a flagged map gap.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Card } from '@/app/api/cards/route'
import { CardTabs, type TabInfo } from './Tabs'
import { CardGrid } from './Grid'
import { CatalogSpace } from './Space'
import { useCatalogPresence } from './presence'
import { useCatalogTicker } from './ticker'

type TabsResp = { tabs: TabInfo[]; openGround: number }
type GridResp = { base: Card | null; cards: Card[] }

export default function CardsMain() {
  const [tabs, setTabs] = useState<TabsResp | null>(null)
  const [active, setActive] = useState<string>('open-ground')
  const [grid, setGrid] = useState<GridResp | null>(null)
  const [pngBySlug, setPngBySlug] = useState<Map<string, string>>(new Map())
  const [q, setQ] = useState('')
  const presence = useCatalogPresence()   // one beat + one rollup poll for every card
  const ticker = useCatalogTicker()       // main's slogan line, shared (lib/slogan.ts)
  // who's at the table — the masthead's SIGN IN / handle (chrome port: sign-in)
  const [me, setMe] = useState<{ email?: string | null; name?: string | null } | null | 'anon'>(null)
  // MOBILE: a phone catalog deals only mobile-ready cards (some games can't run
  // there at all) — but never an empty table: with no declared-mobile worlds yet,
  // show everything behind an honest banner.
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse), (max-width: 640px)')
    const set = () => setIsMobile(mq.matches)
    set(); mq.addEventListener('change', set)
    return () => mq.removeEventListener('change', set)
  }, [])
  useEffect(() => {
    fetch('/api/auth/session').then(r => r.json())
      .then(s => setMe(s?.user ? s.user : 'anon')).catch(() => setMe('anon'))
  }, [])

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

  const mobileFiltered = useMemo(() => {
    if (!grid || !isMobile) return { grid, hidden: 0 }
    const ready = grid.cards.filter(c => c.mobileReady || (grid.base && c.slug === grid.base.slug))
    if (ready.length <= (grid.base ? 1 : 0)) return { grid, hidden: -1 }   // none declared yet → show all, banner
    return { grid: { base: grid.base, cards: ready }, hidden: grid.cards.length - ready.length }
  }, [grid, isMobile])

  const shown = useMemo(() => {
    const grid = mobileFiltered.grid
    if (!grid) return null
    if (!q.trim()) return grid
    const needle = q.trim().toLowerCase()
    const hit = (c: Card) =>
      c.name.toLowerCase().includes(needle) || c.type.includes(needle) ||
      c.tags.some(t => t.includes(needle)) || (c.maker.handle ?? '').includes(needle)
    return { base: grid.base, cards: grid.cards.filter(c => (grid.base && c.slug === grid.base.slug) || hit(c)) }
  }, [mobileFiltered, q])

  return (
    <main className="min-h-screen text-[#f0e6d2]">
      <style>{`
        .cardDeal { opacity: 0; animation: cardDeal .45s cubic-bezier(.2,.7,.3,1) forwards; }
        @keyframes cardDeal { from { opacity: 0; transform: translateY(10px) scale(1.04); filter: blur(3px); } to { opacity: 1; transform: none; filter: none; } }
        /* steady grid (Galen: organized beats floating) — the bob reflowed rows; gone */
        .cardBob { animation: cardDeal .45s cubic-bezier(.2,.7,.3,1) forwards; }
        @media (prefers-reduced-motion: reduce) { .cardDeal, .cardBob { animation: none; opacity: 1; } }
      `}</style>
      <CatalogSpace>

      <div className="max-w-[1240px] mx-auto px-4 pt-8 pb-20">
        {/* masthead — the cafe's mark leads; the catalog is a page OF the cafe */}
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <img src="/cartridge-cup.svg" alt="" className="w-8 h-8 -mt-0.5" />
          <h1 className="font-extrabold text-[19px] tracking-tight text-amber-300" style={{ fontFamily: 'inherit' }}>cartridge.cafe</h1>
          <span className="font-mono text-[12px] tracking-[0.35em] text-amber-200/70 pl-2 border-l border-white/15">THE CATALOG</span>
          <span className={`font-mono text-[11px] tracking-[0.14em] hidden sm:inline transition-colors duration-500 ${ticker.live ? 'text-amber-200' : 'text-white/30'}`}>{ticker.text}</span>
          <input
            value={q} onChange={e => setQ(e.target.value)} placeholder="search name · type · tag · @maker"
            className="ml-auto w-64 max-w-[38vw] max-sm:order-last max-sm:w-full max-sm:max-w-none bg-black/50 border border-white/15 rounded px-2.5 py-1.5 font-mono text-[12px] text-white/80 placeholder:text-white/25 outline-none focus:border-amber-300/50"
          />
          {me === 'anon' && (
            <a href={`/auth/signin?callbackUrl=${encodeURIComponent('/cards')}`}
              className="shrink-0 font-mono text-[12px] tracking-[0.15em] px-3 py-1.5 rounded border border-[#ff6a2b]/50 text-amber-200 hover:bg-[#ff6a2b]/15 transition-colors">
              SIGN IN
            </a>
          )}
          {me && me !== 'anon' && (
            <span className="shrink-0 font-mono text-[11px] text-white/45 truncate max-w-[120px]"
              title={me.email ?? undefined}>
              @{(me.email ?? me.name ?? 'you').split('@')[0].replace(/[^a-z0-9_-]/gi, '')}
            </span>
          )}
        </div>

        {tabs === null ? (
          <div className="py-32 text-center font-mono text-[12px] tracking-[0.3em] text-white/30">DEALING…</div>
        ) : (
          <>
            <CardTabs tabs={tabs.tabs} openGround={tabs.openGround} active={active} onPick={setActive} />
            <div className="rounded-b-xl rounded-tr-xl border border-[#b97a2a]/25 bg-[#0d0906]/70 p-3.5">
              {isMobile && mobileFiltered.hidden === -1 && (
                <p className="px-1 pb-3 font-mono text-[10.5px] tracking-[0.12em] text-amber-200/50">
                  NO MOBILE-READY WORLDS ON THIS PAGE YET — SHOWING ALL (SOME MAY NEED A KEYBOARD)
                </p>
              )}
              {isMobile && mobileFiltered.hidden > 0 && (
                <p className="px-1 pb-3 font-mono text-[10.5px] tracking-[0.12em] text-white/30">
                  {mobileFiltered.hidden} DESKTOP-ONLY WORLD{mobileFiltered.hidden === 1 ? '' : 'S'} HIDDEN ON MOBILE
                </p>
              )}
              {tabs.tabs.length === 0 && active === 'open-ground' && (
                <p className="px-1 pb-3 font-mono text-[11px] tracking-[0.15em] text-white/30">
                  NO BASES FORGED YET — EVERY WORLD WAITS ON OPEN GROUND. THE FIRST ARCHETYPES ARE COMING.
                </p>
              )}
              {shown === null
                ? <div className="py-24 text-center font-mono text-[12px] tracking-[0.3em] text-white/30">DEALING…</div>
                : <CardGrid base={shown.base} cards={shown.cards} pngBySlug={pngBySlug} presence={presence} onOpen={open} />}
            </div>
          </>
        )}
      </div>
      </CatalogSpace>
    </main>
  )
}
