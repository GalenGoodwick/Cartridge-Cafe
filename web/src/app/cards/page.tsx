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
import ConnectPanel from '@/app/ConnectPanel'
import { GenerateDoor } from './Generate'
import { MembershipBanner } from './MembershipBanner'
import { signOut } from 'next-auth/react'
import MainCommonsChat from '@/app/MainCommonsChat'
import ChatWorld from '@/app/ChatWorld'

type GridResp = { cards: Card[]; base?: Card | null; signedOut?: boolean; page?: number; pages?: number; total?: number; mobileFallback?: boolean }

export default function CardsMain() {
  const [counts, setCounts] = useState<TabCounts | null>(null)
  const [active, setActive] = useState<string>('live')
  const [grid, setGrid] = useState<GridResp | null>(null)
  const [pageN, setPageN] = useState(1)
  const [pngBySlug, setPngBySlug] = useState<Map<string, string>>(new Map())
  const [q, setQ] = useState('')
  const presence = useCatalogPresence()   // one beat + one rollup poll for every card
  const ticker = useCatalogTicker()       // main's slogan line, shared (lib/slogan.ts)
  const [me, setMe] = useState<{ email?: string | null; name?: string | null } | null | 'anon'>(null)
  // MASTHEAD CHROME (task #17 — the cutover prerequisite): the catalog carries
  // main's working doors — CONNECT AI, the bell, THE COMMONS, the reckoning.
  const [connectOpen, setConnectOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [bell, setBell] = useState<{ items: Array<{ id: string; text: string; link: string | null; readAt: string | null }>; unread: number }>({ items: [], unread: 0 })
  const [bellOpen, setBellOpen] = useState(false)
  const [acctOpen, setAcctOpen] = useState(false)
  const myHandle = me && me !== 'anon' ? (me.email ?? me.name ?? 'you').split('@')[0].replace(/[^a-z0-9_-]/gi, '') : null
  useEffect(() => {
    if (!me || me === 'anon') return
    const pull = () => { if (document.visibilityState !== 'hidden') fetch('/api/notifications').then(r => r.json()).then(d => setBell({ items: d.items || [], unread: d.unread || 0 })).catch(() => {}) }
    pull()
    const t = setInterval(pull, 60_000)
    return () => clearInterval(t)
  }, [me])
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
    const u = new URL(window.location.href)
    const want = u.searchParams.get('tab')
    const p0 = parseInt(u.searchParams.get('page') || '1', 10)
    if (p0 > 1) setPageN(p0)
    fetch('/api/cards?tabs=1').then(r => r.json()).then((t: TabCounts) => {
      setCounts(t)
      setActive(want || 'live')
    }).catch(() => setCounts({ published: 0, live: 0, forkable: 0, mine: null }))
  }, [])

  // the active tab's cards — PAGINATED server-side (pages 1, 2, 3…; search and
  // the mobile cut apply across the WHOLE tab, then the page is served)
  useEffect(() => {
    if (!counts) return
    setGrid(null)
    const t = setTimeout(() => {
      const p = new URLSearchParams({ tab: active, page: String(pageN) })
      if (q.trim()) p.set('q', q.trim())
      if (isMobile) p.set('mobile', '1')
      fetch(`/api/cards?${p}`)
        .then(r => r.json()).then(setGrid).catch(() => setGrid({ cards: [] }))
    }, q.trim() ? 250 : 0)   // debounce typing; instant otherwise
    const url = new URL(window.location.href)
    url.searchParams.set('tab', active)
    if (pageN > 1) url.searchParams.set('page', String(pageN)); else url.searchParams.delete('page')
    window.history.replaceState(null, '', url.toString())
    return () => clearTimeout(t)
  }, [counts, active, pageN, q, isMobile])

  // a new tab or a new search starts back at page 1
  useEffect(() => { setPageN(1) }, [active, q])

  // baked shader photos — ONE batch fetch, mapped by slug
  useEffect(() => {
    fetch('/api/spaces/icons').then(r => r.json()).then((d: { icons?: { name: string; png: string }[] }) => {
      const m = new Map<string, string>()
      for (const it of d.icons ?? []) m.set(it.name.toLowerCase(), `data:image/png;base64,${it.png}`)
      setPngBySlug(m)
    }).catch(() => { /* placeholders carry the grid */ })
  }, [])

  const open = useCallback((slug: string) => { window.location.href = `/space/${slug}` }, [])

  const FIXED = ['live', 'published', 'forkable', 'mine']
  const isFamily = !FIXED.includes(active)
  const familyName = isFamily ? (grid?.base?.name ?? active) : null

  // search + mobile are SERVER-side now (truthful across all pages)
  const shown = useMemo(() => {
    if (!grid) return null
    return { cards: grid.cards, base: grid.base ?? null, signedOut: grid.signedOut === true,
      hidden: grid.mobileFallback ? -1 : 0, page: grid.page ?? 1, pages: grid.pages ?? 1, total: grid.total ?? grid.cards.length }
  }, [grid])

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
          <h1 className="cafe-sign text-[22px] leading-none">cartridge<span className="not-italic font-mono text-[15px] text-brass">.cafe</span></h1>
          <span className={`font-mono text-[11px] tracking-[0.14em] hidden sm:inline transition-colors duration-500 ${ticker.live ? 'text-amber-200' : 'text-white/30'}`}>{ticker.text}</span>
          <input
            value={q} onChange={e => setQ(e.target.value)} placeholder="search name · type · tag · @maker"
            className="ml-auto w-64 max-w-[38vw] max-sm:order-last max-sm:w-full max-sm:max-w-none bg-black/50 border border-white/15 rounded px-2.5 py-1.5 font-mono text-[12px] text-white/80 placeholder:text-white/25 outline-none focus:border-amber-300/50"
          />
          <button onClick={() => setConnectOpen(true)}
            className="shrink-0 font-mono text-[12px] tracking-[0.15em] px-3 py-1.5 rounded border border-emerald-300/40 text-emerald-200 hover:bg-emerald-400/15 transition-colors"
            title="connect your AI — it builds your worlds and chats the commons as you">
            ⚿ CONNECT AI
          </button>
          <GenerateDoor signedIn={!!me && me !== 'anon'} />
          {me && me !== 'anon' && (
            <div className="relative shrink-0">
              <button onClick={() => {
                setBellOpen(o => !o)
                if (!bellOpen && bell.unread > 0) fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ readAll: true }) }).then(() => setBell(b => ({ ...b, unread: 0 }))).catch(() => {})
              }}
                className={`font-mono text-[12px] px-2.5 py-1.5 rounded border transition-colors ${bell.unread > 0 ? 'border-[#ff6a2b]/60 text-amber-200' : 'border-white/15 text-white/45 hover:text-amber-200'}`}>
                🔔{bell.unread > 0 ? ` ${bell.unread}` : ''}
              </button>
              {bellOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto rounded-xl bg-[#171009]/95 backdrop-blur border border-[#b97a2a]/25 p-2 z-[70]">
                  {bell.items.length === 0 && <div className="px-3 py-4 font-mono text-[12px] text-white/40 text-center">nothing yet — comments, follows, and forks of your work land here</div>}
                  {bell.items.map(n => (
                    <a key={n.id} href={n.link || '#'} className={`block px-3 py-2 rounded-lg font-mono text-[13px] leading-relaxed hover:bg-black/40 ${n.readAt ? 'text-white/45' : 'text-amber-200'}`}>
                      {n.text}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
          {me === 'anon' && (
            <a href={`/auth/signin?callbackUrl=${encodeURIComponent('/cards')}`}
              className="shrink-0 font-mono text-[12px] tracking-[0.15em] px-3 py-1.5 rounded border border-[#ff6a2b]/50 text-amber-200 hover:bg-[#ff6a2b]/15 transition-colors">
              SIGN IN
            </a>
          )}
          {me && me !== 'anon' && (
            <div className="relative shrink-0">
              <button onClick={() => setAcctOpen(o => !o)}
                className={`font-mono text-[11px] truncate max-w-[130px] transition-colors ${acctOpen ? 'text-amber-200' : 'text-white/45 hover:text-amber-200'}`}>
                @{myHandle} ▾
              </button>
              {acctOpen && (
                <div className="absolute right-0 top-full mt-2 w-52 rounded-xl bg-[#171009]/95 backdrop-blur border border-[#b97a2a]/25 p-1.5 z-[70] font-mono text-[13px]">
                  {[
                    { label: '◈ MY WORLDS', href: `/u/${myHandle}` },
                    { label: '◇ FRAMEWORK', href: '/framework' },
                    { label: '⚙ ACCOUNT', href: '/account' },
                  ].map(it => (
                    <a key={it.label} href={it.href} className="block px-2.5 py-2 rounded-lg text-white/75 hover:text-amber-200 hover:bg-black/40 transition-colors">{it.label}</a>
                  ))}
                  <button onClick={() => signOut({ callbackUrl: '/cards' })}
                    className="block w-full text-left px-2.5 py-2 rounded-lg text-white/50 hover:text-white hover:bg-black/40 transition-colors">sign out</button>
                </div>
              )}
            </div>
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

              {shown === null ? (
                <div className="py-24 text-center font-mono text-[12px] tracking-[0.3em] text-white/30">DEALING…</div>
              ) : active === 'mine' && shown.signedOut ? (
                <div className="py-24 text-center font-mono text-[13px] tracking-[0.15em] text-white/40">
                  {active === 'mine'
                    ? 'SIGN IN TO SEE YOUR WORLDS — OWNED, INCLUDING YOUR UNPUBLISHED DRAFTS'
                    : 'SIGN IN TO SEE WORLDS SHARED WITH YOU'}
                </div>
              ) : (
                <>
                  {active === 'live' && <MembershipBanner />}
                  {active === 'premium' && (
                    <p className="px-1 pb-3 font-mono text-[11px] tracking-[0.28em] text-yellow-200/70">
                      ✦ LIVE · EXPERIMENTAL — worth paying for · buy in to CO-PROGRAM the world · free demo inside
                    </p>
                  )}
                  {active === 'forkable' && (
                    <p className="px-1 pb-3 font-mono text-[11px] tracking-[0.3em] text-amber-200/60">
                      START HERE — FORK ONE AND IT BECOMES YOURS · bases first
                    </p>
                  )}
                  {active === 'mine' && (
                    <p className="px-1 pb-3 font-mono text-[10.5px] tracking-[0.12em] text-white/30">
                      YOUR WORLDS — OWNED AND CO-BUILT (MEMBER SEATS) · UNPUBLISHED DRAFTS ARE VISIBLE ONLY HERE
                    </p>
                  )}
                  <CardGrid base={shown.base} cards={shown.cards} pngBySlug={pngBySlug} presence={presence} onOpen={open} />
                  {shown.pages > 1 && (
                    <div className="mt-5 flex items-center justify-center gap-1.5 font-mono text-[12px]" role="navigation" aria-label="pages">
                      <button disabled={shown.page <= 1} onClick={() => setPageN(shown.page - 1)}
                        className="px-2 py-1 rounded border border-white/15 text-white/50 hover:text-amber-200 disabled:opacity-30">‹</button>
                      {Array.from({ length: shown.pages }, (_, i) => i + 1)
                        .filter(n => n === 1 || n === shown.pages || Math.abs(n - shown.page) <= 2)
                        .map((n, i, arr) => (
                          <span key={n} className="flex items-center gap-1.5">
                            {i > 0 && arr[i - 1] !== n - 1 && <span className="text-white/25">…</span>}
                            <button onClick={() => setPageN(n)} aria-current={n === shown.page ? 'page' : undefined}
                              className={`px-2.5 py-1 rounded border transition-colors ${n === shown.page
                                ? 'border-amber-300/60 bg-amber-400/15 text-amber-200'
                                : 'border-white/15 text-white/50 hover:text-amber-200 hover:border-amber-300/40'}`}>{n}</button>
                          </span>
                        ))}
                      <button disabled={shown.page >= shown.pages} onClick={() => setPageN(shown.page + 1)}
                        className="px-2 py-1 rounded border border-white/15 text-white/50 hover:text-amber-200 disabled:opacity-30">›</button>
                      <span className="pl-2 text-white/30">{shown.total} worlds</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
      {/* THE COMMONS door + room — the same chat main carries, on the catalog */}
      <MainCommonsChat visible={!connectOpen && !chatOpen} onEnter={() => setChatOpen(true)} />
      {chatOpen && <ChatWorld channel="commons:main" title="The Commons" subtitle="the AIs at scale" onExit={() => setChatOpen(false)} />}
      {connectOpen && <ConnectPanel onClose={() => setConnectOpen(false)} />}
      </CatalogSpace>
    </main>
  )
}
