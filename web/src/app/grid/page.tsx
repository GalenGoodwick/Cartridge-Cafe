'use client'

// ═══ THE GRID (Galen, Aug 28) ═══
// ONE contained grid (reckoning viewport-inset + blue/gold frame). UI SETS dock
// around it via THE DOCKSTAR — the cafe cup, centered in the bottom bar (the
// one control spot, never covered). The dockstar menu also carries ACCOUNT.
//
// GAMES · BROWSE — mini frame at top; THE ICON SHELF below (tabs: ◉ LIVE
// EDITING to hook people · FREE GAMES · ✦ PREMIUM · 🔍 search). Tile → world
// hot-swaps into the frame; CLICK THE FRAME → play.
// ENGINE — the tools dock in from the RIGHT: ⌁ BuilderBox (real — the engine's
// build console opens in the frame), ⚿ CONNECT AI (the paste-prompt), world
// tools seat. Frame yields the strip; the grid stays center.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FieldEngine from '@/app/engine/FieldEngine'
import GridChat from './GridChat'
import type { AiNodeGraph, ANode } from '@/app/engine/ai-view/NodeGraph'
import SpaceManagementOverlay from '@/app/engine/SpaceManagementOverlay'
import SpritesPanel from '@/app/engine/SpritesPanel'
import { iconAuthorPrompt, playerGlyphPrompt, worldBriefingPrompt } from '@/lib/connectPrompt'
import { startCafeAudio } from '@/app/engine/cafe-audio'
import { MembershipBanner } from '@/app/cards/MembershipBanner'

type Inset = { top: number; right: number; bottom: number; left: number }
type UiSet = 'games' | 'main' | 'engine' | 'create'
type Phase = 'browse' | 'play'
type Tab = 'live' | 'published' | 'premium' | 'unfinished' | 'forked' | 'mine' | 'mobile' | 'desktop'
type Entry = { slug: string; name: string; scene: string; maker?: string }
// the engine's cfg publish — one shape, read by CONFIG/PUBLISH/VERSIONS/CREW
type GridCfg = {
  isOwner: boolean; spaceId: string | null; spaceSlug: string | null
  multiplayer: boolean; rReset: boolean; forkable: boolean
  designMode?: boolean; ver?: number | null; isPublic?: boolean | null
  card?: { kind?: string; type?: string; tags?: string[] } | null
  blurb?: string; vision?: string; instructions?: string
  premium?: number | null; unfinished?: boolean; device?: string | null; gridW?: number | null; gridH?: number | null
  presenceOff: boolean; policy: string | null
}

const EASE = 'top 0.32s ease-out, right 0.32s ease-out, bottom 0.32s ease-out, left 0.32s ease-out'
const M = 16, BAR_H = 64, DOCK_W = 248
const MIN_W = 180, MIN_H = 120   // the frame can NEVER smash to a line
const LOCAL: Entry[] = [
  // SPACE, not scene (Galen, Aug 30: "one way to open a world"). Every house
  // game already has a DB space twin, so the default boot + fallback open the
  // cinderfell SPACE — nothing opens a game as a bundled scene anymore. The
  // scene loader stays only for structural chrome (MAIN-COMMONS/CAFE).
  { slug: 'cinderfell', name: 'CINDERFELL', scene: 'space:cinderfell', maker: 'Galen' },
]

export default function TheGrid() {
  const [win, setWin] = useState({ w: 1280, h: 800 })
  const [uiSet, setUiSet] = useState<UiSet>('games')
  const [phase, setPhase] = useState<Phase>('browse')
  const [tab, setTab] = useState<Tab>(() => (typeof window !== 'undefined' && window.innerWidth < 700 ? 'mobile' : 'desktop'))
  const [q, setQ] = useState('')
  const [entries, setEntries] = useState<Entry[]>(LOCAL)
  const prevTabRef = useRef<Tab | null>(null)   // tab-switch detection (a tab is a context)
  const [icons, setIcons] = useState<Map<string, string>>(new Map())
  const [scene, setScene] = useState<string>(LOCAL[0].scene)
  const [selOpen, setSelOpen] = useState(false)
  const [instrOpen, setInstrOpen] = useState(false)
  const [instrText, setInstrText] = useState<string>('')
  const [connectOpen, setConnectOpen] = useState(false)
  const [attribOpen, setAttribOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [brewIconOpen, setBrewIconOpen] = useState(false)   // ◆ BREW ICON (MAIN)
  const [resetConfirm, setResetConfirm] = useState(false)   // ⟲ RESET (R-reset worlds) — confirm first
  const [tool, setTool] = useState<'eye' | 'console' | 'nodes' | 'assets' | 'crew' | 'versions' | 'config' | 'publish' | 'chat' | 'mine' | 'brain' | 'connect'>('eye')   // ENGINE's under-area view
  const [eyeData, setEyeData] = useState<{
    focus?: { action?: string; fieldName?: string; at?: number } | null
    eye?: { png?: string; at?: number; name?: string } | null
    shot?: string
    graph?: AiNodeGraph | null
    inspect?: { on: boolean; log: Array<{ at: number; x: number; y: number; field: string | null; visual: string | null; color: string | null; entity?: { id: number; kind?: number; label?: string } | null; ui?: { id: string; text: string } | null; source?: string | null }> } | null
    config?: GridCfg | null
  } | null>(null)

  const [aiLog, setAiLog] = useState<Array<{ type: string; summary: string; author: string | null; t: number }>>([])
  const [copied, setCopied] = useState(false)
  const [rec, setRec] = useState<{ on: boolean; secs: number }>({ on: false, secs: 0 })
  // who's signed in — the dockstar menu's ACCOUNT block reads this
  const [me, setMe] = useState<{ name?: string | null; email?: string | null } | null>(null)
  useEffect(() => {
    fetch('/api/auth/session').then(r => (r.ok ? r.json() : null))
      .then(d => setMe(d?.user ?? null)).catch(() => setMe(null))
  }, [])
  // ✕ CLEAR on the eye image: a local dismissal watermark — images at or before
  // it stay hidden; the next probe/shot (newer `at`) reappears on its own.
  const [eyeCleared, setEyeCleared] = useState(0)

  // ── SPACES FOR REAL: a `space:` scene resolves to a live space mount (id +
  // ownership), not a dead snapshot — versions/invite/sprites/config all light
  // up through the engine's own machinery. undefined = resolving; null = not a
  // reachable space (private/404) → snapshot fallback.
  // ✧ CREATE live-shape: the /create iframe posts its facets — the frame
  // ACTIVELY morphs to the declared shape (mobile = portrait). A birth posts
  // create-born and the PARENT navigates (no grid-in-iframe).
  const [createShape, setCreateShape] = useState<'desktop' | 'mobile' | 'universal'>('desktop')
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || !e.data || typeof e.data !== 'object') return
      const d = e.data as { cc?: string; targets?: string; slug?: string }
      if (d.cc === 'create-facets' && (d.targets === 'desktop' || d.targets === 'mobile' || d.targets === 'universal')) {
        setCreateShape(d.targets)
        // the framed TEMPLATE follows the declared shape (Galen, Aug 31): a
        // MOBILE creation frames the mobile base, not a letterboxed desktop
        // world. Only the DEFAULTS swap — a base the maker framed on purpose
        // stays put.
        setScene(prev => d.targets === 'mobile'
          ? (prev === 'space:cinderfell' ? 'space:mobile-base' : prev)
          : (prev === 'space:mobile-base' ? 'space:cinderfell' : prev))
      }
      // BORN → THE PROVEN ROUTE (Galen, Aug 31: "find the route and rewire
      // it"): the standalone birth path navigates to /space/<slug>?connect=1,
      // which redirects into /grid?w=…&ui=engine&connect=1 — the mount
      // handler opens the ⚿ CONNECT AI tab with the paste-prompt + key. The
      // embedded flow's in-place state juggling (setScene/setUiSet/setTool)
      // raced the panel-reset effect and showed no prompt. A FULL NAVIGATION
      // is the route that worked: the world OPENS and the prompt appears.
      if (d.cc === 'create-born' && typeof d.slug === 'string') { window.location.href = '/space/' + encodeURIComponent(d.slug) + '?connect=1' }
    }
    window.addEventListener('message', on)
    return () => window.removeEventListener('message', on)
  }, [])
  // ⛨ ADMIN — the door shows only to admins (the API answers 200 to them alone)
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    fetch('/api/admin/worlds').then(r => setIsAdmin(r.ok)).catch(() => {})
  }, [])
  // ✚/⚡ COMMERCE — build credits + live-edit membership, read fresh each time
  // the dockstar opens (Galen: buy credits anytime, membership on the menu)
  const [wallet, setWallet] = useState<{ credits: number; genUsd: number; bundles: Record<number, number>; free: boolean; member: boolean; memUsd: number; buyable: boolean } | null>(null)
  const [buying, setBuying] = useState<'' | 'credit' | 'member'>('')
  const [buyQty, setBuyQty] = useState(1)
  useEffect(() => {
    if (!selOpen) return
    Promise.all([
      fetch('/api/generate').then(r => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/membership').then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([g, m]) => setWallet({
      credits: g?.credits ?? 0, genUsd: g?.priceUsd ?? 5, bundles: g?.bundles ?? { 1: 5, 3: 12, 5: 18, 10: 30 },
      free: !!g?.free, member: !!m?.member, memUsd: m?.usd ?? 10, buyable: !!(g?.buyable || m?.buyable),
    }))
  }, [selOpen])
  const startCheckout = async (kind: 'credit' | 'member') => {
    setBuying(kind)
    try {
      const r = await fetch(kind === 'credit' ? '/api/generate/buy' : '/api/membership', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: kind === 'credit' ? JSON.stringify({ qty: buyQty }) : '{}',
      })
      const d = await r.json().catch(() => null)
      if (d?.url) { window.location.href = d.url; return }
    } catch { /* fall through */ }
    setBuying('')
  }

  const [spaceInfo, setSpaceInfo] = useState<{ slug: string; id: string; name: string; ownerName?: string; ownerId: string; isOwner: boolean; forkable: boolean; device?: 'mobile' | 'desktop' | null; rReset?: boolean; gridSize?: number | null } | null | undefined>(undefined)
  useEffect(() => {
    if (!scene.startsWith('space:')) { setSpaceInfo(null); return }
    const slug = scene.slice(6)
    let dead = false
    setSpaceInfo(undefined)
    Promise.all([
      fetch(`/api/spaces/${encodeURIComponent(slug)}`).then(r => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/auth/session').then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([d, s]: [{ space?: { id: string; name?: string; ownerId: string; owner?: { name?: string | null } | null; forkable?: boolean; deviceConfig?: 'mobile' | 'desktop' | null; rReset?: boolean; gridSize?: number | null } } | null, { user?: { id?: string } } | null]) => {
      if (dead) return
      const sp = d?.space
      if (!sp?.id) { setSpaceInfo(null); return }
      const meId = s?.user?.id ?? null
      setSpaceInfo({ slug, id: sp.id, name: sp.name || slug, ownerName: sp.owner?.name ?? undefined, ownerId: sp.ownerId, isOwner: !!meId && meId === sp.ownerId, forkable: sp.forkable !== false, device: sp.deviceConfig ?? null, rReset: !!sp.rReset, gridSize: sp.gridSize ?? null })
    }).catch(() => { if (!dead) setSpaceInfo(null) })
    return () => { dead = true }
  }, [scene])
  const spc = scene.startsWith('space:') && spaceInfo && spaceInfo.slug === scene.slice(6) ? spaceInfo : null
  const spaceResolving = scene.startsWith('space:') && spaceInfo === undefined

  useEffect(() => {
    // BAIL when the window size hasn't actually changed. The eased-resize effect
    // below fires synthetic 'resize' events (to re-fit the engine camera against
    // the animating frame); without this guard each one built a NEW {w,h} object,
    // re-rendered, produced a new `inset`, re-ran the ease effect → a self-feeding
    // loop that jittered the frame mid-resize. Returning `prev` makes React skip.
    const m = () => setWin(prev => (prev.w === window.innerWidth && prev.h === window.innerHeight)
      ? prev : { w: window.innerWidth, h: window.innerHeight })
    m(); window.addEventListener('resize', m)
    return () => window.removeEventListener('resize', m)
  }, [])

  // THE AUDIO — the deleted CafeShell used to call this; without it the window
  // gesture listeners that RESUME the shared AudioContext never registered, so
  // no world (or shell) sound ever played (Galen: "sound is broken"). Idempotent;
  // MAIN wants the cafe drone, worlds stay quiet (their own GameAudio carries them).
  useEffect(() => { startCafeAudio(uiSet === 'main' ? 'CAFE' : 'world') }, [uiSet])

  // BLOCK ZOOM (Galen: zooming throws off the UI). Pinch is off via the layout
  // viewport; here: ctrl/cmd+wheel, ctrl/cmd +/-/0, and Safari gesture events.
  useEffect(() => {
    const wheel = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault() }
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0'].includes(e.key)) e.preventDefault() }
    const gesture = (e: Event) => e.preventDefault()
    window.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('keydown', key)
    window.addEventListener('gesturestart', gesture as EventListener)
    window.addEventListener('gesturechange', gesture as EventListener)
    return () => {
      window.removeEventListener('wheel', wheel)
      window.removeEventListener('keydown', key)
      window.removeEventListener('gesturestart', gesture as EventListener)
      window.removeEventListener('gesturechange', gesture as EventListener)
    }
  }, [])

  // catalog + icons (prod real; local = bundled cartridges)
  useEffect(() => {
    const feed = tab
    fetch(`/api/cards?tab=${feed}`).then(r => r.json())
      .then((d: { cards?: Array<{ slug: string; name: string; maker?: { name?: string | null; handle?: string | null } }> }) => {
        const list = Array.isArray(d.cards) && d.cards.length
          ? d.cards.map(c => ({ slug: c.slug, name: c.name, scene: 'space:' + c.slug, maker: c.maker?.name ?? c.maker?.handle ?? undefined }))
          : (feed === 'mine' || feed === 'premium' || feed === 'unfinished' || feed === 'forked' || feed === 'mobile' || feed === 'desktop' ? [] : LOCAL)   // empty deed/premium/unfinished/forks is EMPTY, not the house shelf
        setEntries(list)
        // A TAB IS A CONTEXT (Galen): switching shelves doesn't carry the last
        // tab's game — if the frame's world isn't ON this shelf, the shelf's
        // first world loads. (Never on the FIRST load — deep links keep their w.)
        if (prevTabRef.current !== null && prevTabRef.current !== tab && list.length > 0 && !list.some(e => e.scene === scene)) {
          setScene(list[0].scene)
        }
        prevTabRef.current = tab
      })
      .catch(() => { setEntries(tab === 'mine' || tab === 'premium' || tab === 'unfinished' || tab === 'forked' || tab === 'mobile' || tab === 'desktop' ? [] : LOCAL); prevTabRef.current = tab })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])
  useEffect(() => {
    fetch('/api/spaces/icons').then(r => r.json())
      .then((d: { icons?: Array<{ name: string; png: string }> }) => {
        const m = new Map<string, string>()
        for (const it of d.icons ?? []) m.set(it.name.toLowerCase(), `data:image/png;base64,${it.png}`)
        setIcons(m)
      }).catch(() => { /* letter tiles */ })
  }, [])
  // SEARCH is a persistent filter over the ACTIVE tab (Galen), not its own tab
  const shown = useMemo(() =>
    q.trim()
      ? entries.filter(e => e.name.toLowerCase().includes(q.trim().toLowerCase()))
      : entries,
  [entries, q])

  // linkable state
  useEffect(() => {
    try {
      const u = new URL(window.location.href)
      const w = u.searchParams.get('w'); if (w) setScene(w)
      const s = u.searchParams.get('ui') as UiSet | null; if (s && ['games', 'main', 'engine', 'create'].includes(s)) setUiSet(s)
      if (u.searchParams.get('ph') === 'play') setPhase('play')
      // arrivals like "ask in the commons ↗": MAIN with the window already open
      if (u.searchParams.get('chat') === '1' && s === 'main') {
        chatIntentRef.current = Date.now()
        setChatOpen(true)
        u.searchParams.delete('chat'); window.history.replaceState(null, '', u.toString())
      }
      // CONNECT INTENT (Galen: "lost copy prompt"): a freshly-built world arrives
      // as ?connect=1 — open the ENGINE ⚿ CONNECT AI tab so its paste-prompt +
      // copy button are right there, no hunting.
      if (u.searchParams.get('connect') === '1') {
        setUiSet('engine'); setTool('connect')
        u.searchParams.delete('connect'); window.history.replaceState(null, '', u.toString())
      }
    } catch { /* ssr */ }
  }, [])
  // PUSH (not replace) so the BROWSER BACK BUTTON backs out to the previously
  // viewed thing (Galen) — world→world, browse→play, set→set are all history.
  const firstSyncRef = useRef(true)
  const giRef = useRef(0)   // how deep the grid's OWN history goes — the ◂ floor
  useEffect(() => {
    try {
      const u = new URL(window.location.href)
      // MAIN is not a game — its URL names no world (Galen); the parked game
      // stays in memory and returns with the set.
      if (uiSet === 'main') u.searchParams.delete('w'); else u.searchParams.set('w', scene)
      u.searchParams.set('ui', uiSet)
      if (phase === 'play') u.searchParams.set('ph', 'play'); else u.searchParams.delete('ph')
      if (u.toString() === window.location.href) return
      if (firstSyncRef.current) window.history.replaceState({ gi: 0 }, '', u.toString())   // normalizing the arrival is not a step
      else { giRef.current += 1; window.history.pushState({ gi: giRef.current }, '', u.toString()) }
    } catch { /* fine */ }
    finally { firstSyncRef.current = false }
  }, [scene, uiSet, phase])
  // back/forward → restore the viewed thing from the URL
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      try {
        giRef.current = (e.state as { gi?: number } | null)?.gi ?? 0
        const u = new URL(window.location.href)
        const w = u.searchParams.get('w'); if (w) setScene(w)
        const ui = u.searchParams.get('ui') as UiSet | null
        setUiSet(ui && ['games', 'main', 'engine', 'create'].includes(ui) ? ui : 'games')
        setPhase(u.searchParams.get('ph') === 'play' ? 'play' : 'browse')
      } catch { /* fine */ }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // ── THE INSET — one function, CLAMPED (a window mid-resize can never smash
  // the frame below MIN_W×MIN_H — it holds shape until there's room) ──
  const browsing = uiSet === 'games' && phase === 'browse'
  const engineSet = uiSet === 'engine'
  const createSet = uiSet === 'create'
  const narrow = win.w < 700                      // the dock becomes a BOTTOM SHEET on narrow screens
  const dockBottomH = 168                          // narrow engine dock height
  // GAMES-browse, ENGINE and CREATE share the shrink-to-top layout — except a
  // CREATE PLAYTEST (phase 'play' inside create), which goes full-frame at the
  // declared shape while keeping create's context and clean bar.
  const miniTop = browsing || engineSet || (createSet && phase !== 'play')
  const inset = useMemo<Inset>(() => {
    const W = Math.max(win.w, MIN_W + M * 2), H = Math.max(win.h, MIN_H + M + BAR_H + 10)
    // MOBILE IS MOBILE (Galen): a mobile-declared world wears a PHONE-SHAPED
    // frame on desktop too — full-frame play AND the mini frame. CREATE's
    // ▯ MOBILE facet declares the same shape while brewing.
    const mobileWorld = (createSet && createShape === 'mobile') || spc?.device === 'mobile'
    const availH = H - M - BAR_H - 10
    if (!miniTop) {
      if (mobileWorld) {
        // full-frame play, portrait — the frame CONFORMS to the world's 9:16
        // (GRID ≡ VIEWPORT, Galen Aug 31): on a phone taller than 9:16 the
        // width clamps w, so h must follow w — a full-height frame there is no
        // longer 9:16 and the world's rect crops under cover. Extra device
        // height centers the frame; chrome owns the leftover bands, never
        // dead world-space.
        const w = Math.max(MIN_W, Math.min(availH * (9 / 16), W - M * 2))
        const h = Math.min(availH, w * (16 / 9))
        const spare = Math.max(0, availH - h)
        const left = Math.max((W - w) / 2, M)
        return { top: M + spare / 2, right: Math.max(W - left - w, M), bottom: BAR_H + 10 + spare / 2, left }
      }
      return { top: M, right: M, bottom: BAR_H + 10, left: M }
    }
    const aspect = mobileWorld ? 9 / 16 : 16 / 10
    let w = (W - M * 2) * (aspect < 1 ? 0.18 : 0.42), h = w / aspect
    const hMax = availH * (aspect < 1 ? 0.52 : 0.4)
    if (h > hMax) { h = hMax; w = h * aspect }
    w = Math.max(w, MIN_W); h = Math.max(h, MIN_H)
    const left = Math.max((W - w) / 2, M)
    return { top: M, right: Math.max(W - left - w, M), bottom: Math.max(H - M - h, BAR_H + 10), left }
  }, [miniTop, win, createSet, createShape, spc])

  // (the synthetic-resize ease loop is GONE — Galen: "why do we need a sizing
  // loop at all?" The engine now re-fits itself through a persistent
  // ResizeObserver on its canvas, which fires on every real layout change —
  // including this frame's 0.32s CSS ease. Dispatching ~60 fake resize events
  // a second from here was the site-wide jitter.)


  useEffect(() => {
    const on = (e: Event) => setAiLog(((e as CustomEvent).detail ?? []) as typeof aiLog)
    window.addEventListener('cafe:ai-log', on)
    try { window.dispatchEvent(new Event('cafe:ai-log-pull')) } catch { /* ssr */ }
    return () => window.removeEventListener('cafe:ai-log', on)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const lastEyeRef = useRef('')
  useEffect(() => {
    // DEDUPED: the engine publishes on a steady beat even when nothing changed;
    // setting fresh-but-identical objects re-rendered the whole under-area at
    // publish rate — the PUBLISH buttons never held still long enough for a
    // human press+release to land on the same node (Galen: 'not clickable').
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail ?? null
      let sig = ''
      try { sig = JSON.stringify(d) } catch { sig = String(Math.random()) }
      if (sig === lastEyeRef.current) return
      lastEyeRef.current = sig
      setEyeData(d)
    }
    window.addEventListener('cafe:eye', on)
    return () => window.removeEventListener('cafe:eye', on)
  }, [])
  // ◆ YOUR ICON on MAIN — the shell used to feed this: fetch the brewed icon,
  // stash it on window.__cafeIcon, ping 'cafe:icon' so the engine swaps the
  // glyph module (wd.__glyphOn) and the main_glyph hook packs it at the tail.
  // Fast poll while the brew panel is open so an AI-set icon lands live.
  useEffect(() => {
    if (uiSet !== 'main') return
    let stop = false
    const look = () => {
      if (document.hidden) return
      fetch('/api/engine/player-icon').then(r => (r.ok ? r.json() : null)).then(d => {
        if (stop) return
        const icon = d?.icon && typeof d.icon.fx === 'number'
          ? { fx: d.icon.fx, hue: d.icon.hue ?? 0.55, size: d.icon.size ?? 1, wgsl: typeof d.icon.wgsl === 'string' ? d.icon.wgsl : undefined }
          : { fx: 5, hue: 0.55, size: 1 }
        ;(window as unknown as { __cafeIcon?: typeof icon }).__cafeIcon = icon
        window.dispatchEvent(new CustomEvent('cafe:icon'))
      }).catch(() => { /* signed out — default cursor */ })
    }
    look()
    const iv = setInterval(look, brewIconOpen ? 3000 : 20000)
    return () => { stop = true; clearInterval(iv) }
  }, [uiSet, brewIconOpen])

  // ● REC — the engine mirrors recorder state; the bar button reads it
  useEffect(() => {
    const on = (e: Event) => setRec(((e as CustomEvent).detail ?? { on: false, secs: 0 }) as { on: boolean; secs: number })
    window.addEventListener('cafe:rec', on)
    return () => window.removeEventListener('cafe:rec', on)
  }, [])
  // entering ENGINE or CREATE arms the engine's eye-watch (after the transition
  // hygiene) — CREATE needs the config publish too (forkable/owner feed the fork
  // card). spc is a dep: a space mount arrives LATE (after its fetch resolves) —
  // the arm must re-fire once the real engine exists, or config never publishes.
  useEffect(() => {
    if (!engineSet && !createSet) return
    const fire = () => { try { window.dispatchEvent(new CustomEvent('cafe:shell-cmd', { detail: 'eye' })) } catch { /* ssr */ } }
    const t = setTimeout(fire, 50)
    const t2 = setTimeout(fire, 1200)   // belt: survives a slow first mount
    return () => { clearTimeout(t); clearTimeout(t2) }
  }, [engineSet, createSet, scene, spc])

  // (mobile games-only coercion REVERSED — Galen, Aug 28 pm: create/engine/
  // main ride the dockstar on phones too.)

  // ✦ THE PREMIUM GATE (Galen): a premium world PREVIEWS free in the frame;
  // clicking the frame to PLAY while unpaid opens payment (Stripe, saved to
  // the account via the experience entitlement) — once owned, the same click
  // just opens it. Server truth: /api/premium (price read server-side).
  const [premGate, setPremGate] = useState<null | { slug: string; usd: number; signedIn: boolean; buyable: boolean; busy?: boolean; err?: string }>(null)
  // ▭ THE BIG-SCREEN NOTICE (Galen, Aug 30): a desktop-built game opened on a
  // small screen warns "come back on desktop" — with a play-anyway escape.
  // Acked per-slug so it shows once per world, not every remount.
  const [bigScreenAck, setBigScreenAck] = useState<string | null>(null)
  const tryPlay = useCallback(async () => {
    // CREATE PLAYTEST (Galen, Aug 31): clicking into the world while creating
    // stays IN the create context — full frame at the world's declared shape
    // (mobile = portrait via createShape, no dependence on a persisted
    // deviceConfig), create's clean bar. No games-play chrome (REC /
    // instructions / share) and no premium gate on a world you're brewing.
    if (uiSet === 'create') { setPhase('play'); return }
    if (scene.startsWith('space:')) {
      const slug = scene.slice(6)
      // BOUND THE GATE READ: opening a world must not block on the DB. When another
      // user live-edits a heavy world, their snapshot writes can saturate the shared
      // connection pool and this /api/premium read would otherwise hang (up to the
      // 15s pg connect timeout), freezing the expand. Cap it: if the gate doesn't
      // answer fast, OPEN optimistically — the belt effect below re-checks premium
      // the moment the DB recovers and bounces an unowned premium world to browse.
      try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 1000)
        const d = await fetch(`/api/premium?slug=${encodeURIComponent(slug)}`, { signal: ctrl.signal })
          .then(r => r.json())
          .finally(() => clearTimeout(t))
        if (d?.premium && !d.owned) { setPremGate({ slug, usd: d.premium.usd, signedIn: !!d.signedIn, buyable: !!d.buyable }); return }
      } catch { /* gate slow/unreachable — open now; the belt effect re-gates */ }
    }
    setUiSet('games'); setPhase('play')
  }, [scene, uiSet])
  // BELT: a deep link straight to ?ph=play can't skip the gate. A CREATE
  // PLAYTEST is exempt — you're brewing on a base, not entering a sold world.
  useEffect(() => {
    if (phase !== 'play' || uiSet === 'create' || !scene.startsWith('space:')) return
    const slug = scene.slice(6)
    let dead = false
    fetch(`/api/premium?slug=${encodeURIComponent(slug)}`).then(r => r.json()).then(d => {
      if (!dead && d?.premium && !d.owned) { setPhase('browse'); setPremGate({ slug, usd: d.premium.usd, signedIn: !!d.signedIn, buyable: !!d.buyable }) }
    }).catch(() => { /* free default */ })
    return () => { dead = true }
  }, [phase, scene, uiSet])
  // sign-in return (?buy=<slug>): the account was just created for THIS
  // purchase (Galen: account before payment, critical) — reopen the gate with
  // BUY live instead of dropping the player on the shelf to re-find the world.
  useEffect(() => {
    const u = new URL(window.location.href)
    const want = u.searchParams.get('buy')
    if (!want || !scene.startsWith('space:') || scene.slice(6) !== want) return
    let dead = false
    fetch(`/api/premium?slug=${encodeURIComponent(want)}`).then(r => r.json()).then(d => {
      if (dead) return
      u.searchParams.delete('buy'); window.history.replaceState(null, '', u.toString())
      if (d?.premium && !d.owned) setPremGate({ slug: want, usd: d.premium.usd, signedIn: !!d.signedIn, buyable: !!d.buyable })
      else { setUiSet('games'); setPhase('play') }   // owned (or free) — just open it
    }).catch(() => { /* gate unreachable — leave them browsing */ })
    return () => { dead = true }
  }, [scene])

  // checkout return (?paid=experience): the webhook may land a beat later — poll
  useEffect(() => {
    const u = new URL(window.location.href)
    if (u.searchParams.get('paid') !== 'experience' || !scene.startsWith('space:')) return
    const slug = scene.slice(6)
    let tries = 0
    const iv = setInterval(async () => {
      tries++
      try {
        const d = await fetch(`/api/premium?slug=${encodeURIComponent(slug)}`).then(r => r.json())
        if (d?.owned || !d?.premium) {
          clearInterval(iv); setPremGate(null)
          u.searchParams.delete('paid'); window.history.replaceState(null, '', u.toString())
          setUiSet('games'); setPhase('play')
        }
      } catch { /* keep polling */ }
      if (tries > 20) clearInterval(iv)
    }, 2000)
    return () => clearInterval(iv)
  // scene is the dep: on a checkout return the URL-restore effect sets ?w=
  // AFTER mount — polling must start once the space is actually in the frame
  }, [scene])

  const pick = useCallback((e: Entry) => setScene(e.scene), [])

  // TRANSITION HYGIENE (Galen: builderbox stuck open from engine → play): any
  // set/phase change closes the engine's panels — nothing follows you through.
  // an arrival (?chat=1) opens the commons in the SAME transition this hygiene
  // would close it — the one-shot intent lets that window through.
  const chatIntentRef = useRef(0)   // timestamp — survives the mount run AND the arrival's set-change run
  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent('cafe:shell-cmd', { detail: 'closepanels' })) } catch { /* ssr */ }
    setConnectOpen(false); setInstrOpen(false); setAttribOpen(false); setBrewIconOpen(false)
    if (Date.now() - chatIntentRef.current > 3000) setChatOpen(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiSet, phase])
  const selected = entries.find(e => e.scene === scene) ?? LOCAL.find(e => e.scene === scene)

  // instructions for the selected world
  useEffect(() => {
    if (!instrOpen) return
    const load = async () => {
      try {
        if (scene.startsWith('space:')) {
          const d = await fetch(`/api/spaces/${encodeURIComponent(scene.slice(6))}/snapshot`).then(r => r.json())
          const t = d?.snapshot?.worldData?.instructions
          setInstrText(typeof t === 'string' && t.trim() ? t : 'No instructions yet.')
        } else {
          const d = await fetch(`/cartridges/${encodeURIComponent(scene)}.json`).then(r => r.json())
          const wd = d?.snapshot?.worldData ?? d?.worldData ?? {}
          setInstrText(typeof wd.instructions === 'string' && wd.instructions.trim() ? wd.instructions : 'No instructions yet.')
        }
      } catch { setInstrText('Could not load instructions.') }
    }
    setInstrText('…'); load()
  }, [instrOpen, scene])

  // ⚿ CONNECT — the REAL flow (Galen: 'not what it used to be'): mint a world
  // BUILD KEY on the space, then bake it into the briefing prompt the old
  // engine used (worldBriefingPrompt). No key ⇒ the AI has nothing to build
  // with — the whole point. Minted lazily when the CONNECT surface opens.
  const [plugToken, setPlugToken] = useState<string | null>(null)
  const [plugErr, setPlugErr] = useState<string>('')
  const plugSlugRef = useRef<string>('')
  const wantConnect = connectOpen || tool === 'connect'
  useEffect(() => {
    if (!wantConnect) return
    const slug = scene.startsWith('space:') ? scene.slice(6) : null
    if (!slug) { setPlugToken(null); setPlugErr('house cartridge — fork or brew a world of your own to connect an AI to it.'); return }
    if (plugSlugRef.current === slug && plugToken) return   // already minted for this world
    plugSlugRef.current = slug
    setPlugToken(null); setPlugErr('')
    fetch(`/api/spaces/${encodeURIComponent(slug)}/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'AI agent' }),
    }).then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (ok && d?.token) setPlugToken(d.token as string)
        else setPlugErr(d?.error === 'Unauthorized' || !d ? 'sign in as the owner to mint a build key for this world.' : (d?.error || 'could not mint a build key'))
      })
      .catch(() => setPlugErr('could not mint a build key — offline?'))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantConnect, scene])
  const connectPrompt = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin.replace('localhost:3131', 'cartridge.cafe') : 'https://cartridge.cafe'
    if (!plugToken) return ''
    // Opening a world DIRECTLY (by URL) leaves `selected` null, so the prompt
    // used to say the literal "my world" (Galen: nocturne "says my world").
    // Fall back to the resolved space's real name before that generic default.
    const worldName = selected?.name ?? spc?.name ?? spaceInfo?.name ?? 'my world'
    return worldBriefingPrompt({ token: plugToken, worldName, origin })
  }, [plugToken, selected, spc, spaceInfo])

  // cfg with STABLE IDENTITY: even when other eye fields churn (a live world's
  // graph changes every tick), the owner views' props only change when the
  // CONFIG content does — with React.memo below, their DOM holds still.
  const cfgKey = useMemo(() => { try { return JSON.stringify(eyeData?.config ?? null) } catch { return '' } }, [eyeData])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cfgStable = useMemo(() => eyeData?.config ?? null, [cfgKey])

  const sceneIsSpace = scene.startsWith('space:')
  const crewJoin = useCallback((sc: string) => { setScene(sc); setTool('connect') }, [])
  const openAssets = useCallback(() => setTool('assets'), [])
  const pickScene = useCallback((sc: string) => setScene(sc), [])

  const shelfTop = win.h - inset.bottom + 12
  const cmd = (c: string) => { try { window.dispatchEvent(new CustomEvent('cafe:shell-cmd', { detail: c })) } catch { /* ssr */ } }

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #0c0b14, #050509)' }}>
      {/* SPACE mount = the real thing (saves/sync/versions/tokens live); house
          cartridges keep the stable hot-swap mount. A space remounts per slug
          (the space path loads once, at birth). While a space resolves (~one
          fetch) the frame holds dark — the same threshold-black as a world swap.
          MAIN overrides the frame with MAIN-COMMONS: the ORIGINAL main's star
          background + glyph seats (cf_world), with the cafe_door hook stripped
          — that hook drew the bubbles/sub-main/player-world doors AND froze on
          click (Galen: out for now). presenceKey keeps the ONE commons room so
          player icons live. Leaving MAIN restores your game pick. */}
      {uiSet === 'main'
        ? <FieldEngine key="house" playScene="MAIN-COMMONS" presenceKey="CAFE" hooksTrusted viewport={inset} externalTopbar />
        : spc
          ? <FieldEngine key={'space-' + spc.slug + '-' + (spc.gridSize ?? 0)} spaceId={spc.id} spaceSlug={spc.slug} spaceName={spc.name}
              spaceOwnerName={spc.ownerName} spaceOwnerId={spc.ownerId} isOwner={spc.isOwner} forkable={spc.forkable}
              gridSize={spc.gridSize ?? undefined} viewport={inset} externalTopbar />
          : !spaceResolving && <FieldEngine key="house" playScene={scene} hooksTrusted viewport={inset} externalTopbar />}

      {/* THE FRAME */}
      <div className="fixed pointer-events-none z-[110]"
        style={{
          top: inset.top, right: inset.right, bottom: inset.bottom, left: inset.left,
          border: '1px solid rgba(80,200,255,0.45)', borderRadius: 10,
          boxShadow: '0 0 0 1px rgba(0,0,0,0.6), inset 0 0 40px rgba(0,0,0,0.35)',
          transition: EASE,
        }}>
        {([['top', 'left'], ['top', 'right'], ['bottom', 'left'], ['bottom', 'right']] as const).map(([v, h]) => (
          <span key={v + h} aria-hidden style={{
            position: 'absolute', width: 22, height: 22, [v]: -1, [h]: -1,
            [`border${v[0].toUpperCase() + v.slice(1)}`]: '2px solid rgba(255,190,60,0.9)',
            [`border${h[0].toUpperCase() + h.slice(1)}`]: '2px solid rgba(255,190,60,0.9)',
            [`border${v[0].toUpperCase() + v.slice(1)}${h === 'left' ? 'Left' : 'Right'}Radius`]: 10,
          } as React.CSSProperties} />
        ))}
      </div>

      {/* CLICK THE FRAME TO PLAY (games·browse) */}
      {browsing && (
        <button aria-label={`play ${selected?.name ?? ''}`} onClick={() => void tryPlay()}
          className="fixed z-[115] group cursor-pointer"
          style={{ top: inset.top, right: inset.right, bottom: inset.bottom, left: inset.left, background: 'transparent', border: 'none', transition: EASE }}>
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 max-w-[calc(100%-20px)] truncate whitespace-nowrap font-mono text-[11px] tracking-[0.2em] px-2.5 py-1 rounded-lg bg-black/70 border border-amber-300/60 text-amber-200 group-hover:bg-amber-400/20 group-hover:text-amber-100 transition-colors">
            ▶ CLICK TO PLAY{selected?.name ? ` — ${selected.name}` : ''}
          </span>
        </button>
      )}

      {/* ═ THE ICON SHELF (games·browse) ═ */}
      {browsing && (
        <div className="fixed inset-x-0 z-[112] flex flex-col items-center gap-3 px-4 overflow-y-auto"
          style={{ top: shelfTop, bottom: BAR_H + 6 }}>
          {/* TAB ROW — ◉ LIVE EDITING hooks people · FREE GAMES · PREMIUM · … */}
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-center">
            {([['mobile', '📱 MOBILE EDITABLE'], ['desktop', '🖥 DESKTOP EDITABLE'], ['premium', '✦ PREMIUM']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`font-mono text-[11.5px] tracking-[0.18em] px-3 py-1 rounded-lg border transition-colors ${
                  tab === k ? 'bg-emerald-400/15 border-emerald-300/50 text-emerald-100' : 'bg-black/40 border-white/10 text-white/50 hover:text-white/70'}`}>
                {label}
              </button>
            ))}
          </div>
          {/* SEARCH — always visible under the tabs (Galen); filters the active tab */}
          <div className="relative shrink-0 w-full max-w-[320px]">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-white/45">⌕</span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="search games…"
              className="font-mono text-[12px] w-full pl-8 pr-8 py-1.5 rounded-lg bg-black/50 border border-white/12 text-white/85 placeholder:text-white/35 outline-none focus:border-sky-300/50 transition-colors" />
            {q && (
              <button onClick={() => setQ('')} aria-label="clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 grid place-items-center rounded text-white/50 hover:text-white hover:bg-white/10 text-[13px]">✕</button>
            )}
          </div>
          {/* the icons — contextual empties show only when NOT searching (a
              search miss shows the "nothing matches" line below instead) */}
          {tab === 'mine' && !q.trim() && shown.length === 0 && (
            <div className="font-mono text-[12px] text-white/55 py-6 text-center">no worlds on your deed yet — sign in, or brew one at /create.</div>
          )}
          {tab === 'premium' && !q.trim() && shown.length === 0 && (
            <div className="font-mono text-[12px] text-white/55 py-6 text-center">no premium worlds yet.</div>
          )}
          {tab === 'unfinished' && !q.trim() && shown.length === 0 && (
            <div className="font-mono text-[12px] text-white/55 py-6 text-center">nothing on the workbench shelf.</div>
          )}
          {tab === 'forked' && !q.trim() && shown.length === 0 && (
            <div className="font-mono text-[12px] text-white/55 py-6 text-center">no forked worlds published yet — fork a world and publish it to land it here.</div>
          )}
          <div className="grid gap-3 w-full max-w-[980px] pb-2"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))' }}>
            {shown.map(e => {
              const ic = icons.get(e.slug.toLowerCase()) ?? icons.get(e.name.toLowerCase())
              const on = scene === e.scene
              return (
                <button key={e.slug} onClick={() => pick(e)}
                  className={`group rounded-2xl border overflow-hidden text-left transition-colors ${
                    on ? 'border-sky-300/70 bg-sky-400/10' : 'border-white/10 bg-black/40 hover:border-white/30'}`}>
                  <div className="aspect-square w-full grid place-items-center overflow-hidden"
                    style={{ background: 'linear-gradient(160deg, #141224, #0a0913)' }}>
                    {ic
                      ? <img src={ic} alt="" className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform" />
                      : <span className="font-mono text-[34px] text-white/35">{e.name[0]}</span>}
                  </div>
                  <div className={`font-mono text-[11.5px] tracking-[0.1em] px-2.5 py-2 truncate ${on ? 'text-sky-100' : 'text-white/70'}`}>
                    {e.name}
                  </div>
                </button>
              )
            })}
            {q.trim() && shown.length === 0 && (
              <div className="col-span-full font-mono text-[12px] text-white/40 text-center py-6">nothing matches “{q}”</div>
            )}
          </div>
        </div>
      )}

      {/* CLICK THE FRAME → PLAY, in ENGINE too (the world is always the play
          button — the universal law). While ◎ INSPECT is on, the frame yields:
          clicks must reach the canvas to document what's under them. */}
      {(engineSet || (createSet && phase !== 'play')) && !eyeData?.inspect?.on && (
        <button aria-label={`play ${selected?.name ?? ''}`} onClick={() => void tryPlay()}
          className="fixed z-[114] group cursor-pointer"
          style={{ top: inset.top, right: inset.right, bottom: inset.bottom, left: inset.left, background: 'transparent', border: 'none', transition: EASE }}>
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 max-w-[calc(100%-20px)] truncate whitespace-nowrap font-mono text-[11px] tracking-[0.2em] px-2.5 py-1 rounded-lg bg-black/70 border border-amber-300/60 text-amber-200 group-hover:bg-amber-400/20 group-hover:text-amber-100 transition-colors">
            ▶ CLICK TO PLAY{selected?.name ? ` — ${selected.name}` : ''}
          </span>
        </button>
      )}

      {/* ═ THE CREATE UNDER-AREA — contextual: the world in the frame is the
          default BASE (fork it into yours) · or brew from nothing (/create).
          Hidden during a CREATE PLAYTEST — the full frame owns the screen. ═ */}
      {createSet && phase !== 'play' && (
        <div className="fixed inset-x-0 z-[112] flex justify-center px-4 overflow-y-auto"
          style={{ top: shelfTop, bottom: BAR_H + 6 }}>
          <CreateView
            baseName={selected?.name ?? scene}
            baseSlug={scene.startsWith('space:') ? scene.slice(6) : null}
            forkable={scene.startsWith('space:') ? (!!eyeData?.config?.forkable || !!eyeData?.config?.isOwner) : true}
            onForked={slug => { setScene('space:' + slug); setUiSet('engine') }}
            onBrew={() => setScene('BLANK')}
          />
        </div>
      )}

      {/* THE UI SELECTOR — field-bounded overlay; + ACCOUNT (Galen). z ABOVE
          the commons window: opening the menu layers over it, closing returns
          to it (Galen: dockstar must not kill the commons). */}
      {selOpen && (
        // items-start + overflow-y-auto: on a phone the option cards are taller
        // than the frame — center-align clipped them (Galen: "menu options
        // overwhelm space"). Now the menu SCROLLS from the top instead.
        <div className="fixed z-[128] flex items-start justify-center overflow-y-auto backdrop-blur-sm"
          style={{ top: M, right: M, bottom: BAR_H + 10, left: M, background: 'rgba(5,6,12,0.86)', borderRadius: 10 }}
          onClick={() => setSelOpen(false)}>
          <div className="p-3 sm:p-4 w-full max-w-[520px] my-auto" onClick={e => e.stopPropagation()}>
          {/* THE BRAND — the real sign (the cup + the cafe-sign wordmark, same
              as the masthead) + the line that says what this place IS (Galen) */}
          <div className="flex flex-col items-center mb-3 sm:mb-4">
            <div className="flex items-center justify-center gap-2.5">
              <img src="/cartridge-cup.svg" alt="" className="w-8 h-8 sm:w-9 sm:h-9 -mt-0.5" />
              <h1 className="cafe-sign text-[22px] sm:text-[24px] leading-none">cartridge<span className="not-italic font-mono text-[15px] sm:text-[16px] text-brass">.cafe</span></h1>
            </div>
            <div className="font-mono text-[9.5px] sm:text-[10.5px] tracking-[0.18em] text-white/55 mt-1.5 sm:mt-2 text-center px-2">INSTANT NATURAL LANGUAGE TO GAME WORLD FRAMEWORK</div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            {([
              ['games', '▶', 'GAMES', 'browse the shelf — click the frame to play'],
              ['main', '◉', 'MAIN', 'the commons + social space'],
              ['engine', '⚙', 'ENGINE', 'builderbox · connect your AI · world tools'],
              ['create', '✚', 'CREATE', 'new world · fork from grid'],
            ] as const).map(([k, icon, label, sub]) => (
              <button key={k}
                onClick={() => { setUiSet(k); if (k === 'games' || k === 'create') setPhase('browse'); setSelOpen(false) }}
                className={`text-left rounded-2xl border p-3 sm:p-4 transition-colors active:bg-white/10 ${
                  uiSet === k ? 'border-amber-300/60 bg-amber-400/10' : 'border-white/12 bg-black/40 hover:border-white/25'}`}>
                <div className={`text-[18px] sm:text-[22px] mb-0.5 sm:mb-1 ${uiSet === k ? 'text-amber-200' : 'text-white/70'}`}>{icon}</div>
                <div className={`font-mono text-[13px] sm:text-[14px] tracking-[0.2em] ${uiSet === k ? 'text-amber-100' : 'text-white/90'}`}>{label}</div>
                <div className="font-mono text-[10px] sm:text-[11px] text-white/50 mt-0.5 sm:mt-1 leading-snug">{sub}</div>
              </button>
            ))}
            {isAdmin && (
              <a href="/admin" data-grid-admin
                className="col-span-2 text-left rounded-2xl border border-amber-300/25 bg-black/40 hover:border-amber-300/50 p-4 transition-colors flex items-center gap-3">
                <span className="text-[20px] text-amber-200/80">⛨</span>
                <span>
                  <span className="font-mono text-[14px] tracking-[0.2em] text-amber-100/95 block">ADMIN</span>
                  <span className="font-mono text-[11px] text-white/50">every world (private too) · visibility · analytics</span>
                </span>
              </a>
            )}
            {/* ✚ BUILD CREDITS — count + buy anytime (Galen). Signed-out → sign in. */}
            <div data-grid-credits
              className="text-left rounded-2xl border border-white/12 bg-black/40 p-4 flex flex-col justify-between">
              <div>
                <div className="font-mono text-[12px] tracking-[0.2em] text-white/70">✚ BUILD CREDITS</div>
                <div className="font-mono text-[20px] text-amber-100 mt-1 tabular-nums">
                  {wallet ? (wallet.free ? '∞' : wallet.credits) : '·'}
                  <span className="text-[11px] text-white/50 ml-1.5">{wallet?.free ? 'keeper' : 'world births'}</span>
                </div>
              </div>
              {me ? (wallet?.buyable && !wallet.free && (
                <div className="mt-3">
                  <div className="flex gap-1 mb-2">
                    {[1, 3, 5, 10].map(q => (
                      <button key={q} onClick={() => setBuyQty(q)}
                        className={`flex-1 py-1 rounded-lg border font-mono text-[11px] tabular-nums transition-colors ${
                          buyQty === q ? 'border-amber-300/60 bg-amber-400/15 text-amber-100' : 'border-white/10 text-white/55 hover:border-white/25'}`}>
                        ×{q}
                      </button>
                    ))}
                  </div>
                  {(() => {
                    const total = wallet.bundles[buyQty] ?? wallet.genUsd * buyQty
                    const saved = wallet.genUsd * buyQty - total
                    return (
                      <button onClick={() => startCheckout('credit')} disabled={buying !== ''}
                        className="w-full py-2 rounded-xl border border-amber-300/50 bg-amber-400/15 text-amber-100 font-mono text-[12px] tracking-[0.15em] hover:bg-amber-400/25 transition-colors disabled:opacity-50">
                        {buying === 'credit' ? 'OPENING…' : (
                          <>BUY {buyQty} · ${total}{saved > 0 && <span className="text-emerald-200/90 tracking-normal"> · save ${saved}</span>}</>
                        )}
                      </button>
                    )
                  })()}
                  <div className="font-mono text-[10px] text-white/45 mt-1.5 text-center">bring your own AI to build · credits never expire</div>
                </div>
              )) : (
                <a href={'/auth/signin?callbackUrl=' + encodeURIComponent('/grid')}
                  className="mt-3 w-full py-2 rounded-xl border border-white/15 bg-white/5 text-white/70 font-mono text-[12px] tracking-[0.15em] text-center hover:bg-white/10 transition-colors">
                  SIGN IN TO BUY
                </a>
              )}
            </div>
            {/* ⚡ LIVE EDIT — the $10/mo membership behind the live edit button */}
            <div data-grid-membership
              className="text-left rounded-2xl border border-white/12 bg-black/40 p-4 flex flex-col justify-between">
              <div>
                <div className="font-mono text-[12px] tracking-[0.2em] text-white/70">⚡ LIVE EDIT</div>
                <div className={`font-mono text-[14px] mt-1.5 ${wallet?.member ? 'text-emerald-200' : 'text-white/80'}`}>
                  {wallet ? (wallet.member ? '✓ MEMBER' : 'build on open worlds') : '·'}
                </div>
              </div>
              {wallet?.member ? (
                <a href="/account"
                  className="mt-3 w-full py-2 rounded-xl border border-emerald-300/40 bg-emerald-400/10 text-emerald-100 font-mono text-[12px] tracking-[0.15em] text-center hover:bg-emerald-400/20 transition-colors">
                  MANAGE
                </a>
              ) : me ? (wallet?.buyable && (
                <div className="mt-3">
                  <button onClick={() => startCheckout('member')} disabled={buying !== ''}
                    className="w-full py-2 rounded-xl border border-emerald-300/50 bg-emerald-400/15 text-emerald-100 font-mono text-[12px] tracking-[0.15em] hover:bg-emerald-400/25 transition-colors disabled:opacity-50">
                    {buying === 'member' ? 'OPENING…' : `JOIN · $${wallet.memUsd}/mo`}
                  </button>
                  <div className="font-mono text-[10px] text-white/45 mt-1.5 text-center">bring your own AI to build</div>
                </div>
              )) : (
                <a href={'/auth/signin?callbackUrl=' + encodeURIComponent('/grid')}
                  className="mt-3 w-full py-2 rounded-xl border border-white/15 bg-white/5 text-white/70 font-mono text-[12px] tracking-[0.15em] text-center hover:bg-white/10 transition-colors">
                  SIGN IN TO JOIN
                </a>
              )}
            </div>
            {me ? (
            <a href="/account" data-grid-account
              className="col-span-2 text-left rounded-2xl border border-white/12 bg-black/40 hover:border-white/25 p-4 transition-colors flex items-center gap-3">
              <span className="text-[20px] text-emerald-300/80">◐</span>
              <span className="min-w-0 flex-1">
                <span className="font-mono text-[14px] tracking-[0.2em] text-white/90 block truncate">{me.name ?? me.email ?? 'SIGNED IN'}</span>
                <span className="font-mono text-[11px] text-white/50">account page — membership · purchases · sign out</span>
              </span>
              <span className="font-mono text-[14px] text-white/50 shrink-0">▸</span>
            </a>
            ) : (
            <a href={'/auth/signin?callbackUrl=' + encodeURIComponent('/grid')} data-grid-account
              className="col-span-2 text-left rounded-2xl border border-white/12 bg-black/40 hover:border-white/25 p-4 transition-colors flex items-center gap-3">
              <span className="text-[20px] text-white/70">◐</span>
              <span>
                <span className="font-mono text-[14px] tracking-[0.2em] text-white/90 block">ACCOUNT</span>
                <span className="font-mono text-[11px] text-white/50">sign in · membership</span>
              </span>
            </a>
            )}
          </div>
          </div>
        </div>
      )}

      {/* CONNECT AI — field-bounded, copyable prompt */}
      {connectOpen && (
        <div className="fixed z-[127] flex items-center justify-center backdrop-blur-sm"
          style={{ top: M, right: M, bottom: BAR_H + 10, left: M, background: 'rgba(5,6,12,0.88)', borderRadius: 10 }}
          onClick={() => setConnectOpen(false)}>
          <div className="w-full max-w-[560px] rounded-2xl border border-emerald-300/25 bg-[#0d120d]/97 p-5 m-4 font-mono" onClick={e => e.stopPropagation()}>
            <div className="text-[13px] tracking-[0.25em] text-emerald-200/80 mb-2">⚿ CONNECT YOUR AI</div>
            <p className="text-[12px] text-white/60 leading-relaxed mb-3">Paste this into your working AI (Claude, or any MCP agent) — it carries your world&rsquo;s build key, reads the guide, and builds with you.</p>
            {plugErr && <p className="text-[12px] text-amber-200/85 leading-relaxed mb-2">{plugErr}</p>}
            {!plugErr && !plugToken && <p className="text-[12px] text-white/55 mb-2">minting a build key…</p>}
            {plugToken && <>
              <div className="rounded-xl bg-black/60 border border-white/12 p-3 text-[12.5px] text-white/80 leading-relaxed select-all whitespace-pre-wrap max-h-[46vh] overflow-y-auto">{connectPrompt}</div>
              <button onClick={async () => { try { await navigator.clipboard.writeText(connectPrompt); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* manual */ } }}
                className="mt-3 w-full py-2.5 rounded-xl border border-emerald-300/50 bg-emerald-400/15 text-emerald-100 text-[13px] tracking-[0.18em] hover:bg-emerald-400/25 transition-colors">
                {copied ? '✓ COPIED — PASTE TO YOUR AI' : '⧉ COPY THE PROMPT (with your build key)'}
              </button>
              <p className="text-[11px] text-white/45 mt-2">this key IS write-access to this world — share only with your AI. Re-opening mints a fresh one.</p>
            </>}
          </div>
        </div>
      )}

      {/* INSTRUCTIONS — field-bounded */}
      {instrOpen && (
        <div className="fixed z-[127] flex items-center justify-center backdrop-blur-sm"
          style={{ top: M, right: M, bottom: BAR_H + 10, left: M, background: 'rgba(5,6,12,0.86)', borderRadius: 10 }}
          onClick={() => setInstrOpen(false)}>
          <div className="w-full max-w-[560px] max-h-[70%] overflow-y-auto rounded-2xl border border-white/12 bg-[#0d0c14]/97 p-5 m-4" onClick={e => e.stopPropagation()}>
            <div className="font-mono text-[13px] tracking-[0.25em] text-white/60 mb-2">? INSTRUCTIONS — {selected?.name}</div>
            <div className="font-mono text-[14px] leading-relaxed text-white/80 whitespace-pre-wrap">{instrText}</div>
          </div>
        </div>
      )}

      {/* ATTRIBUTION — the title's popup */}
      {attribOpen && (
        <div className="fixed z-[127] flex items-center justify-center backdrop-blur-sm"
          style={{ top: M, right: M, bottom: BAR_H + 10, left: M, background: 'rgba(5,6,12,0.86)', borderRadius: 10 }}
          onClick={() => setAttribOpen(false)}>
          <div className="w-full max-w-[420px] rounded-2xl border border-amber-300/25 bg-[#12100a]/97 p-5 m-4 font-mono" onClick={e => e.stopPropagation()}>
            <div className="text-[16px] tracking-[0.2em] text-white/95 mb-1">{selected?.name}</div>
            {selected?.maker && <div className="text-[13px] text-amber-200/85 mb-3">by {selected.maker}</div>}
            <AttribLineage scene={scene} />
          </div>
        </div>
      )}

      {/* ═ THE ENGINE UNDER-AREA — the grid shrinks to the top; the tools live
          BELOW it (Galen: nothing ever pops over the game). One tab row, one
          content area — the GAMES-browse pattern, engine-flavored. ═ */}
      {engineSet && (
        <div className="fixed inset-x-0 z-[112] flex flex-col items-center gap-2 px-4"
          style={{ top: shelfTop, bottom: BAR_H + 6 }}>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-center">
            {([['eye', '◈ EYE'], ['console', '⌁ CONSOLE'], ['nodes', '⬢ NODES'], ['assets', '◲ ASSETS'], ['crew', '⛭ CO-BUILD'], ['brain', '◧ BRAIN'], ['versions', '⏱ VERSIONS'], ['config', '⚙ CONFIG'], ['chat', '◉ CHAT'], ['mine', '⌂ MY WORLDS']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setTool(k)}
                className={`font-mono text-[11.5px] tracking-[0.18em] px-3 py-1 rounded-lg border transition-colors ${
                  tool === k ? 'bg-sky-400/15 border-sky-300/50 text-sky-100' : 'bg-black/40 border-white/10 text-white/55 hover:text-white/75'}`}>
                {label}
              </button>
            ))}
            <button onClick={() => setTool('connect')}
              className={`font-mono text-[11.5px] tracking-[0.18em] px-3 py-1 rounded-lg border transition-colors ${
                tool === 'connect' ? 'bg-emerald-400/20 border-emerald-300/70 text-emerald-100' : 'border-emerald-300/50 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20'}`}>
              ⚿ CONNECT AI
            </button>
          </div>
          {/* LIVE-EDIT worlds carry the EDITING MEMBERSHIP box (Galen): open
              building = $10/mo seat; play is always free. The banner shows the
              subscribe CTA to non-members, a quiet ✓ to members. */}
          {eyeData?.config?.policy === 'anyone' && (
            <div className="w-full max-w-[860px] shrink-0"><MembershipBanner /></div>
          )}
          <div className="w-full max-w-[860px] flex-1 min-h-0 rounded-2xl border border-white/10 bg-black/40 overflow-hidden">
            {tool === 'eye' && (
              <div className="w-full h-full flex flex-col p-4 font-mono">
                <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                  <span className="text-[11.5px] tracking-[0.2em] text-sky-200/70">◈ THE EYE — hand the AI your view</span>
                  <div className="flex items-center gap-2">
                    {/* ◎ INSPECT — click-telling: while ON, canvas clicks document
                        what's under them (wd.__clicks) for the AI; game input paused */}
                    <button onClick={() => cmd('inspect')}
                      className={`px-3 py-1.5 rounded-lg border text-[12px] tracking-[0.15em] transition-colors ${
                        eyeData?.inspect?.on ? 'bg-sky-500/25 border-sky-400/60 text-sky-100' : 'border-white/15 bg-black/40 text-white/70 hover:text-white'}`}>
                      {eyeData?.inspect?.on ? '◉ INSPECT ON' : '◎ INSPECT'}
                    </button>
                    <button onClick={() => { try { window.dispatchEvent(new CustomEvent('cafe:shell-cmd', { detail: 'snapshot' })) } catch { /* ssr */ } }}
                      className="px-3.5 py-1.5 rounded-lg border border-sky-300/50 bg-sky-400/10 text-sky-100 text-[12px] tracking-[0.15em] hover:bg-sky-400/20 transition-colors">
                      {eyeData?.shot === 'sending' ? '…' : eyeData?.shot === 'sent' ? '✓ SENT TO THE AI' : '📸 SNAPSHOT → AI'}
                    </button>
                  </div>
                </div>
                {eyeData?.focus?.action && (
                  <div className="text-[11.5px] text-white/70 mb-2">ai focus: <span className="text-emerald-200/90">{eyeData.focus.action}</span>{eyeData.focus.fieldName ? <span className="text-white/55"> · {eyeData.focus.fieldName}</span> : null}</div>
                )}
                <div className="relative flex-1 min-h-0 rounded-xl border border-white/12 bg-black/50 grid place-items-center overflow-hidden">
                  {eyeData?.eye?.png && (eyeData.eye.at ?? 1) > eyeCleared ? (
                    <>
                      <img src={`data:image/png;base64,${eyeData.eye.png}`.replace('base64,data:', '').replace('base64,i', 'base64,i')} alt="the eye" className="max-w-full max-h-full object-contain" />
                      <button data-eye-clear onClick={() => setEyeCleared(eyeData?.eye?.at ?? Date.now())}
                        title="clear this snapshot — the next probe or 📸 reappears on its own"
                        className="absolute top-2 right-2 px-2.5 py-1 rounded-lg border border-white/25 bg-black/70 text-white/75 text-[11.5px] tracking-[0.15em] hover:text-white hover:bg-black/85 transition-colors">
                        ✕ CLEAR
                      </button>
                    </>
                  ) : <span className="text-[12px] text-white/55 p-6 text-center">no image yet — 📸 sends your live frame to the connected AI over the bridge; its probes land here too.</span>}
                </div>
                {/* the INSPECT feed — every documented click, newest first */}
                {eyeData?.inspect?.on && (
                  <div className="mt-2 max-h-[30%] overflow-y-auto rounded-xl border border-sky-400/25 bg-black/50 p-2.5 text-[11.5px] leading-relaxed">
                    {!eyeData.inspect.log?.length && <div className="text-white/55">click anything in the world above — each click is documented for the AI (game input paused).</div>}
                    {[...(eyeData.inspect.log ?? [])].reverse().map((en, i) => (
                      <div key={i} className="py-0.5 border-b border-white/5 last:border-0 text-white/75">
                        <span className="text-sky-200/90">({en.x},{en.y})</span>
                        {en.color && <span className="ml-2" style={{ color: en.color }}>■ {en.color}</span>}
                        {en.field && <span className="text-white/65 ml-2">field {en.field}</span>}
                        {en.visual && <span className="text-emerald-200/80 ml-2">{en.visual}</span>}
                        {en.entity && <span className="text-amber-200/80 ml-2">entity #{en.entity.id}{en.entity.label ? ` ${en.entity.label}` : ''}</span>}
                        {en.ui && <span className="text-white/70 ml-2">ui {en.ui.id}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {tool === 'console' && (
              <div className="w-full h-full flex flex-col p-4 font-mono">
                <div className="text-[11.5px] tracking-[0.2em] text-emerald-200/70 mb-2">⌁ CONSOLE — the AI building, step by step</div>
                <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-white/12 bg-black/50 p-3 text-[12px] leading-relaxed">
                  {aiLog.length === 0 && <div className="text-white/55">no AI edits this session — connect an AI and every build step lands here, named and timed.</div>}
                  {aiLog.map((l, i) => (
                    <div key={i} className="flex gap-2 py-0.5 border-b border-white/5 last:border-0">
                      <span className="text-white/55 shrink-0">{new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                      <span className="text-emerald-200/90 shrink-0">{l.type}</span>
                      <span className="text-white/85 truncate">{l.summary}</span>
                      {l.author && <span className="text-amber-200/70 shrink-0 ml-auto">{l.author}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {tool === 'nodes' && <NodesViewM graph={eyeData?.graph ?? null} />}
            {tool === 'assets' && <AssetsViewM cfg={cfgStable} />}
            {tool === 'crew' && <CrewViewM icons={icons} current={scene} onJoin={crewJoin} />}
            {tool === 'versions' && <VersionsViewM cfg={cfgStable} />}
            {tool === 'publish' && <PublishViewM cfg={cfgStable} />}
            {tool === 'mine' && <MyWorldsViewM icons={icons} current={scene} onPick={pickScene} />}
            {tool === 'brain' && <BrainViewM />}
            {tool === 'config' && (
              <ConfigViewM cfg={cfgStable} sceneIsSpace={sceneIsSpace} onAssets={openAssets} />
            )}
            {tool === 'chat' && (
              <GridChat inline slotKey={'world-chat:' + (scene.startsWith('space:') ? scene.slice(6).toUpperCase() : scene)} title={selected?.name ?? 'THIS WORLD'} />
            )}
            {tool === 'connect' && (
              <div className="w-full h-full overflow-y-auto p-4 font-mono">
                <div className="text-[11.5px] tracking-[0.2em] text-emerald-200/80 mb-2">⚿ CONNECT YOUR AI</div>
                <p className="text-[12px] text-white/70 leading-relaxed mb-3">Paste this into your working AI (Claude, or any MCP agent) — it carries your world&rsquo;s build key, reads the guide, and builds with you.</p>
                {plugErr && <p className="text-[12px] text-amber-200/85 leading-relaxed mb-2">{plugErr}</p>}
                {!plugErr && !plugToken && <p className="text-[12px] text-white/55 mb-2">minting a build key…</p>}
                {plugToken && <>
                  <div className="rounded-xl bg-black/60 border border-white/12 p-3 text-[12.5px] text-white/80 leading-relaxed select-all whitespace-pre-wrap max-h-[46vh] overflow-y-auto">{connectPrompt}</div>
                  <button onClick={async () => { try { await navigator.clipboard.writeText(connectPrompt); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* manual */ } }}
                    className="mt-3 w-full py-2.5 rounded-xl border border-emerald-300/50 bg-emerald-400/15 text-emerald-100 text-[13px] tracking-[0.18em] hover:bg-emerald-400/25 transition-colors">
                    {copied ? '✓ COPIED — PASTE TO YOUR AI' : '⧉ COPY THE PROMPT (with your build key)'}
                  </button>
                  <p className="text-[11px] text-white/45 mt-2">this key IS write-access to this world — share only with your AI. Re-opening mints a fresh one.</p>
                </>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ◉ THE COMMONS CHAT — MAIN's room, field-bounded (the bar stays free) */}
      {chatOpen && uiSet === 'main' && (
        <GridChat slotKey="world-chat:MAIN" title="THE COMMONS" bounds={inset} onClose={() => setChatOpen(false)} />
      )}

      {/* ◆ BREW YOUR ICON — describe it, copy the prompt, your AI authors the
          avatar (set_player_icon over the bridge; the icon token rides the
          prompt). Field-bounded like everything else. */}
      {brewIconOpen && (uiSet === 'main' || uiSet === 'engine') && (
        <BrewIconPanel bounds={inset} onClose={() => setBrewIconOpen(false)} />
      )}

      {/* ✦ THE PREMIUM GATE — field-bounded; buy once, it's on your account */}
      {premGate && (
        // buying is a SITE action, not a world-frame one — anchor to the full
        // overlay area (like the selector), NOT the world-frame inset. On a
        // mobile world that inset is a narrow portrait strip, so the buy dialog
        // spilled off-screen (Galen: "buy to play pop up outside viewport").
        <div className="fixed z-[128] flex items-center justify-center backdrop-blur-sm"
          style={{ top: M, right: M, bottom: BAR_H + 10, left: M, background: 'rgba(5,6,12,0.9)', borderRadius: 10 }}
          onClick={() => setPremGate(null)}>
          <div className="w-full max-w-[440px] rounded-2xl border border-amber-300/30 bg-[#14100a]/97 p-5 m-4 font-mono" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13px] tracking-[0.25em] text-amber-200/90">✦ PREMIUM WORLD</span>
              <button onClick={() => setPremGate(null)} aria-label="close"
                className="w-8 h-8 grid place-items-center rounded-lg text-white/70 hover:text-white hover:bg-white/10 text-[16px]">✕</button>
            </div>
            <div className="text-[15px] tracking-[0.15em] text-white/95 mb-1">{selected?.name ?? premGate.slug.toUpperCase()}</div>
            <p className="text-[12px] text-white/65 leading-relaxed mb-3">buy it once — it saves to your account and this world opens for you forever (plus co-program access).</p>
            {premGate.err && <p className="text-[12px] text-amber-200/90 mb-2">{premGate.err}</p>}
            {premGate.signedIn ? (
              <button data-prem-buy disabled={!premGate.buyable || premGate.busy}
                onClick={async () => {
                  setPremGate(g => g && { ...g, busy: true, err: undefined })
                  try {
                    const r = await fetch('/api/premium', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: premGate.slug }) })
                    const d = await r.json().catch(() => null)
                    if (r.ok && d?.url) { window.location.href = d.url; return }
                    setPremGate(g => g && { ...g, busy: false, err: d?.error || 'checkout failed' })
                  } catch { setPremGate(g => g && { ...g, busy: false, err: 'checkout failed — are you offline?' }) }
                }}
                className="w-full py-2.5 rounded-xl border border-amber-300/50 bg-amber-400/15 text-amber-100 text-[13px] tracking-[0.18em] hover:bg-amber-400/25 disabled:opacity-40 transition-colors">
                {premGate.busy ? '…' : premGate.buyable ? `✦ BUY & PLAY — $${premGate.usd}` : 'payments not configured yet'}
              </button>
            ) : (
              <a data-prem-signin href={'/auth/signin?callbackUrl=' + encodeURIComponent('/grid?w=space:' + premGate.slug + '&buy=' + premGate.slug)}
                className="block text-center w-full py-2.5 rounded-xl border border-amber-300/50 bg-amber-400/15 text-amber-100 text-[13px] tracking-[0.18em] hover:bg-amber-400/25 transition-colors">
                CREATE ACCOUNT / SIGN IN — THEN BUY ${premGate.usd}
              </a>
            )}
          </div>
        </div>
      )}

      {/* ▭ THE BIGGER-SCREEN NOTICE — a desktop-built game (deviceConfig ≠
          mobile) opened on a small/phone screen (narrow) warns the player to
          come back on desktop, with a play-anyway escape. Shows once per world
          (bigScreenAck). Mobile-declared worlds never see it. */}
      {phase === 'play' && narrow && spc && spc.device !== 'mobile' && bigScreenAck !== spc.slug && (
        <div className="fixed z-[128] flex items-center justify-center backdrop-blur-sm"
          style={{ top: inset.top, right: inset.right, bottom: inset.bottom, left: inset.left, background: 'rgba(5,6,12,0.92)', borderRadius: 10 }}>
          <div className="w-full max-w-[400px] rounded-2xl border border-sky-300/30 bg-[#0a0e16]/97 p-5 m-4 font-mono">
            <div className="text-[13px] tracking-[0.25em] text-sky-200/90 mb-2">▭ BIGGER SCREEN</div>
            <div className="text-[15px] tracking-[0.15em] text-white/95 mb-1">{spc.name}</div>
            <p className="text-[12px] text-white/65 leading-relaxed mb-4">this game is built for desktop — it needs a bigger screen, a keyboard, and room to see. Come back on a computer for the real thing.</p>
            <div className="flex gap-2">
              <button onClick={() => { setPhase('browse') }}
                className="flex-1 py-2.5 rounded-xl border border-white/20 bg-black/50 text-white/70 text-[12px] tracking-[0.15em] hover:text-white hover:bg-white/5 transition-colors">
                ◂ BACK TO GAMES
              </button>
              <button onClick={() => setBigScreenAck(spc.slug)}
                className="flex-1 py-2.5 rounded-xl border border-sky-300/50 bg-sky-400/15 text-sky-100 text-[12px] tracking-[0.15em] hover:bg-sky-400/25 transition-colors">
                PLAY ANYWAY
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═ THE BOTTOM BAR ═  The DOCKSTAR is ABSOLUTELY centered and PRIMARY
          (Galen: "always primary and centered" — mobile was smooshing it out).
          Side zones are absolute and overflow-hidden: they can never push the
          cup. NARROW: no title, no REC — the phone bar is cup + essentials. */}
      {/* ⟲ RESET CONFIRM — restart is destructive (progress lost), so it asks */}
      {resetConfirm && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setResetConfirm(false)}>
          <div className="w-full max-w-xs rounded-2xl border border-white/15 bg-[#0a0913]/97 p-5 font-mono" onClick={e => e.stopPropagation()}>
            <div className="text-[13px] tracking-[0.2em] text-amber-100/90 mb-2">⟲ RESTART {selected?.name ?? 'this world'}?</div>
            <p className="text-[12px] leading-relaxed text-white/50 mb-4">This starts the world over from the beginning — your current progress is lost.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setResetConfirm(false)}
                className="font-mono text-[12px] tracking-[0.12em] px-3.5 py-2 rounded-lg border border-white/20 text-white/70 hover:bg-white/10 transition-colors">keep playing</button>
              <button data-grid-reset-go onClick={() => {
                setResetConfirm(false)
                try { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true })) } catch { /* ssr */ }
              }}
                className="font-mono text-[12px] tracking-[0.12em] px-3.5 py-2 rounded-lg border border-amber-300/50 bg-amber-400/15 text-amber-100 hover:bg-amber-400/25 transition-colors">RESTART</button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed bottom-0 inset-x-0 z-[135]" style={{ height: BAR_H }}>
        {/* solid black backing under the bar (Galen: "bottom bar not black") —
            the world/menu no longer shows through between the buttons */}
        <div className="absolute inset-0 bg-black/80 backdrop-blur-md border-t border-white/10" />
        <div className="absolute inset-x-0 top-0" style={{ bottom: 'max(env(safe-area-inset-bottom), 6px)' }}>
          {/* LEFT ZONE */}
          <div className="absolute inset-y-0 left-0 flex items-center gap-2 pl-3 overflow-hidden" style={{ right: 'calc(50% + 38px)' }}>
            {/* ◂ BACK — the bar's own back button (walks the same history the
                browser back walks) */}
            <button data-grid-back aria-label="back"
              onClick={() => { if (giRef.current > 0) window.history.back(); else { setSelOpen(true); setInstrOpen(false); setChatOpen(false); setBrewIconOpen(false) } }}
              title="back — at the start, opens the dockstar"
              className="font-mono text-[14px] w-9 h-9 grid place-items-center rounded-xl border bg-black/60 border-white/20 text-white/75 hover:text-white hover:border-white/40 transition-colors shrink-0">
              ◂
            </button>
            {!narrow && (uiSet === 'main' ? (
            <button data-grid-title onClick={() => { setSelOpen(o => !o); setAttribOpen(false) }}
              className="font-mono text-[13px] tracking-[0.16em] px-3.5 py-2 rounded-xl border bg-black/60 border-white/20 text-amber-100/95 hover:border-amber-300/50 transition-colors shrink-0">
              Cartridge.Cafe
            </button>
            ) : uiSet !== 'engine' ? (
            <button data-grid-title onClick={() => { setAttribOpen(o => !o); setSelOpen(false) }}
              className="font-mono text-[13px] tracking-[0.16em] px-3.5 py-2 rounded-xl border bg-black/60 border-white/20 text-white/90 hover:border-amber-300/50 transition-colors shrink-0 max-w-full truncate">
              {selected?.name ?? spc?.name ?? '—'}
            </button>
            ) : null)}
            <span className="flex-1" />
            {/* ◉ COMMONS — immediately left of the dockstar (MAIN) */}
            {uiSet === 'main' && (
              <button data-grid-commons onClick={() => { setChatOpen(o => !o); setBrewIconOpen(false); setSelOpen(false); setInstrOpen(false) }}
                className={`font-mono text-[12px] tracking-[0.18em] px-3.5 py-2 rounded-xl border transition-colors shrink-0 ${
                  chatOpen ? 'bg-emerald-400/25 border-emerald-300/60 text-emerald-100' : 'bg-black/70 border-white/25 text-white/85 hover:text-white'}`}>
                ◉ COMMONS
              </button>
            )}
            {/* ● REC — GAMES-play, desktop only (Galen: not needed on mobile) */}
            {!narrow && uiSet === 'games' && phase === 'play' && (
              <button data-grid-rec onClick={() => cmd('rec')}
                title={rec.on ? 'stop & download the recording' : 'record this world to a video file — nothing is uploaded'}
                className={`font-mono text-[12px] tracking-[0.18em] px-3.5 py-2 rounded-xl border transition-colors inline-flex items-center gap-2 shrink-0 ${
                  rec.on ? 'bg-red-500/25 border-red-400/60 text-red-100' : 'bg-black/70 border-white/25 text-white/85 hover:text-white'}`}>
                <span className={`inline-block w-2 h-2 rounded-full bg-red-500 ${rec.on ? 'animate-pulse' : ''}`} />
                {rec.on ? `${Math.floor(rec.secs / 60)}:${String(rec.secs % 60).padStart(2, '0')}` : 'REC'}
              </button>
            )}
            {/* ⟲ RESET — only for worlds that declare R-reset; sits left of the
                dockstar and always confirms first (Galen). Fires the same 'r'
                the keyboard path handles. */}
            {uiSet === 'games' && phase === 'play' && (cfgStable?.rReset || spc?.rReset) && (
              <button data-grid-reset onClick={() => setResetConfirm(true)}
                title="restart this world"
                className="font-mono text-[12px] tracking-[0.18em] px-3 py-2 rounded-xl border bg-black/70 border-white/25 text-white/85 hover:text-white hover:border-amber-300/50 transition-colors shrink-0 inline-flex items-center gap-1.5">
                ⟲ {!narrow && 'RESET'}
              </button>
            )}
            {/* ↗ SHARE — ALWAYS in the bar, left of the NAV cup (Galen, Sep 5).
                The payload is ONLY the MCP one-liner + the site — the setup
                gate itself; the server guides everything from there. */}
            <button data-grid-share onClick={async () => {
              const shareText = 'claude mcp add cartridge-cafe -- npx -y cartridge-cafe-mcp'
              try { await navigator.share?.({ title: 'cartridge.cafe', text: shareText }) }
              catch { try { await navigator.clipboard.writeText(shareText); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* manual */ } }
              if (!navigator.share) { try { await navigator.clipboard.writeText(shareText); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* manual */ } }
            }}
              className="font-mono text-[12px] tracking-[0.18em] px-3 py-2 rounded-xl border bg-black/70 border-white/25 text-white/85 hover:text-white transition-colors shrink-0">
              {narrow ? (copied ? '✓' : '↗') : (copied ? '✓ COPIED' : '↗ SHARE')}
            </button>
          </div>
          {/* THE DOCKSTAR — absolutely centered; nothing can move it */}
          <button onClick={() => { setSelOpen(o => !o); setInstrOpen(false); setConnectOpen(false); setAttribOpen(false); setBrewIconOpen(false) }} aria-label="ui selector"
            title="the dockstar — choose your UI"
            className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 grid place-items-center rounded-2xl border transition-all z-10 ${
              selOpen ? 'bg-amber-400/25 border-amber-300/70 scale-105' : 'bg-black/60 border-white/20 hover:border-amber-300/50 hover:bg-black/80'}`}
            style={{ boxShadow: selOpen ? '0 0 18px rgba(245,176,76,0.35)' : '0 2px 8px rgba(0,0,0,0.5)' }}>
            <span className="flex flex-col items-center leading-none">
              <img src="/cartridge-cup.svg" alt="" className="w-6 h-6" />
              <span className="font-mono text-[8px] tracking-[0.24em] text-white/80 mt-0.5">NAV</span>
            </span>
          </button>
          {/* RIGHT ZONE */}
          <div className="absolute inset-y-0 right-0 flex items-center justify-start gap-2 pr-3 overflow-hidden" style={{ left: 'calc(50% + 38px)' }}>
            {/* ◆ BREW ICON — immediately right of the dockstar (MAIN) */}
            {uiSet === 'main' && (
              <button data-grid-brewicon onClick={() => { setBrewIconOpen(o => !o); setChatOpen(false); setSelOpen(false); setInstrOpen(false) }}
                className={`font-mono text-[12px] tracking-[0.18em] px-3.5 py-2 rounded-xl border transition-colors shrink-0 ${
                  brewIconOpen ? 'bg-amber-400/25 border-amber-300/60 text-amber-100' : 'bg-black/70 border-white/25 text-white/85 hover:text-white'}`}>
                ◆ BREW ICON
              </button>
            )}
            {/* ◆ SET VISUAL (Galen, Sep 5: "in engine need a button to set
                visual for games on games page") — the ENGINE set's door to the
                same icon/card visual author the MAIN set calls BREW ICON. */}
            {uiSet === 'engine' && (
              <button data-grid-setvisual onClick={() => { setBrewIconOpen(o => !o); setChatOpen(false); setSelOpen(false); setInstrOpen(false) }}
                className={`font-mono text-[12px] tracking-[0.18em] px-3.5 py-2 rounded-xl border transition-colors shrink-0 ${
                  brewIconOpen ? 'bg-amber-400/25 border-amber-300/60 text-amber-100' : 'bg-black/70 border-white/25 text-white/85 hover:text-white'}`}>
                {narrow ? '◆' : '◆ SET VISUAL'}
              </button>
            )}
            <span className="flex-1" />
            {/* ✉ CONTACT — the teams door (terms: "contact for teams"). GAMES only. */}
            {uiSet === 'games' && (
            <a href={`/contact${selected?.name ? `?from=${encodeURIComponent(selected.name)}` : ''}`} target="_blank" rel="noopener"
              className="font-mono text-[12px] tracking-[0.18em] px-3.5 py-2 rounded-xl border transition-colors shrink-0 bg-black/70 border-white/25 text-white/85 hover:text-white">
              {narrow ? '✉' : '✉ CONTACT'}
            </a>
            )}
            {/* ? INSTRUCTIONS — GAMES only (not MAIN, not ENGINE, not CREATE) */}
            {uiSet === 'games' && (
            <button onClick={() => { setInstrOpen(o => !o); setSelOpen(false); setConnectOpen(false) }}
              className={`font-mono text-[12px] tracking-[0.18em] px-3.5 py-2 rounded-xl border transition-colors shrink-0 ${
                instrOpen ? 'bg-white/20 border-white/40 text-white' : 'bg-black/70 border-white/25 text-white/85 hover:text-white'}`}>
              {narrow ? '?' : '? INSTRUCTIONS'}
            </button>
            )}

            {/* ⚿ CONNECT AI — THE GREEN DOOR (Galen, Sep 5: "big green, always
                accessible"). Rightmost, every UI set; opens the connect modal
                (build-key prompt). Narrow keeps it, compacted. */}
            <button data-grid-connect onClick={() => { setConnectOpen(true); setSelOpen(false); setInstrOpen(false); setBrewIconOpen(false); setChatOpen(false) }}
              className="font-mono text-[12px] font-bold tracking-[0.16em] px-3.5 py-2 rounded-xl border-2 transition-all shrink-0 bg-emerald-500 border-emerald-300/80 text-black hover:bg-emerald-400 shadow-[0_0_16px_rgba(16,185,129,0.5)]">
              {narrow ? '⚿ AI' : '⚿ CONNECT AI'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}


// ⬢ NODES — who builds what, FROM THE GAME (the engine's live graph, code
// included). ADVANCED SWAPS the view in-area (no overlay, no two-column —
// responsive single column): grouped sections with edges; clicking a node
// opens its CODE full-area; ◂ backs out at every level.
// ⛭ CO-BUILD (Galen, Aug 28 do-over): not the node roster — the DOOR into
// LIVE EDITING worlds. Browse the open builds, JOIN one: it lands in the
// frame and the ⚿ CONNECT prompt opens so your AI starts building with you.
function CrewView({ icons, current, onJoin }: {
  icons: Map<string, string>
  current: string
  onJoin: (scene: string) => void
}) {
  const [open, setOpen] = useState<Entry[] | null>(null)
  useEffect(() => {
    fetch('/api/cards?tab=live').then(r => r.json())
      .then((d: { cards?: Array<{ slug: string; name: string; maker?: { name?: string | null; handle?: string | null } }> }) => {
        setOpen(Array.isArray(d.cards) ? d.cards.map(c => ({ slug: c.slug, name: c.name, scene: 'space:' + c.slug, maker: c.maker?.name ?? c.maker?.handle ?? undefined })) : [])
      })
      .catch(() => setOpen([]))
  }, [])
  return (
    <div className="w-full h-full overflow-y-auto p-4 font-mono">
      <div className="text-[11.5px] tracking-[0.2em] text-sky-200/70 mb-1">⛭ CO-BUILD — open live-editing worlds, join in</div>
      <p className="text-[11.5px] text-white/55 mb-3">these worlds build in the open — join one and it loads with the ⚿ connect prompt ready for your AI. Editing membership covers every open world.</p>
      {open === null && <div className="text-[12px] text-white/55">…</div>}
      {open?.length === 0 && <div className="text-[12px] text-white/55">no open builds right now — ⬆ PUBLISH can open one of yours (permanently).</div>}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))' }}>
        {(open ?? []).map(e => {
          const ic = icons.get(e.slug.toLowerCase()) ?? icons.get(e.name.toLowerCase())
          const on = current === e.scene
          return (
            <button key={e.slug} data-crew-join={e.slug} onClick={() => onJoin(e.scene)}
              className={`rounded-2xl border overflow-hidden text-left transition-colors ${
                on ? 'border-sky-300/70 bg-sky-400/10' : 'border-white/10 bg-black/40 hover:border-white/30'}`}>
              <div className="aspect-square w-full grid place-items-center overflow-hidden bg-black/50">
                {ic ? <img src={ic} alt="" className="w-full h-full object-cover" style={{ imageRendering: 'pixelated' }} />
                  : <span className="text-[20px] text-white/40">{e.name.slice(0, 1)}</span>}
              </div>
              <div className="px-2 py-1.5">
                <div className="text-[11px] tracking-[0.12em] text-white/85 truncate">{e.name}</div>
                <div className="text-[10px] text-sky-200/80 tracking-[0.15em]">◉ JOIN THE BUILD</div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function NodesView({ graph }: { graph: AiNodeGraph | null }) {
  const [mode, setMode] = useState<'list' | 'adv'>('list')
  const [sel, setSel] = useState<ANode | null>(null)
  const tint: Record<string, string> = { field: 'text-sky-200/90', visual: 'text-amber-200/90', hook: 'text-violet-300/90', module: 'text-emerald-200/90' }

  if (sel) {
    const code = sel.kind === 'hook' ? (sel as { code?: string }).code : (sel as { wgsl?: string }).wgsl
    return (
      <div className="w-full h-full flex flex-col p-4 font-mono">
        <div className="flex items-center gap-2 mb-2">
          <button onClick={() => setSel(null)} className="px-2.5 py-1 rounded-lg border border-white/20 text-white/75 text-[12px] hover:bg-white/5">◂ BACK</button>
          <span className={`text-[11px] tracking-[0.15em] ${tint[sel.kind]}`}>{sel.kind.toUpperCase()}</span>
          <span className="text-[13px] text-white/90 truncate">{sel.title}</span>
          {'author' in sel && (sel as { author?: string }).author ? <span className="ml-auto text-[11px] text-amber-200/70">{(sel as { author?: string }).author}</span> : null}
        </div>
        <pre className="flex-1 min-h-0 overflow-auto rounded-xl border border-white/12 bg-black/60 p-3 text-[11.5px] leading-relaxed text-white/85 whitespace-pre-wrap break-words">
          {code || '(no code on this node — a field/registry entry)'}
        </pre>
      </div>
    )
  }

  if (mode === 'adv' && graph) {
    // THE FLOW TREE (Galen): the world's dataflow, top to bottom — HOOKS drive
    // the VISUALS, visuals PAINT their fields, MODULES compose the shader.
    // `paints` edges are specific (visual → its field); drives/composes are the
    // megashader's everything-feeds-everything, shown as flow stages, not fans.
    const hooks = graph.hooks as ANode[], visuals = graph.visuals as ANode[]
    const fields = graph.fields as ANode[], modules = graph.modules as ANode[]
    const paintedBy = new Map<string, string[]>()   // visualId → fieldIds it paints
    for (const e of graph.edges) if (e.kind === 'paints') { const a = paintedBy.get(e.from) ?? []; a.push(e.to); paintedBy.set(e.from, a) }
    const fieldById = new Map(fields.map(f => [f.id, f]))
    const paintedIds = new Set(graph.edges.filter(e => e.kind === 'paints').map(e => e.to))
    const orphanFields = fields.filter(f => !paintedIds.has(f.id))
    const NodeBtn = ({ n, pre }: { n: ANode; pre: string }) => (
      <button onClick={() => setSel(n)}
        className="w-full text-left flex items-center py-1 px-1 rounded hover:bg-white/5 text-[12.5px] leading-snug">
        <span className="shrink-0 text-white/35 whitespace-pre">{pre}</span>
        <span className={`shrink-0 mr-2 ${tint[n.kind]}`}>●</span>
        <span className="text-white/90 truncate">{n.title}</span>
      </button>
    )
    const Stage = ({ label }: { label: string }) => (
      <div className="flex items-center gap-2 my-1.5 text-[10.5px] tracking-[0.25em] text-white/50">
        <span className="text-sky-300/60">↓</span>{label}
      </div>
    )
    return (
      <div className="w-full h-full overflow-y-auto p-4 font-mono">
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => setMode('list')} className="px-2.5 py-1 rounded-lg border border-white/20 text-white/75 text-[12px] hover:bg-white/5">◂ BACK</button>
          <span className="text-[11.5px] tracking-[0.2em] text-sky-200/70">⬡ THE FLOW — tap any node for its code</span>
        </div>
        {hooks.length > 0 && <>
          <div className="text-[10.5px] tracking-[0.25em] text-violet-300/70">✎ HOOKS — run every tick, drive the world</div>
          {hooks.map((n, i) => <NodeBtn key={n.id} n={n} pre={i === hooks.length - 1 ? ' └─ ' : ' ├─ '} />)}
          <Stage label="DRIVE THE VISUALS" />
        </>}
        <div className="text-[10.5px] tracking-[0.25em] text-amber-200/70">◆ VISUALS ─paint→ ▦ FIELDS</div>
        {visuals.map((v, i) => {
          const kids = (paintedBy.get(v.id) ?? []).map(id => fieldById.get(id)).filter(Boolean) as ANode[]
          const last = i === visuals.length - 1 && orphanFields.length === 0
          return (
            <div key={v.id}>
              <NodeBtn n={v} pre={last ? ' └─ ' : ' ├─ '} />
              {kids.map((f, j) => <NodeBtn key={f.id} n={f} pre={`${last ? '    ' : ' │  '}${j === kids.length - 1 ? '└─paints→ ' : '├─paints→ '}`} />)}
            </div>
          )
        })}
        {orphanFields.length > 0 && <>
          <div className="mt-1 text-[10.5px] tracking-[0.25em] text-sky-200/60">▦ FIELDS with no visual (data only — render as nothing)</div>
          {orphanFields.map((n, i) => <NodeBtn key={n.id} n={n} pre={i === orphanFields.length - 1 ? ' └─ ' : ' ├─ '} />)}
        </>}
        {modules.length > 0 && <>
          <Stage label="COMPOSED FROM" />
          <div className="text-[10.5px] tracking-[0.25em] text-emerald-200/70">⚙ MODULES — the shader library under every visual</div>
          {modules.map((n, i) => <NodeBtn key={n.id} n={n} pre={i === modules.length - 1 ? ' └─ ' : ' ├─ '} />)}
        </>}
      </div>
    )
  }

  const rows: ANode[] = graph
    ? [...(graph.fields as ANode[]), ...(graph.visuals as ANode[]), ...(graph.hooks as ANode[]), ...(graph.modules as ANode[])]
    : []
  return (
    <div className="w-full h-full overflow-y-auto p-4 font-mono">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11.5px] tracking-[0.2em] text-sky-200/70">⬢ NODES — who builds what</span>
        <button onClick={() => setMode('adv')} disabled={!graph}
          className="px-3 py-1 rounded-lg border border-sky-300/40 text-sky-200/90 text-[11px] tracking-[0.15em] hover:bg-sky-400/10 disabled:opacity-35">
          ⬡ ADVANCED
        </button>
      </div>
      {!graph && <div className="text-[12px] text-white/55">reading the world…</div>}
      {graph && rows.length === 0 && <div className="rounded-xl border border-white/12 bg-black/50 p-3.5 text-[12.5px] text-white/70">an empty world — no nodes yet.</div>}
      {rows.map(n => (
        <button key={n.id} onClick={() => { setSel(n) }}
          className="w-full text-left flex items-center gap-3 py-1.5 border-b border-white/8 text-[12.5px] hover:bg-white/5">
          <span className={`shrink-0 w-14 text-[10.5px] tracking-[0.15em] ${tint[n.kind]}`}>{n.kind.toUpperCase()}</span>
          <span className="text-white/90 truncate">{n.title}</span>
          {'author' in n && (n as { author?: string }).author ? <span className="ml-auto text-amber-200/70 shrink-0">{(n as { author?: string }).author}</span> : null}
        </button>
      ))}
    </div>
  )
}

// ◲ ASSETS — the world's asset shelf. Upload pixel art, RIP a sheet into
// slots, animate a strip — each ships as an asset SAVED ON THE WORLD
// (sprite-store + worldData.sprites), and any visual draws it later with the
// use-snippet each asset shows (sprite/spriteAnim). Owners upload; everyone
// else reads the shelf.
function AssetsView({ cfg }: { cfg: GridCfg | null }) {
  const slug = cfg?.spaceSlug ?? null
  return (
    <div className="w-full h-full flex flex-col font-mono">
      <div className="flex items-center justify-between px-4 pt-4">
        <span className="flex items-center gap-2 text-[11.5px] tracking-[0.2em] text-amber-200/70">◲ ASSETS — saved on this world, drawn by its visuals
          <span className="rounded border border-amber-300/30 bg-amber-400/10 px-1.5 py-0.5 text-[9.5px] tracking-[0.15em] text-amber-200/80">IN DEVELOPMENT</span>
        </span>
        {slug && !cfg?.isOwner && <span className="text-[11px] text-white/45">read-only — the owner uploads</span>}
      </div>
      {slug
        ? <div className="flex-1 min-h-0"><SpritesPanel inline slug={slug} readOnly={!cfg?.isOwner} /></div>
        : <div className="flex-1 grid place-items-center p-6 text-center text-[12.5px] text-white/55 leading-relaxed">house cartridge — assets live on real worlds.<br />brew or fork a world and its shelf opens here.</div>}
    </div>
  )
}

// ⚙ CONFIG — the old world tools, for real (minus lineage — that lives on the
// title). Space owners get the management overlay (name · visibility · keys);
// the toggles drive the engine's own writes over cfg: commands.
function ConfigView({ cfg, sceneIsSpace, onAssets }: {
  cfg: GridCfg | null
  sceneIsSpace: boolean
  onAssets: () => void
}) {
  const fire = (k: string) => { try { window.dispatchEvent(new CustomEvent('cafe:shell-cmd', { detail: 'cfg:' + k })) } catch { /* ssr */ } }
  const Row = ({ label, on, k, disabled, hint }: { label: string; on: boolean; k: string; disabled?: boolean; hint?: string }) => (
    <div className="flex items-center justify-between py-2 border-b border-white/8 text-[13px]" title={hint}>
      <span className="text-white/80">{label}</span>
      <button onClick={() => fire(k)} disabled={disabled}
        className={`px-2.5 py-0.5 rounded-full border text-[12px] tracking-[0.15em] transition-colors disabled:opacity-35 ${
          on ? 'bg-emerald-400/20 border-emerald-300/50 text-emerald-200' : 'bg-white/5 border-white/15 text-white/55'}`}>
        {on ? 'ON' : 'OFF'}
      </button>
    </div>
  )
  const ownerLaw = !!cfg?.isOwner
  const slug = cfg?.spaceSlug ?? null
  const ownedSpace = ownerLaw && !!slug

  // ⚭ INVITE — one-time crew link, minted + copied in one tap
  const [invite, setInvite] = useState<'idle' | 'busy' | 'copied' | 'failed'>('idle')
  const mintInvite = async () => {
    if (!slug || invite === 'busy') return
    setInvite('busy')
    try {
      const r = await fetch(`/api/spaces/${encodeURIComponent(slug)}/invite`, { method: 'POST' })
      const d = await r.json().catch(() => null)
      if (r.ok && d?.joinUrl) { try { await navigator.clipboard.writeText(d.joinUrl) } catch { /* select-all fallback below */ } setInvite('copied'); setTimeout(() => setInvite('idle'), 2500) }
      else setInvite('failed')
    } catch { setInvite('failed') }
  }

  // ◆ MAKE ICON — mint a world token + hand your AI the icon-author prompt
  const [iconDesc, setIconDesc] = useState('')
  const [iconTok, setIconTok] = useState<string | null>(null)
  const [iconCopied, setIconCopied] = useState(false)
  const copyIconPrompt = async () => {
    if (!slug) return
    let tok = iconTok
    if (!tok) {
      try {
        const r = await fetch(`/api/spaces/${encodeURIComponent(slug)}/token`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'AI agent' }),
        })
        const d = await r.json().catch(() => null)
        if (r.ok && d?.token) { tok = d.token as string; setIconTok(tok) }
      } catch { /* below */ }
    }
    if (!tok) return
    const origin = window.location.origin.replace('localhost:3131', 'cartridge.cafe')
    try { await navigator.clipboard.writeText(iconAuthorPrompt(tok, iconDesc.trim(), origin)); setIconCopied(true); setTimeout(() => setIconCopied(false), 1800) } catch { /* manual */ }
  }

  // ✕ DELETE WORLD — owner-only, behind a confirm popup. The server holds the
  // real guards (branches · co-built · lineage · flags → clear 409s); we just
  // surface them. On success the world is gone, so we leave for the hub.
  const [del, setDel] = useState<'idle' | 'confirm' | 'busy'>('idle')
  const [delErr, setDelErr] = useState<string | null>(null)
  const doDelete = async () => {
    if (!slug || del === 'busy') return
    setDel('busy'); setDelErr(null)
    try {
      const r = await fetch(`/api/spaces/${encodeURIComponent(slug)}`, { method: 'DELETE' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setDelErr(d?.error || 'Could not delete this world.'); setDel('confirm'); return }
      window.location.href = '/grid'   // it's gone — back to the hub
    } catch { setDelErr('Network error — try again.'); setDel('confirm') }
  }

  return (
    <div className="relative w-full h-full overflow-y-auto p-4 font-mono">
      <div className="text-[11.5px] tracking-[0.2em] text-amber-200/70 mb-2">⚙ WORLD CONFIG</div>
      {ownedSpace && cfg?.spaceId && (
        <div className="mb-3 rounded-xl border border-white/12 bg-black/40 overflow-hidden">
          <SpaceManagementOverlay embedded spaceSlug={slug!} spaceId={cfg.spaceId} />
        </div>
      )}
      <div className="rounded-xl border border-white/12 bg-black/40 px-3.5 py-1 mb-3">
        <Row label="multiplayer" on={!!cfg?.multiplayer} k="multiplayer" disabled={!ownerLaw} />
        {/* player-presence row RETIRED (Aug 28) — pips are gone; multiplayer is co-presence */}
        <Row label="restart with R" on={!!cfg?.rReset} k="rreset" disabled={!ownerLaw} />
        <Row label="allow forking" on={!!cfg?.forkable} k="forkable" disabled={!ownerLaw} />
        {/* (✎ design moved to the ⬆ PUBLISH tab — draft vs live is a publishing state) */}
        {/* ▦ DEVICE is set ONCE at creation (create flow → birthParams.deviceConfig).
            No post-creation toggle: flipping the flag can't rebuild a world for a
            form factor it wasn't authored for — it only ever produced a broken fit.
            The value still shows below as read-only dimensions. */}
        {(cfg?.gridW || cfg?.gridH) && (
          <div className="flex items-center justify-between py-2 border-t border-white/8 text-[13px]">
            <span className="text-white/80" title="declared world dimensions — the frame cover-fills to these; undeclared worlds letterbox by design">dimensions</span>
            <span className="text-white/65 font-mono">{cfg?.gridW ?? '—'} × {cfg?.gridH ?? '—'}</span>
          </div>
        )}
      </div>

      {/* ▤ THE CARD — what the catalog deals: kind · type · tags · blurb ·
          story · instructions. Writes ride the card: cmd into worldData. */}
      {ownedSpace && <CardSection cfg={cfg} />}

      {/* owner workbench — invite / icon / the assets shelf door */}
      {ownedSpace && (
        <div className="rounded-xl border border-white/12 bg-black/40 p-3.5 mb-3 text-[12px]">
          <div className="text-[11.5px] tracking-[0.2em] text-white/60 mb-2">THE WORKBENCH</div>
          <div className="flex flex-wrap gap-2">
            <button onClick={mintInvite}
              title="mint a ONE-TIME join link — the first signed-in person to open it joins your crew as a builder; the link dies on use"
              className="px-3 py-1.5 rounded-lg border border-white/20 bg-black/50 text-white/80 hover:text-white text-[12px] tracking-[0.15em] transition-colors">
              {invite === 'busy' ? '…' : invite === 'copied' ? '✓ LINK COPIED' : invite === 'failed' ? 'MINT FAILED' : '⚭ INVITE A BUILDER'}
            </button>
            <button onClick={onAssets}
              title="the ◲ ASSETS tab — upload pixel art, rip sheets into slots any visual can sample"
              className="px-3 py-1.5 rounded-lg border border-white/20 bg-black/50 text-white/80 hover:text-white text-[12px] tracking-[0.15em] transition-colors">
              ◲ ASSETS
            </button>
          </div>
          <div className="mt-3 flex gap-2 items-center">
            <input value={iconDesc} onChange={e => setIconDesc(e.target.value)} maxLength={120}
              placeholder="◆ icon: describe it (optional)…"
              className="flex-1 px-2.5 py-1.5 rounded-lg bg-black/50 border border-white/15 text-[12px] text-white/85 placeholder:text-white/40 outline-none focus:border-white/35" />
            <button onClick={copyIconPrompt}
              title="your AI writes a tiny shader icon for this world's shelf bubble — copy the prompt, paste it to your AI"
              className="px-3 py-1.5 rounded-lg border border-white/20 bg-black/50 text-white/80 hover:text-white text-[12px] tracking-[0.15em] transition-colors shrink-0">
              {iconCopied ? '✓ COPIED' : '◆ MAKE ICON'}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-white/12 bg-black/40 p-3.5 text-[12px] leading-relaxed text-white/65">
        social contract: <span className="text-white/85">{cfg?.policy ? `build: ${cfg.policy} · sealed` : 'undeclared · default (owner builds, everyone plays)'}</span>
        {!sceneIsSpace && <div className="mt-1.5 text-white/50">house cartridge — owner controls apply on real worlds.</div>}
      </div>

      {/* ✕ DELETE — owner's danger zone; a confirm popup gates the real call */}
      {ownedSpace && (
        <div className="mt-3 rounded-xl border border-red-400/20 bg-red-500/[0.04] p-3.5 flex items-center justify-between gap-3">
          <span className="text-[12px] text-white/55 leading-snug">Delete this world and its state — this can’t be undone.</span>
          <button onClick={() => { setDelErr(null); setDel('confirm') }} title="delete this world"
            className="shrink-0 px-3 py-1.5 rounded-lg border border-red-400/40 text-red-300 hover:bg-red-500/15 text-[12px] tracking-[0.12em] transition-colors">
            ✕ DELETE
          </button>
        </div>
      )}

      {del !== 'idle' && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => del !== 'busy' && setDel('idle')}>
          <div className="w-full max-w-sm rounded-xl border border-red-400/25 bg-black/90 p-5 font-mono" onClick={e => e.stopPropagation()}>
            <div className="text-[13px] tracking-[0.18em] text-red-300/90 mb-2">✕ DELETE WORLD</div>
            <div className="text-[13px] text-white/75 leading-relaxed">Permanently delete <span className="text-amber-200">{slug}</span>?</div>
            <div className="text-[12px] text-white/45 mt-1 mb-4">Its state is erased. This can’t be undone.</div>
            {delErr && <div className="mb-3 text-[12px] text-red-300/90 leading-snug">{delErr}</div>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDel('idle')} disabled={del === 'busy'}
                className="px-3 py-1.5 text-[12px] text-white/60 hover:text-white/85 disabled:opacity-40">cancel</button>
              <button onClick={doDelete} disabled={del === 'busy'}
                className="px-3.5 py-1.5 rounded-lg border border-red-400/50 bg-red-500/15 text-red-200 hover:bg-red-500/25 text-[12px] tracking-[0.12em] disabled:opacity-40">
                {del === 'busy' ? 'deleting…' : 'DELETE FOREVER'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// ⏱ VERSIONS — its own tab (Galen): the world's save-point history. Owner:
// ⚑ save a point, pick any rung → the engine hot-swaps it in place (ver: cmd).
function VersionsView({ cfg }: { cfg: { isOwner: boolean; spaceSlug: string | null; ver?: number | null } | null }) {
  const cmd = (c: string) => { try { window.dispatchEvent(new CustomEvent('cafe:shell-cmd', { detail: c })) } catch { /* ssr */ } }
  const slug = cfg?.spaceSlug ?? null
  const owner = !!cfg?.isOwner
  const [vers, setVers] = useState<Array<{ version: number; note: string | null; createdAt: string }>>([])
  const [verBusy, setVerBusy] = useState(false)
  const [verNote, setVerNote] = useState('')
  const loadVers = useCallback(async () => {
    if (!slug) return
    try {
      const r = await fetch(`/api/spaces/${encodeURIComponent(slug)}/versions`).then(x => x.json())
      setVers(Array.isArray(r.versions) ? r.versions.filter((v: { version: number }) => v.version >= 1) : [])
    } catch { setVers([]) }
  }, [slug])
  useEffect(() => { loadVers() }, [loadVers])
  const savePoint = async () => {
    if (!slug || verBusy) return
    setVerBusy(true)
    try {
      await fetch(`/api/spaces/${encodeURIComponent(slug)}/versions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verNote.trim() ? { note: verNote.trim() } : {}),
      })
      setVerNote(''); await loadVers()
    } finally { setVerBusy(false) }
  }
  if (!slug) {
    return <div className="w-full h-full grid place-items-center p-6 font-mono text-[12px] text-white/55 text-center">house cartridge — versions live on real worlds.</div>
  }
  return (
    <div className="w-full h-full overflow-y-auto p-4 font-mono">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <span className="text-[11.5px] tracking-[0.2em] text-amber-200/70">⏱ VERSIONS — every save point of this world</span>
        {owner && (
          <div className="flex gap-2 items-center">
            <input value={verNote} onChange={e => setVerNote(e.target.value)} maxLength={200} placeholder="note (optional)"
              className="w-36 px-2 py-1 rounded-lg bg-black/50 border border-white/15 text-[11.5px] text-white/85 placeholder:text-white/40 outline-none focus:border-white/35" />
            <button onClick={savePoint} disabled={verBusy}
              className="px-2.5 py-1 rounded-lg border border-amber-300/40 bg-amber-400/15 text-amber-200 text-[11.5px] tracking-[0.15em] hover:bg-amber-400/25 disabled:opacity-40 transition-colors">
              {verBusy ? '…' : '⚑ SAVE A POINT'}
            </button>
          </div>
        )}
      </div>
      <button onClick={() => owner && cmd('ver:live')} disabled={!owner}
        className={`w-full text-left px-2.5 py-1.5 rounded-lg mb-1 border text-[12px] transition-colors disabled:cursor-default ${
          cfg?.ver == null ? 'border-emerald-300/50 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-black/30 text-white/65 hover:text-white'}`}>
        LIVE <span className="text-white/50 ml-2">now</span>
      </button>
      {[...vers].sort((a, b) => b.version - a.version).map(v => (
        <button key={v.version} onClick={() => owner && cmd('ver:' + v.version)} disabled={!owner}
          className={`w-full text-left px-2.5 py-1.5 rounded-lg mb-1 border text-[12px] transition-colors disabled:cursor-default ${
            cfg?.ver === v.version ? 'border-emerald-300/50 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-black/30 text-white/65 hover:text-white'}`}>
          v{v.version}
          <span className="text-white/50 ml-2">{new Date(v.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          {v.note && <span className="text-amber-200/70 ml-2">{v.note}</span>}
        </button>
      ))}
      {vers.length === 0 && <div className="text-white/50 px-1 py-1">no save points yet{owner ? ' — ⚑ makes one from the live world.' : '.'}</div>}
      {!owner && <div className="mt-2 text-[11px] text-white/50">only the maker restores versions.</div>}
    </div>
  )
}

// ⌂ MY WORLDS in ENGINE — your worlds, pickable into the frame without leaving
// the workshop (the GAMES shelf has the same tab for play).
function MyWorldsView({ icons, current, onPick }: {
  icons: Map<string, string>
  current: string
  onPick: (scene: string) => void
}) {
  const [mine, setMine] = useState<Entry[] | null>(null)
  useEffect(() => {
    fetch('/api/cards?tab=mine').then(r => r.json())
      .then((d: { cards?: Array<{ slug: string; name: string; maker?: { name?: string | null; handle?: string | null } }> }) => {
        setMine(Array.isArray(d.cards) ? d.cards.map(c => ({ slug: c.slug, name: c.name, scene: 'space:' + c.slug, maker: c.maker?.name ?? c.maker?.handle ?? undefined })) : [])
      })
      .catch(() => setMine([]))
  }, [])
  return (
    <div className="w-full h-full overflow-y-auto p-4 font-mono">
      <div className="text-[11.5px] tracking-[0.2em] text-emerald-200/70 mb-2">⌂ MY WORLDS — pick one into the frame</div>
      {mine === null && <div className="text-[12px] text-white/55">…</div>}
      {mine?.length === 0 && <div className="text-[12px] text-white/55">no worlds on your deed yet — sign in, or brew one at /create.</div>}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
        {(mine ?? []).map(e => {
          const ic = icons.get(e.slug.toLowerCase()) ?? icons.get(e.name.toLowerCase())
          const on = current === e.scene
          return (
            <button key={e.slug} onClick={() => onPick(e.scene)}
              className={`rounded-2xl border overflow-hidden text-left transition-colors ${
                on ? 'border-emerald-300/70 bg-emerald-400/10' : 'border-white/10 bg-black/40 hover:border-white/30'}`}>
              <div className="aspect-square w-full grid place-items-center overflow-hidden bg-black/50">
                {ic ? <img src={ic} alt="" className="w-full h-full object-cover" style={{ imageRendering: 'pixelated' }} />
                  : <span className="text-[20px] text-white/40">{e.name.slice(0, 1)}</span>}
              </div>
              <div className="px-2 py-1.5 text-[11px] tracking-[0.12em] text-white/85 truncate">{e.name}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ▤ THE CARD — kind · type · tags · blurb · story · instructions (Galen:
// "config needs tagging, writing instructions, labeling what it is").
// Local drafts seed once from the engine's publish; blur → card: cmd.
function CardSection({ cfg }: { cfg: GridCfg | null }) {
  const send = (patch: Record<string, unknown>) => { try { window.dispatchEvent(new CustomEvent('cafe:shell-cmd', { detail: 'card:' + JSON.stringify(patch) })) } catch { /* ssr */ } }
  const [seeded, setSeeded] = useState(false)
  const [kind, setKind] = useState<string>('auto')
  const [typ, setTyp] = useState('')
  const [types, setTypes] = useState<Array<{ id: string; label: string }>>([])
  const [tags, setTags] = useState('')
  const [blurb, setBlurb] = useState('')
  const [vision, setVision] = useState('')
  const [instr, setInstr] = useState('')
  useEffect(() => {
    fetch('/api/cards?types=1').then(r => r.json()).then(d => setTypes(d.types ?? [])).catch(() => {})
  }, [])
  useEffect(() => {
    if (seeded || !cfg) return
    setSeeded(true)
    setKind(cfg.card?.kind === 'toy' || cfg.card?.kind === 'world' || cfg.card?.kind === 'game' ? cfg.card.kind : 'auto')
    setTyp(cfg.card?.type ?? '')
    setTags((cfg.card?.tags ?? []).join(', '))
    setBlurb(cfg.blurb ?? ''); setVision(cfg.vision ?? ''); setInstr(cfg.instructions ?? '')
  }, [cfg, seeded])
  return (
    <div className="rounded-xl border border-white/12 bg-black/40 p-3.5 mb-3 text-[12px] space-y-2">
      <div className="text-[11.5px] tracking-[0.2em] text-white/60">▤ THE CARD — what the catalog deals</div>
      <div className="flex items-center gap-1.5">
        {(['auto', 'toy', 'world', 'game'] as const).map(k => (
          <button key={k} data-card-kind={k}
            onClick={() => { setKind(k); send({ card: { kind: k === 'auto' ? null : k } }) }}
            title={k === 'auto' ? 'the anatomy decides: rules built → game; multiplayer/big grid → world; else toy' : k}
            className={`px-2.5 py-0.5 rounded-full border text-[11.5px] tracking-[0.12em] transition-colors ${kind === k
              ? 'border-amber-300/60 bg-amber-400/15 text-amber-200' : 'border-white/20 text-white/60 hover:text-white'}`}>
            {k.toUpperCase()}
          </button>
        ))}
      </div>
      <select value={typ} onChange={e => { setTyp(e.target.value); send({ card: { type: e.target.value || null } }) }}
        className="w-full bg-black/50 border border-white/15 rounded-lg px-2.5 py-1.5 text-[12px] text-white/85 outline-none focus:border-amber-300/50">
        <option value="">type… (the vocabulary)</option>
        {types.map(t => <option key={t.id} value={t.id}>{t.label ?? t.id}</option>)}
      </select>
      <input value={tags} onChange={e => setTags(e.target.value)}
        onBlur={() => send({ card: { tags: tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) } })}
        placeholder="tags, comma, separated"
        className="w-full bg-black/50 border border-white/15 rounded-lg px-2.5 py-1.5 text-[12px] text-white/85 placeholder:text-white/40 outline-none focus:border-amber-300/50" />
      <input value={blurb} onChange={e => setBlurb(e.target.value)} onBlur={() => send({ blurb: blurb.trim() })}
        placeholder="the blurb — one line the card shows"
        className="w-full bg-black/50 border border-white/15 rounded-lg px-2.5 py-1.5 text-[12px] text-white/85 placeholder:text-white/40 outline-none focus:border-amber-300/50" />
      <textarea value={instr} onChange={e => setInstr(e.target.value)} onBlur={() => send({ instructions: instr.trim() })}
        placeholder="instructions — how to PLAY it (the ? INSTRUCTIONS panel shows this)"
        rows={3}
        className="w-full bg-black/50 border border-white/15 rounded-lg px-2.5 py-1.5 text-[12px] leading-snug text-white/85 placeholder:text-white/40 outline-none focus:border-amber-300/50 resize-y" />
      <textarea value={vision} onChange={e => setVision(e.target.value)} onBlur={() => send({ vision: vision.trim() })}
        placeholder="the story (vision) — what this world IS"
        rows={2}
        className="w-full bg-black/50 border border-white/15 rounded-lg px-2.5 py-1.5 text-[12px] leading-snug text-white/85 placeholder:text-white/40 outline-none focus:border-amber-300/50 resize-y" />
    </div>
  )
}

// ⬆ PUBLISH — the destination seam (Galen, Aug 28): a draft publishes TO a
// shelf. ● GAME LIST (finished) ⇄ ⚒ UNFINISHED are reversible listings.
// ◉ OPEN LIVE EDITING declares the social contract (build:anyone) — SEALED,
// not something you can take back — so it gets a disclaimer confirm, and an
// open world BLOCKS the other destinations (it lives on LIVE EDITING only).
function PublishView({ cfg }: { cfg: GridCfg | null }) {
  const cmd = (c: string) => { try { window.dispatchEvent(new CustomEvent('cafe:shell-cmd', { detail: c })) } catch { /* ssr */ } }
  const [confirmLive, setConfirmLive] = useState(false)
  const slug = cfg?.spaceSlug ?? null
  const owner = !!cfg?.isOwner
  if (!slug) return <div className="w-full h-full grid place-items-center p-6 font-mono text-[12px] text-white/55 text-center">house cartridge — publishing lives on real worlds.</div>
  if (!owner) return <div className="w-full h-full grid place-items-center p-6 font-mono text-[12px] text-white/55 text-center">only the maker publishes this world.</div>
  const drafting = !!cfg?.designMode
  const live = cfg?.isPublic === true
  const openBuild = cfg?.policy === 'anyone'
  const state = drafting ? '✎ DRAFTING'
    : openBuild ? '◉ OPEN LIVE EDITING'
    : live && cfg?.unfinished ? '⚒ LIVE — UNFINISHED'
    : live ? '● LIVE — GAME LIST'
    : '○ UNLISTED'
  const stateTint = drafting ? 'text-amber-200 border-amber-300/50 bg-amber-400/10'
    : openBuild ? 'text-sky-200 border-sky-300/50 bg-sky-400/10'
    : live ? 'text-emerald-200 border-emerald-300/50 bg-emerald-400/10'
    : 'text-white/70 border-white/20 bg-black/40'
  const Btn = ({ label, onClick, tone, disabled, hint }: { label: string; onClick: () => void; tone: string; disabled?: boolean; hint?: string }) => (
    <button onClick={onClick} disabled={disabled} title={hint}
      className={`px-3.5 py-2 rounded-xl border text-[12px] tracking-[0.15em] transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${tone}`}>
      {label}
    </button>
  )
  return (
    <div className="w-full h-full overflow-y-auto p-4 font-mono text-[12px]">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[11.5px] tracking-[0.2em] text-white/60">⬆ PUBLISH</span>
        <span data-pub-state className={`px-3 py-1 rounded-full border text-[11.5px] tracking-[0.18em] ${stateTint}`}>{state}</span>
      </div>
      <div className="rounded-xl border border-white/12 bg-black/40 p-3.5 mb-3 leading-relaxed text-white/70">
        <span className="text-amber-200/90">✎ draft</span>: edits author the cartridge in the workshop — nothing public changes.<br />
        <span className="text-emerald-200/90">● game list</span>: a finished, playable game.  <span className="text-white/85">⚒ unfinished</span>: public, honestly in-progress.<br />
        <span className="text-sky-200/90">◉ open live editing</span>: anyone with a membership builds on it — <span className="text-white/85">permanent</span>.
      </div>
      <div className="flex flex-wrap gap-2">
        {!drafting
          ? <Btn label="✎ START A DRAFT" onClick={() => cmd('cfg:design')} tone="border-amber-300/50 bg-amber-400/15 text-amber-200 hover:bg-amber-400/25" />
          : <Btn label="✎ END DRAFT (keep unpublished)" onClick={() => cmd('cfg:design')} tone="border-white/20 bg-black/50 text-white/75 hover:text-white" />}
        <Btn label="● PUBLISH — GAME LIST" onClick={() => cmd('publish:game')} disabled={openBuild}
          hint={openBuild ? 'an open live-editing world lives on LIVE EDITING only' : 'finished — everyone can play it'}
          tone="border-emerald-300/50 bg-emerald-400/15 text-emerald-100 hover:bg-emerald-400/25" />
        <Btn label="⚒ PUBLISH — UNFINISHED" onClick={() => cmd('publish:unfinished')} disabled={openBuild}
          hint={openBuild ? 'an open live-editing world lives on LIVE EDITING only' : 'public on the ⚒ shelf, marked in-progress'}
          tone="border-white/25 bg-white/5 text-white/85 hover:bg-white/10" />
        {!openBuild && (
          <Btn label="◉ OPEN LIVE EDITING…" onClick={() => setConfirmLive(true)}
            hint="declare the build contract open — THIS CANNOT BE TAKEN BACK"
            tone="border-sky-300/50 bg-sky-400/10 text-sky-200 hover:bg-sky-400/20" />
        )}
        {live && (
          <Btn label="○ UNPUBLISH" onClick={() => cmd('publish:off')}
            hint={openBuild ? 'takes it off the shelves — the open build contract itself stays sealed' : 'off the shelves; yours to edit'}
            tone="border-white/20 bg-black/50 text-white/70 hover:text-white" />
        )}
      </div>
      {/* ◉ THE DISCLAIMER — the seal named before it closes (Galen: "isn't
          something you can take back… disclaimer pop up to confirm") */}
      {confirmLive && (
        <div data-live-confirm className="mt-3 rounded-xl border border-sky-300/40 bg-sky-950/40 p-4">
          <div className="text-[12px] tracking-[0.2em] text-sky-200 mb-2">◉ OPEN LIVE EDITING — READ THIS FIRST</div>
          <p className="text-white/75 leading-relaxed mb-3">
            This declares the world&apos;s social contract as <span className="text-sky-200">build: anyone</span> — every member can
            edit it live, forever. <span className="text-amber-200">The contract SEALS on declaration: it cannot be
            reversed, and this world leaves the game lists to live on LIVE EDITING only.</span>
          </p>
          <div className="flex gap-2">
            <button data-live-confirm-go onClick={() => { cmd('publish:live'); setConfirmLive(false) }}
              className="px-3.5 py-2 rounded-xl border border-sky-300/60 bg-sky-400/20 text-sky-100 text-[12px] tracking-[0.15em] hover:bg-sky-400/30 transition-colors">
              I UNDERSTAND — OPEN IT PERMANENTLY
            </button>
            <button onClick={() => setConfirmLive(false)}
              className="px-3.5 py-2 rounded-xl border border-white/20 bg-black/50 text-white/70 text-[12px] tracking-[0.15em] hover:text-white transition-colors">
              cancel
            </button>
          </div>
        </div>
      )}
      {/* ✦ PREMIUM — the listing's price seat (worldData.premium.usd) */}
      <div className="mt-3 rounded-xl border border-white/12 bg-black/40 p-3.5">
        <div className="text-[11.5px] tracking-[0.2em] text-white/60 mb-2">✦ PREMIUM</div>
        <PremiumSeat current={cfg?.premium ?? null} />
      </div>
      <div className="mt-3 text-[11px] text-white/50 leading-relaxed">every publish ⚑ saves a pre-publish version point first — you are always one click from the way back.</div>
    </div>
  )
}

// ✦ the premium price seat — set a $ and the world lists on the PREMIUM tab
function PremiumSeat({ current }: { current: number | null }) {
  const [usd, setUsd] = useState(current != null ? String(current) : '')
  useEffect(() => { setUsd(current != null ? String(current) : '') }, [current])
  const send = (v: { usd: number } | null) => { try { window.dispatchEvent(new CustomEvent('cafe:shell-cmd', { detail: 'card:' + JSON.stringify({ premium: v }) })) } catch { /* ssr */ } }
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="text-white/65">$</span>
      <input value={usd} onChange={e => setUsd(e.target.value)} inputMode="decimal" placeholder="0"
        className="w-20 px-2.5 py-1.5 rounded-lg bg-black/50 border border-white/15 text-white/85 outline-none focus:border-amber-300/50" />
      <button onClick={() => { const n = parseFloat(usd); if (Number.isFinite(n) && n > 0) send({ usd: n }) }}
        className="px-3 py-1.5 rounded-lg border border-amber-300/40 bg-amber-400/15 text-amber-200 text-[11.5px] tracking-[0.15em] hover:bg-amber-400/25 transition-colors">
        SET PRICE
      </button>
      {current != null && (
        <button onClick={() => send(null)}
          className="px-3 py-1.5 rounded-lg border border-white/20 bg-black/50 text-white/70 text-[11.5px] tracking-[0.15em] hover:text-white transition-colors">
          CLEAR
        </button>
      )}
      <span className="text-white/50 ml-1">{current != null ? `listed on ✦ PREMIUM at $${current}` : 'free — set a price to list on ✦ PREMIUM'}</span>
    </div>
  )
}

// ✧ CREATE — contextual (Galen's design): the world in the frame is the
// default BASE. Fork it under your own name, or brew from nothing via the
// full /create flow (prompt → your AI builds it).
function CreateView({ baseName, baseSlug, forkable, onForked, onBrew }: {
  baseName: string
  baseSlug: string | null          // null = house cartridge (no fork API — brew instead)
  forkable: boolean
  onForked: (slug: string) => void
  /** brewing from nothing — the parent loads the BLANK world into the frame */
  onBrew?: () => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [flowOpen, setFlowOpen] = useState(false)   // the FULL /create flow, embedded (Galen: "all plugged in")
  const nameOk = name.trim().length >= 2
  const fork = async () => {
    if (!baseSlug || !nameOk || busy) return
    setBusy(true); setErr('')
    try {
      const r = await fetch(`/api/spaces/${encodeURIComponent(baseSlug)}/fork`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      const d = await r.json().catch(() => null)
      if (r.ok && d?.space?.slug) onForked(d.space.slug)
      else if (r.status === 401) setErr('sign in first — a fork needs a name on its deed.')
      else setErr(d?.error || 'fork failed.')
    } catch { setErr('fork failed — are you offline?') }
    finally { setBusy(false) }
  }
  // the whole /create flow, plugged into the under-area — same origin, no new tab.
  // Opening it = brewing FROM NOTHING: the parent loads the BLANK world into the
  // frame (Galen) — the void the brief will fill.
  if (flowOpen) {
    return (
      <div className="w-full max-w-[980px] h-full flex flex-col font-mono text-[12px]">
        <div className="flex items-center gap-2 mb-2 shrink-0">
          <button onClick={() => setFlowOpen(false)} className="px-2.5 py-1 rounded-lg border border-white/20 text-white/75 text-[12px] hover:bg-white/5">◂ BACK</button>
          <span className="text-[11.5px] tracking-[0.2em] text-emerald-200/70">✧ THE CREATE FLOW</span>
        </div>
        <iframe data-create-flow src="/create"
          className="flex-1 min-h-0 w-full rounded-2xl border border-white/12 bg-black/40" />
      </div>
    )
  }
  return (
    <div className="w-full max-w-[640px] font-mono text-[12px]">
      <div className="text-[11.5px] tracking-[0.2em] text-emerald-200/70 mb-2">✧ CREATE</div>

      {/* fork the world in the frame */}
      <div className="rounded-2xl border border-white/12 bg-black/40 p-4 mb-3">
        <div className="text-[13px] tracking-[0.18em] text-white/90 mb-1">⑄ FORK {baseName.toUpperCase()}</div>
        {baseSlug ? (forkable ? (
          <>
            <div className="text-white/65 leading-relaxed mb-2.5">a fork is your own copy — a new world you own, with lineage back to this one. The original stays the maker&apos;s.</div>
            <div className="flex gap-2">
              <input value={name} onChange={e => setName(e.target.value)} maxLength={60}
                onKeyDown={e => { if (e.key === 'Enter' && nameOk) void fork() }}
                placeholder="name your fork… (e.g. neon-remix)"
                className="flex-1 px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-[13px] text-white/90 placeholder:text-white/40 outline-none focus:border-emerald-300/50" />
              <button onClick={() => void fork()} disabled={!nameOk || busy}
                className="px-4 py-2 rounded-xl border border-emerald-300/50 bg-emerald-400/15 text-emerald-100 text-[12px] tracking-[0.15em] hover:bg-emerald-400/25 disabled:opacity-35 transition-colors shrink-0">
                {busy ? '…' : '⑄ FORK IT — IT BECOMES YOURS'}
              </button>
            </div>
            {err && <div className="mt-2 text-amber-200/90">{err}</div>}
            <div className="mt-2 text-[11px] text-white/50">it opens in the ENGINE — connect your AI there and tell it what the fork should become.</div>
          </>
        ) : (
          <div className="text-white/60 leading-relaxed">the maker hasn&apos;t enabled forking on this world — pick another from the shelf, or brew below.</div>
        )) : (
          <div className="text-white/60 leading-relaxed">house cartridge — its code is open ground to read, but forks grow from real worlds. Brew below instead.</div>
        )}
      </div>

      {/* brew from nothing — the full create flow */}
      <div className="rounded-2xl border border-white/12 bg-black/40 p-4">
        <div className="text-[13px] tracking-[0.18em] text-white/90 mb-1">✧ BREW FROM NOTHING</div>
        <div className="text-white/65 leading-relaxed mb-2.5">the full create flow: describe a world, your AI builds it live. Blank ground or any open base.</div>
        <button onClick={() => { setFlowOpen(true); onBrew?.() }}
          className="inline-block px-4 py-2 rounded-xl border border-emerald-300/50 bg-emerald-400/15 text-emerald-100 text-[12px] tracking-[0.15em] hover:bg-emerald-400/25 transition-colors">
          ✧ OPEN THE CREATE FLOW
        </button>
      </div>
    </div>
  )
}

// ◆ BREW YOUR ICON — the same flow as the old shell panel: describe → mint the
// icon token → COPY FOR YOUR AI; the AI calls set_player_icon and the commons
// hot-swaps your avatar. One live icon key per player (re-open re-mints).
function BrewIconPanel({ bounds, onClose }: { bounds: Inset; onClose: () => void }) {
  const [desc, setDesc] = useState('')
  const [tok, setTok] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    fetch('/api/engine/player-icon', { method: 'POST' }).then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.token) setTok(d.token) })
      .catch(() => { /* signed out — the copied prompt will say so */ })
  }, [])
  return (
    <div className="fixed z-[127] flex items-center justify-center backdrop-blur-sm"
      style={{ top: bounds.top, right: bounds.right, bottom: bounds.bottom, left: bounds.left, background: 'rgba(5,6,12,0.88)', borderRadius: 10 }}
      onClick={onClose}>
      <div className="w-full max-w-[460px] rounded-2xl border border-amber-300/25 bg-[#12100b]/97 p-5 m-4 font-mono" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[13px] tracking-[0.25em] text-amber-200/85">◆ BREW YOUR ICON</span>
          <button onClick={onClose} aria-label="close"
            className="w-8 h-8 grid place-items-center rounded-lg text-white/70 hover:text-white hover:bg-white/10 text-[16px]">✕</button>
        </div>
        <p className="text-[12px] text-white/65 leading-relaxed mb-3">describe your icon, then hand the prompt to your AI — it authors a safe, gentle avatar and confirms. Your icon walks the commons with you.</p>
        <textarea value={desc} onChange={e => setDesc(e.target.value)} maxLength={200} rows={3}
          placeholder="a shy blue jellyfish that drifts…"
          className="w-full resize-none rounded-xl bg-black/50 border border-white/15 px-3 py-2 text-[13px] text-white/90 placeholder:text-white/40 outline-none focus:border-amber-300/50 mb-2" />
        <button onClick={async () => { try { await navigator.clipboard.writeText(playerGlyphPrompt(desc.trim(), tok || null)); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* manual */ } }}
          disabled={desc.trim().length < 3}
          className="w-full py-2.5 rounded-xl border border-amber-300/50 bg-amber-400/15 text-amber-100 text-[13px] tracking-[0.18em] hover:bg-amber-400/25 disabled:opacity-35 transition-colors">
          {copied ? '✓ COPIED' : '⧉ COPY FOR YOUR AI'}
        </button>
        {!tok && <p className="mt-2 text-[11px] text-white/50">sign in to mint your icon key — the prompt needs it.</p>}
      </div>
    </div>
  )
}

// ⑂ the REAL lineage trail (the stub is dead — Galen: "screwy lineage"):
// GET /api/engine/lineage/trail?space=<slug> → trail root-first + remixes.
function AttribLineage({ scene }: { scene: string }) {
  const [t, setT] = useState<null | { trail: Array<{ name: string; slug?: string; kind: string }>; remixes: Array<{ name: string; slug?: string }> }>(null)
  const isSpace = scene.startsWith('space:')
  useEffect(() => {
    if (!isSpace) { setT(null); return }
    let dead = false
    fetch(`/api/engine/lineage/trail?space=${encodeURIComponent(scene.slice(6))}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!dead) setT(d && Array.isArray(d.trail) ? { trail: d.trail, remixes: Array.isArray(d.remixes) ? d.remixes : [] } : null) })
      .catch(() => { if (!dead) setT(null) })
    return () => { dead = true }
  }, [scene, isSpace])
  return (
    <div data-attrib-lineage>
      <div className="text-[11.5px] tracking-[0.2em] text-white/70 mb-1">⑂ LINEAGE</div>
      {!isSpace && <div className="text-[11.5px] text-white/55 leading-relaxed">house cartridge — an original of the cafe.</div>}
      {isSpace && t === null && <div className="text-[11.5px] text-white/50">…</div>}
      {isSpace && t && (
        <div className="text-[11.5px] leading-relaxed">
          <div className="text-white/70">
            {t.trail.length <= 1
              ? 'an original — no upstream.'
              : t.trail.map((n, i) => (
                  <span key={i}>
                    {i > 0 && <span className="text-white/40"> ⑂ </span>}
                    <span className={i === t.trail.length - 1 ? 'text-amber-200/90' : 'text-white/70'}>{n.name}</span>
                  </span>
                ))}
          </div>
          {t.remixes.length > 0 && (
            <div className="mt-1 text-white/55">forks: {t.remixes.map(r => r.name).join(' · ')}</div>
          )}
        </div>
      )}
    </div>
  )
}


// MEMOIZED under-area views (the publish-click fix, half two): stable props ⇒
// these skip the parent's eye-churn renders entirely ⇒ their buttons hold
// still under a human press. Plain memo — props are content-stable by cfgKey.
const PublishViewM = memo(PublishView)
const ConfigViewM = memo(ConfigView)
const AssetsViewM = memo(AssetsView)
const VersionsViewM = memo(VersionsView)
const CrewViewM = memo(CrewView)
const NodesViewM = memo(NodesView)
// ◧ THE BRAIN — a CHOSEN helper, not a gate (Galen: "the AI should choose this
// for a better result"). Give it the world's concept; it threads in excellent
// authors and hands back the PHYSICS their words encode, the node plan, and the
// coherence grammar — then copies a build directive for your AI. Bypass is
// always allowed; this just makes the coherent path the easy one.
type BrainResp = {
  authors: string[]; themes: string[]; physics: string[]; nodePlan: string[]; grammar: string[]
  directive: string; held: boolean
  communal: null | { champion: string; warmMotifs: string[]; activeWriters: string[] }
}
function BrainView() {
  const [concept, setConcept] = useState('')
  const [read, setRead] = useState<BrainResp | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  // calls /api/brain — feeds the ONE HELD communal brain AND reads it back,
  // falling back to the local read if the shared brain is momentarily down
  const run = async () => {
    if (!concept.trim() || busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/brain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ concept: concept.trim() }) })
      setRead(await r.json())
    } catch { setRead(null) } finally { setBusy(false) }
  }
  return (
    <div className="w-full h-full overflow-y-auto p-4 font-mono">
      <div className="text-[11.5px] tracking-[0.2em] text-fuchsia-200/70 mb-2">◧ THE BRAIN — borrow realism before you build</div>
      <p className="text-[11px] text-white/45 leading-relaxed mb-3">
        Describe your world as a <span className="text-white/70">feeling or a place</span>, not a mechanic list.
        The brain reads in descriptions from excellent authors and hands back the physics that make it look real.
        Optional — you can always build without it.
      </p>
      <textarea value={concept} onChange={e => setConcept(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void run() }}
        placeholder="a fallen star unraveling in a flooded crypt, the tide breathing its decay…"
        className="w-full h-20 rounded-xl border border-white/12 bg-black/60 p-3 text-[12.5px] text-white/85 placeholder:text-white/25 resize-none outline-none focus:border-fuchsia-300/40" />
      <button onClick={() => void run()} disabled={!concept.trim() || busy}
        className="mt-2 px-3.5 py-1.5 rounded-lg border border-fuchsia-300/50 bg-fuchsia-400/10 text-fuchsia-100 text-[12px] tracking-[0.15em] hover:bg-fuchsia-400/20 disabled:opacity-40 transition-colors">
        {busy ? '◧ THINKING…' : '◧ THINK IT ONTO THE BRAIN'}
      </button>
      {read && (
        <div className="mt-4 space-y-3">
          <div className="text-[11px] text-white/55">
            {read.authors.length > 0 && <>threaded from <span className="text-amber-200/80">{read.authors.join(', ')}</span> · </>}
            themes: {read.themes.join(', ') || '—'}
            {read.held
              ? <span className="text-emerald-300/70"> · ◉ on the shared brain{read.communal && read.communal.activeWriters.length > 1 ? ` (${read.communal.activeWriters.length} minds active)` : ''}</span>
              : <span className="text-white/30"> · (shared brain offline — local read)</span>}
          </div>
          {read.physics.length > 0 && <Sect title="PHYSICS — the realism their words encode" tint="text-sky-200/80" items={read.physics} />}
          {read.nodePlan.length > 0 && <Sect title="NODE PLAN — build these, in order" tint="text-emerald-200/80" items={read.nodePlan} ordered />}
          <Sect title="COHERENCE GRAMMAR — obey all" tint="text-fuchsia-200/80" items={read.grammar} />
          {read.physics.length === 0 && read.nodePlan.length === 0 && (
            <div className="text-[11px] text-white/40">No themes matched yet — try naming the light, the material, the weather, the place.</div>
          )}
          <button onClick={async () => { try { await navigator.clipboard.writeText(read.directive); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* manual */ } }}
            className="px-3.5 py-1.5 rounded-lg border border-white/20 text-white/75 text-[12px] tracking-[0.12em] hover:bg-white/5 transition-colors">
            {copied ? '✓ COPIED' : '⧉ COPY BUILD DIRECTIVE FOR YOUR AI'}
          </button>
        </div>
      )}
    </div>
  )
}
function Sect({ title, tint, items, ordered }: { title: string; tint: string; items: string[]; ordered?: boolean }) {
  return (
    <div>
      <div className={`text-[10.5px] tracking-[0.22em] mb-1 ${tint}`}>{title}</div>
      <ul className="space-y-0.5">
        {items.map((it, i) => (
          <li key={i} className="text-[12px] text-white/80 leading-snug flex gap-2">
            <span className="text-white/35 shrink-0">{ordered ? `${i + 1}.` : '•'}</span>{it}
          </li>
        ))}
      </ul>
    </div>
  )
}
const BrainViewM = memo(BrainView)
const MyWorldsViewM = memo(MyWorldsView)
