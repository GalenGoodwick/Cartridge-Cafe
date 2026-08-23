'use client'

// /cards — the CARD MAIN (MAP.cards: cards-grid owns this page). THE TWO TABS
// (Galen's ruling): PUBLISHED — every playable card, the BASES as a featured
// row on top — and MY / OUR WORLDS — owned ∪ member, unpublished drafts
// included. A base's family page (?tab=<baseSlug>) rides as a contextual tab.
// The cutover node (Galen-gated) is what makes this `/`.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Card } from '@/app/api/cards/route'
import { CardTabs, type TabCounts } from './Tabs'
import { CardGrid } from './Grid'
import { CatalogSpace } from './Space'
import { useCatalogPresence } from './presence'
import { useCatalogTicker } from './ticker'

type GridResp = { bases?: Card[]; cards: Card[]; base?: Card | null; signedOut?: boolean }

export default function CardsMain() {
  const [counts, setCounts] = useState<TabCounts | null>(null)
  const [active, setActive] = useState<string>('published')
  const [grid, setGrid] = useState<GridResp | null>(null)
  const [pngBySlug, setPngBySlug] = useState<Map<string, string>>(new Map())
  const [q, setQ] = useState('')
  const presence = useCatalogPresence()   // one beat + one rollup poll for every card
  const ticker = useCatalogTicker()       // main's slogan line, shared (lib/slogan.ts)
  const [me, setMe] = useState<{ email?: string | null; name?: string | null } | null | 'anon'>(null)
  // MOBILE: deal only mobile-ready cards (honest banners when none declare yet)
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

  // the strip counts + the active tab from the URL (shareable catalog pages)
  useEffect(() => {
    const want = new URL(window.location.href).searchParams.get('tab')
    fetch('/api/cards?tabs=1').then(r => r.json()).then((t: TabCounts) => {
      setCounts(t)
      setActive(want || 'published')
    }).catch(() => setCounts({ published: 0, bases: 0, mine: null }))
  }, [])

  // the active tab's cards
  useEffect(() => {
    if (!counts) return
    setGrid(null)
    fetch(`/api/cards?tab=${encodeURIComponent(active)}`)
      .then(r => r.json()).then(setGrid).catch(() => setGrid({ cards: [] }))
    const url = new URL(window.location.href)
    url.searchParams.set('tab', active)
    window.history.replaceState(null, '', url.toString())
  }, [counts, active])

  // baked shader photos — ONE batch fetch, mapped by slug
  useEffect(() => {
    fetch('/api/spaces/icons').then(r => r.json()).then((d: { icons?: { name: string; png: string }[] }) => {
      const m = new Map<string, string>()
      for (const it of d.icons ?? []) m.set(it.name.toLowerCase(), `data:image/png;base64,${it.png}`)
      setPngBySlug(m)
    }).catch(() => { /* placeholders carry the grid */ })
  }, [])

  const open = useCallback((slug: string) => { window.location.href = `/space/${slug}` }, [])

  const isFamily = active !== 'published' && active !== 'mine'
  const familyName = isFamily ? (grid?.base?.name ?? active) : null

  // search + the mobile capability filter, over whatever the tab dealt
  const shown = useMemo(() => {
    if (!grid) return null
    let bases = grid.bases ?? []
    let cards = grid.cards
    let hidden = 0
    if (isMobile) {
      const readyCards = cards.filter(c => c.mobileReady || !c.playable || (grid.base && c.slug === grid.base?.slug))
      if (readyCards.length > 0 || bases.some(b => b.mobileReady)) {
        hidden = cards.length - readyCards.length
        cards = readyCards
        bases = bases.filter(b => b.mobileReady)
      } else hidden = -1   // nothing declares mobile yet → show all, honest banner
    }
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      const hit = (c: Card) =>
        c.name.toLowerCase().includes(needle) || c.type.includes(needle) ||
        c.tags.some(t => t.includes(needle)) || (c.maker.handle ?? '').includes(needle)
      bases = bases.filter(hit)
      cards = cards.filter(c => (grid.base && c.slug === grid.base?.slug) || hit(c))
    }
    return { bases, cards, base: grid.base ?? null, signedOut: grid.signedOut === true, hidden }
  }, [grid, q, isMobile])

  return (
    <main className="min-h-screen text-[#f0e6d2]">
      <style>{`
        .cardDeal { opacity: 0; animation: cardDeal .45s cubic-bezier(.2,.7,.3,1) forwards; }
        @keyframes cardDeal { from { opacity: 0; transform: translateY(10px) scale(1.04); filter: blur(3px); } to { opacity: 1; transform: none; filter: none; } }
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
            <span className="shrink-0 font-mono text-[11px] text-white/45 truncate max-w-[120px]" title={me.email ?? undefined}>
              @{(me.email ?? me.name ?? 'you').split('@')[0].replace(/[^a-z0-9_-]/gi, '')}
            </span>
          )}
        </div>

        {counts === null ? (
          <div className="py-32 text-center font-mono text-[12px] tracking-[0.3em] text-white/30">DEALING…</div>
        ) : (
          <>
            <CardTabs counts={counts} active={active} familyName={familyName} onPick={setActive} />
            <div className="rounded-b-xl rounded-tr-xl border border-[#b97a2a]/25 bg-[#0d0906]/70 p-3.5">
              {isMobile && shown?.hidden === -1 && (
                <p className="px-1 pb-3 font-mono text-[10.5px] tracking-[0.12em] text-amber-200/50">
                  NO MOBILE-READY WORLDS ON THIS PAGE YET — SHOWING ALL (SOME MAY NEED A KEYBOARD)
                </p>
              )}
              {isMobile && (shown?.hidden ?? 0) > 0 && (
                <p className="px-1 pb-3 font-mono text-[10.5px] tracking-[0.12em] text-white/30">
                  {shown!.hidden} DESKTOP-ONLY WORLD{shown!.hidden === 1 ? '' : 'S'} HIDDEN ON MOBILE
                </p>
              )}

              {shown === null ? (
                <div className="py-24 text-center font-mono text-[12px] tracking-[0.3em] text-white/30">DEALING…</div>
              ) : active === 'mine' && shown.signedOut ? (
                <div className="py-24 text-center font-mono text-[13px] tracking-[0.15em] text-white/40">
                  SIGN IN TO SEE YOUR WORLDS — OWNED, SHARED WITH YOU, AND YOUR UNPUBLISHED DRAFTS
                </div>
              ) : (
                <>
                  {/* PUBLISHED: the BASES lead — the starting points, forkable by nature */}
                  {active === 'published' && shown.bases.length > 0 && (
                    <div className="mb-5">
                      <div className="px-1 pb-2 font-mono text-[11px] tracking-[0.3em] text-amber-200/60">
                        BASES — START HERE · fork one and it becomes yours
                      </div>
                      <CardGrid base={null} cards={shown.bases} pngBySlug={pngBySlug} presence={presence} onOpen={open} />
                      <div className="mt-5 mb-2 px-1 font-mono text-[11px] tracking-[0.3em] text-white/35">ALL WORLDS</div>
                    </div>
                  )}
                  {active === 'mine' && (
                    <p className="px-1 pb-3 font-mono text-[10.5px] tracking-[0.12em] text-white/30">
                      YOURS AND SHARED WITH YOU · UNPUBLISHED DRAFTS ARE VISIBLE ONLY HERE
                    </p>
                  )}
                  <CardGrid base={shown.base} cards={shown.cards} pngBySlug={pngBySlug} presence={presence} onOpen={open} />
                </>
              )}
            </div>
          </>
        )}
      </div>
      </CatalogSpace>
    </main>
  )
}
