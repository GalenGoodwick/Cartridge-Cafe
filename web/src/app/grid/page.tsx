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
import { MembershipBanner } from '@/app/cards/MembershipBanner'

type Inset = { top: number; right: number; bottom: number; left: number }
type UiSet = 'games' | 'main' | 'engine' | 'create'
type Phase = 'browse' | 'play'
type Tab = 'live' | 'published' | 'premium' | 'unfinished' | 'mine' | 'search'
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
  { slug: 'cinderfell', name: 'CINDERFELL', scene: 'CINDERFELL', maker: 'Galen' },
  // (STARFIELD removed from the shelf — Galen, Aug 28; the cartridge file
  // stays on disk for reference, nothing lists it.)
]

export default function TheGrid() {
  const [win, setWin] = useState({ w: 1280, h: 800 })
  const [uiSet, setUiSet] = useState<UiSet>('games')
  const [phase, setPhase] = useState<Phase>('browse')
  const [tab, setTab] = useState<Tab>('published')
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
  const [tool, setTool] = useState<'eye' | 'console' | 'nodes' | 'crew' | 'versions' | 'config' | 'publish' | 'chat' | 'mine' | 'connect'>('eye')   // ENGINE's under-area view
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
      if (d.cc === 'create-facets' && (d.targets === 'desktop' || d.targets === 'mobile' || d.targets === 'universal')) setCreateShape(d.targets)
      if (d.cc === 'create-born' && typeof d.slug === 'string') { setScene('space:' + d.slug); setUiSet('engine') }
    }
    window.addEventListener('message', on)
    return () => window.removeEventListener('message', on)
  }, [])
  // ⛨ ADMIN — the door shows only to admins (the API answers 200 to them alone)
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    fetch('/api/admin/worlds').then(r => setIsAdmin(r.ok)).catch(() => {})
  }, [])

  const [spaceInfo, setSpaceInfo] = useState<{ slug: string; id: string; name: string; ownerName?: string; ownerId: string; isOwner: boolean } | null | undefined>(undefined)
  useEffect(() => {
    if (!scene.startsWith('space:')) { setSpaceInfo(null); return }
    const slug = scene.slice(6)
    let dead = false
    setSpaceInfo(undefined)
    Promise.all([
      fetch(`/api/spaces/${encodeURIComponent(slug)}`).then(r => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/auth/session').then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([d, s]: [{ space?: { id: string; name?: string; ownerId: string; owner?: { name?: string | null } | null } } | null, { user?: { id?: string } } | null]) => {
      if (dead) return
      const sp = d?.space
      if (!sp?.id) { setSpaceInfo(null); return }
      const meId = s?.user?.id ?? null
      setSpaceInfo({ slug, id: sp.id, name: sp.name || slug, ownerName: sp.owner?.name ?? undefined, ownerId: sp.ownerId, isOwner: !!meId && meId === sp.ownerId })
    }).catch(() => { if (!dead) setSpaceInfo(null) })
    return () => { dead = true }
  }, [scene])
  const spc = scene.startsWith('space:') && spaceInfo && spaceInfo.slug === scene.slice(6) ? spaceInfo : null
  const spaceResolving = scene.startsWith('space:') && spaceInfo === undefined

  useEffect(() => {
    const m = () => setWin({ w: window.innerWidth, h: window.innerHeight })
    m(); window.addEventListener('resize', m)
    return () => window.removeEventListener('resize', m)
  }, [])

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
    const feed = tab === 'search' ? 'published' : tab
    fetch(`/api/cards?tab=${feed}`).then(r => r.json())
      .then((d: { cards?: Array<{ slug: string; name: string; maker?: { name?: string | null; handle?: string | null } }> }) => {
        const list = Array.isArray(d.cards) && d.cards.length
          ? d.cards.map(c => ({ slug: c.slug, name: c.name, scene: 'space:' + c.slug, maker: c.maker?.name ?? c.maker?.handle ?? undefined }))
          : (feed === 'mine' || feed === 'premium' || feed === 'unfinished' ? [] : LOCAL)   // empty deed/premium/unfinished is EMPTY, not the house shelf
        setEntries(list)
        // A TAB IS A CONTEXT (Galen): switching shelves doesn't carry the last
        // tab's game — if the frame's world isn't ON this shelf, the shelf's
        // first world loads. (Never on the FIRST load — deep links keep their w.)
        if (prevTabRef.current !== null && prevTabRef.current !== tab && list.length > 0 && !list.some(e => e.scene === scene)) {
          setScene(list[0].scene)
        }
        prevTabRef.current = tab
      })
      .catch(() => { setEntries(tab === 'mine' || tab === 'premium' || tab === 'unfinished' ? [] : LOCAL); prevTabRef.current = tab })
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
  const shown = useMemo(() =>
    tab === 'search' && q.trim()
      ? entries.filter(e => e.name.toLowerCase().includes(q.trim().toLowerCase()))
      : entries,
  [entries, tab, q])

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
  const miniTop = browsing || engineSet || createSet   // GAMES-browse, ENGINE and CREATE share the shrink-to-top layout
  const inset = useMemo<Inset>(() => {
    const W = Math.max(win.w, MIN_W + M * 2), H = Math.max(win.h, MIN_H + M + BAR_H + 10)
    if (!miniTop) return { top: M, right: M, bottom: BAR_H + 10, left: M }
    const availH = H - M - BAR_H - 10
    // ✧ CREATE declares a shape: MOBILE brews show a PORTRAIT frame (9:16) so
    // the maker SEES the world's true shape while writing the brief.
    const aspect = createSet && createShape === 'mobile' ? 9 / 16 : 16 / 10
    let w = (W - M * 2) * (aspect < 1 ? 0.18 : 0.42), h = w / aspect
    const hMax = availH * (aspect < 1 ? 0.52 : 0.4)
    if (h > hMax) { h = hMax; w = h * aspect }
    w = Math.max(w, MIN_W); h = Math.max(h, MIN_H)
    const left = Math.max((W - w) / 2, M)
    return { top: M, right: Math.max(W - left - w, M), bottom: Math.max(H - M - h, BAR_H + 10), left }
  }, [miniTop, win, createSet, createShape])

  // unified eased resize — camera re-fits every frame of the ease
  useEffect(() => {
    let raf = 0
    const t0 = performance.now()
    const tick = () => {
      try { window.dispatchEvent(new Event('resize')) } catch { /* ssr */ }
      if (performance.now() - t0 < 460) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inset])


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
  const tryPlay = useCallback(async () => {
    if (scene.startsWith('space:')) {
      const slug = scene.slice(6)
      try {
        const d = await fetch(`/api/premium?slug=${encodeURIComponent(slug)}`).then(r => r.json())
        if (d?.premium && !d.owned) { setPremGate({ slug, usd: d.premium.usd, signedIn: !!d.signedIn, buyable: !!d.buyable }); return }
      } catch { /* gate unreachable — default open (free) */ }
    }
    setUiSet('games'); setPhase('play')
  }, [scene])
  // BELT: a deep link straight to ?ph=play can't skip the gate
  useEffect(() => {
    if (phase !== 'play' || !scene.startsWith('space:')) return
    const slug = scene.slice(6)
    let dead = false
    fetch(`/api/premium?slug=${encodeURIComponent(slug)}`).then(r => r.json()).then(d => {
      if (!dead && d?.premium && !d.owned) { setPhase('browse'); setPremGate({ slug, usd: d.premium.usd, signedIn: !!d.signedIn, buyable: !!d.buyable }) }
    }).catch(() => { /* free default */ })
    return () => { dead = true }
  }, [phase, scene])
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
    return worldBriefingPrompt({ token: plugToken, worldName: selected?.name ?? 'my world', origin })
  }, [plugToken, selected])

  // cfg with STABLE IDENTITY: even when other eye fields churn (a live world's
  // graph changes every tick), the owner views' props only change when the
  // CONFIG content does — with React.memo below, their DOM holds still.
  const cfgKey = useMemo(() => { try { return JSON.stringify(eyeData?.config ?? null) } catch { return '' } }, [eyeData])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cfgStable = useMemo(() => eyeData?.config ?? null, [cfgKey])

  const sceneIsSpace = scene.startsWith('space:')
  const crewJoin = useCallback((sc: string) => { setScene(sc); setTool('connect') }, [])
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
          ? <FieldEngine key={'space-' + spc.slug} spaceId={spc.id} spaceSlug={spc.slug} spaceName={spc.name}
              spaceOwnerName={spc.ownerName} spaceOwnerId={spc.ownerId} isOwner={spc.isOwner}
              viewport={inset} externalTopbar />
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
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 max-w-[calc(100%-20px)] truncate whitespace-nowrap font-mono text-[10px] tracking-[0.2em] px-2.5 py-1 rounded-lg bg-black/70 border border-amber-300/60 text-amber-200 group-hover:bg-amber-400/20 group-hover:text-amber-100 transition-colors">
            ▶ CLICK TO PLAY{selected?.name ? ` — ${selected.name}` : ''}
          </span>
        </button>
      )}

      {/* ═ THE ICON SHELF (games·browse) ═ */}
      {browsing && (
        <div className="fixed inset-x-0 z-[112] flex flex-col items-center gap-3 px-4 overflow-y-auto"
          style={{ top: shelfTop, bottom: BAR_H + 6 }}>
          {/* TAB ROW — ◉ LIVE EDITING hooks people · FREE GAMES · PREMIUM · search */}
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-center">
            {([['live', '◉ LIVE EDITING'], ['published', 'FREE GAMES'], ['premium', '✦ PREMIUM'], ['unfinished', '⚒ UNFINISHED'], ['mine', '⌂ MY WORLDS']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`font-mono text-[10.5px] tracking-[0.18em] px-3 py-1 rounded-lg border transition-colors ${
                  tab === k ? 'bg-emerald-400/15 border-emerald-300/50 text-emerald-100' : 'bg-black/40 border-white/10 text-white/40 hover:text-white/70'}`}>
                {label}
              </button>
            ))}
            <button onClick={() => setTab('search')}
              className={`font-mono text-[10.5px] tracking-[0.18em] px-3 py-1 rounded-lg border transition-colors ${
                tab === 'search' ? 'bg-sky-400/15 border-sky-300/50 text-sky-100' : 'bg-black/40 border-white/10 text-white/40 hover:text-white/70'}`}>
              ⌕ SEARCH
            </button>
            {tab === 'search' && (
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="filter games…"
                className="font-mono text-[11px] px-3 py-1 rounded-lg bg-black/50 border border-sky-300/40 text-white/85 placeholder:text-white/25 outline-none w-44" />
            )}
          </div>
          {/* the icons */}
          {tab === 'mine' && shown.length === 0 && (
            <div className="font-mono text-[11px] text-white/45 py-6 text-center">no worlds on your deed yet — sign in, or brew one at /create.</div>
          )}
          {tab === 'premium' && shown.length === 0 && (
            <div className="font-mono text-[11px] text-white/45 py-6 text-center">no premium worlds yet.</div>
          )}
          {tab === 'unfinished' && shown.length === 0 && (
            <div className="font-mono text-[11px] text-white/45 py-6 text-center">nothing on the workbench shelf.</div>
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
                      : <span className="font-mono text-[34px] text-white/25">{e.name[0]}</span>}
                  </div>
                  <div className={`font-mono text-[10.5px] tracking-[0.1em] px-2.5 py-2 truncate ${on ? 'text-sky-100' : 'text-white/70'}`}>
                    {e.name}
                  </div>
                </button>
              )
            })}
            {tab === 'search' && q.trim() && shown.length === 0 && (
              <div className="col-span-full font-mono text-[11px] text-white/30 text-center py-6">nothing matches “{q}”</div>
            )}
          </div>
        </div>
      )}

      {/* CLICK THE FRAME → PLAY, in ENGINE too (the world is always the play
          button — the universal law). While ◎ INSPECT is on, the frame yields:
          clicks must reach the canvas to document what's under them. */}
      {(engineSet || createSet) && !eyeData?.inspect?.on && (
        <button aria-label={`play ${selected?.name ?? ''}`} onClick={() => void tryPlay()}
          className="fixed z-[114] group cursor-pointer"
          style={{ top: inset.top, right: inset.right, bottom: inset.bottom, left: inset.left, background: 'transparent', border: 'none', transition: EASE }}>
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 max-w-[calc(100%-20px)] truncate whitespace-nowrap font-mono text-[10px] tracking-[0.2em] px-2.5 py-1 rounded-lg bg-black/70 border border-amber-300/60 text-amber-200 group-hover:bg-amber-400/20 group-hover:text-amber-100 transition-colors">
            ▶ CLICK TO PLAY{selected?.name ? ` — ${selected.name}` : ''}
          </span>
        </button>
      )}

      {/* ═ THE CREATE UNDER-AREA — contextual: the world in the frame is the
          default BASE (fork it into yours) · or brew from nothing (/create). ═ */}
      {createSet && (
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
        <div className="fixed z-[128] flex items-center justify-center backdrop-blur-sm"
          style={{ top: M, right: M, bottom: BAR_H + 10, left: M, background: 'rgba(5,6,12,0.86)', borderRadius: 10 }}
          onClick={() => setSelOpen(false)}>
          <div className="p-4 w-full max-w-[520px]" onClick={e => e.stopPropagation()}>
          {/* THE BRAND — the real sign (the cup + the cafe-sign wordmark, same
              as the masthead) + the line that says what this place IS (Galen) */}
          <div className="flex flex-col items-center mb-4">
            <div className="flex items-center justify-center gap-2.5">
              <img src="/cartridge-cup.svg" alt="" className="w-9 h-9 -mt-0.5" />
              <h1 className="cafe-sign text-[24px] leading-none">cartridge<span className="not-italic font-mono text-[16px] text-brass">.cafe</span></h1>
            </div>
            <div className="font-mono text-[9.5px] tracking-[0.18em] text-white/45 mt-2">INSTANT NATURAL LANGUAGE TO GAME WORLD FRAMEWORK</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {([
              ['games', '▶', 'GAMES', 'browse the shelf — click the frame to play'],
              ['main', '◉', 'MAIN', 'the commons + social space'],
              ['engine', '⚙', 'ENGINE', 'builderbox · connect your AI · world tools'],
              ['create', '✚', 'CREATE', 'new world · fork from grid'],
            ] as const).map(([k, icon, label, sub]) => (
              <button key={k}
                onClick={() => { setUiSet(k); if (k === 'games') setPhase('browse'); setSelOpen(false) }}
                className={`text-left rounded-2xl border p-4 transition-colors active:bg-white/10 ${
                  uiSet === k ? 'border-amber-300/60 bg-amber-400/10' : 'border-white/12 bg-black/40 hover:border-white/25'}`}>
                <div className={`text-[22px] mb-1 ${uiSet === k ? 'text-amber-200' : 'text-white/70'}`}>{icon}</div>
                <div className={`font-mono text-[14px] tracking-[0.2em] ${uiSet === k ? 'text-amber-100' : 'text-white/90'}`}>{label}</div>
                <div className="font-mono text-[10px] text-white/40 mt-1 leading-relaxed">{sub}</div>
              </button>
            ))}
            {isAdmin && (
              <a href="/admin" data-grid-admin
                className="col-span-2 text-left rounded-2xl border border-amber-300/25 bg-black/40 hover:border-amber-300/50 p-4 transition-colors flex items-center gap-3">
                <span className="text-[20px] text-amber-200/80">⛨</span>
                <span>
                  <span className="font-mono text-[13px] tracking-[0.2em] text-amber-100/95 block">ADMIN</span>
                  <span className="font-mono text-[10px] text-white/40">every world (private too) · visibility · analytics</span>
                </span>
              </a>
            )}
            {me ? (
            <a href="/account" data-grid-account
              className="col-span-2 text-left rounded-2xl border border-white/12 bg-black/40 hover:border-white/25 p-4 transition-colors flex items-center gap-3">
              <span className="text-[20px] text-emerald-300/80">◐</span>
              <span className="min-w-0 flex-1">
                <span className="font-mono text-[13px] tracking-[0.2em] text-white/90 block truncate">{me.name ?? me.email ?? 'SIGNED IN'}</span>
                <span className="font-mono text-[10px] text-white/40">account page — membership · purchases · sign out</span>
              </span>
              <span className="font-mono text-[14px] text-white/40 shrink-0">▸</span>
            </a>
            ) : (
            <a href={'/auth/signin?callbackUrl=' + encodeURIComponent('/grid')} data-grid-account
              className="col-span-2 text-left rounded-2xl border border-white/12 bg-black/40 hover:border-white/25 p-4 transition-colors flex items-center gap-3">
              <span className="text-[20px] text-white/70">◐</span>
              <span>
                <span className="font-mono text-[13px] tracking-[0.2em] text-white/90 block">ACCOUNT</span>
                <span className="font-mono text-[10px] text-white/40">sign in · membership</span>
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
            <div className="text-[12px] tracking-[0.25em] text-emerald-200/80 mb-2">⚿ CONNECT YOUR AI</div>
            <p className="text-[11px] text-white/50 leading-relaxed mb-3">Paste this into your working AI (Claude, or any MCP agent) — it carries your world&rsquo;s build key, reads the guide, and builds with you.</p>
            {plugErr && <p className="text-[11px] text-amber-200/85 leading-relaxed mb-2">{plugErr}</p>}
            {!plugErr && !plugToken && <p className="text-[11px] text-white/45 mb-2">minting a build key…</p>}
            {plugToken && <>
              <div className="rounded-xl bg-black/60 border border-white/12 p-3 text-[11.5px] text-white/80 leading-relaxed select-all whitespace-pre-wrap max-h-[46vh] overflow-y-auto">{connectPrompt}</div>
              <button onClick={async () => { try { await navigator.clipboard.writeText(connectPrompt); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* manual */ } }}
                className="mt-3 w-full py-2.5 rounded-xl border border-emerald-300/50 bg-emerald-400/15 text-emerald-100 text-[12px] tracking-[0.18em] hover:bg-emerald-400/25 transition-colors">
                {copied ? '✓ COPIED — PASTE TO YOUR AI' : '⧉ COPY THE PROMPT (with your build key)'}
              </button>
              <p className="text-[10px] text-white/35 mt-2">this key IS write-access to this world — share only with your AI. Re-opening mints a fresh one.</p>
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
            <div className="font-mono text-[12px] tracking-[0.25em] text-white/50 mb-2">? INSTRUCTIONS — {selected?.name}</div>
            <div className="font-mono text-[13px] leading-relaxed text-white/80 whitespace-pre-wrap">{instrText}</div>
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
            {selected?.maker && <div className="text-[12px] text-amber-200/85 mb-3">by {selected.maker}</div>}
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
            {([['eye', '◈ EYE'], ['console', '⌁ CONSOLE'], ['nodes', '⬢ NODES'], ['crew', '⛭ CO-BUILD'], ['versions', '⏱ VERSIONS'], ['config', '⚙ CONFIG'], ['publish', '⬆ PUBLISH'], ['chat', '◉ CHAT'], ['mine', '⌂ MY WORLDS']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setTool(k)}
                className={`font-mono text-[10.5px] tracking-[0.18em] px-3 py-1 rounded-lg border transition-colors ${
                  tool === k ? 'bg-sky-400/15 border-sky-300/50 text-sky-100' : 'bg-black/40 border-white/10 text-white/45 hover:text-white/75'}`}>
                {label}
              </button>
            ))}
            <button onClick={() => setTool('connect')}
              className={`font-mono text-[10.5px] tracking-[0.18em] px-3 py-1 rounded-lg border transition-colors ${
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
                  <span className="text-[10.5px] tracking-[0.2em] text-sky-200/70">◈ THE EYE — hand the AI your view</span>
                  <div className="flex items-center gap-2">
                    {/* ◎ INSPECT — click-telling: while ON, canvas clicks document
                        what's under them (wd.__clicks) for the AI; game input paused */}
                    <button onClick={() => cmd('inspect')}
                      className={`px-3 py-1.5 rounded-lg border text-[11px] tracking-[0.15em] transition-colors ${
                        eyeData?.inspect?.on ? 'bg-sky-500/25 border-sky-400/60 text-sky-100' : 'border-white/15 bg-black/40 text-white/60 hover:text-white'}`}>
                      {eyeData?.inspect?.on ? '◉ INSPECT ON' : '◎ INSPECT'}
                    </button>
                    <button onClick={() => { try { window.dispatchEvent(new CustomEvent('cafe:shell-cmd', { detail: 'snapshot' })) } catch { /* ssr */ } }}
                      className="px-3.5 py-1.5 rounded-lg border border-sky-300/50 bg-sky-400/10 text-sky-100 text-[11px] tracking-[0.15em] hover:bg-sky-400/20 transition-colors">
                      {eyeData?.shot === 'sending' ? '…' : eyeData?.shot === 'sent' ? '✓ SENT TO THE AI' : '📸 SNAPSHOT → AI'}
                    </button>
                  </div>
                </div>
                {eyeData?.focus?.action && (
                  <div className="text-[10.5px] text-white/60 mb-2">ai focus: <span className="text-emerald-200/90">{eyeData.focus.action}</span>{eyeData.focus.fieldName ? <span className="text-white/45"> · {eyeData.focus.fieldName}</span> : null}</div>
                )}
                <div className="relative flex-1 min-h-0 rounded-xl border border-white/12 bg-black/50 grid place-items-center overflow-hidden">
                  {eyeData?.eye?.png && (eyeData.eye.at ?? 1) > eyeCleared ? (
                    <>
                      <img src={`data:image/png;base64,${eyeData.eye.png}`.replace('base64,data:', '').replace('base64,i', 'base64,i')} alt="the eye" className="max-w-full max-h-full object-contain" />
                      <button data-eye-clear onClick={() => setEyeCleared(eyeData?.eye?.at ?? Date.now())}
                        title="clear this snapshot — the next probe or 📸 reappears on its own"
                        className="absolute top-2 right-2 px-2.5 py-1 rounded-lg border border-white/25 bg-black/70 text-white/75 text-[10.5px] tracking-[0.15em] hover:text-white hover:bg-black/85 transition-colors">
                        ✕ CLEAR
                      </button>
                    </>
                  ) : <span className="text-[11px] text-white/45 p-6 text-center">no image yet — 📸 sends your live frame to the connected AI over the bridge; its probes land here too.</span>}
                </div>
                {/* the INSPECT feed — every documented click, newest first */}
                {eyeData?.inspect?.on && (
                  <div className="mt-2 max-h-[30%] overflow-y-auto rounded-xl border border-sky-400/25 bg-black/50 p-2.5 text-[10.5px] leading-relaxed">
                    {!eyeData.inspect.log?.length && <div className="text-white/45">click anything in the world above — each click is documented for the AI (game input paused).</div>}
                    {[...(eyeData.inspect.log ?? [])].reverse().map((en, i) => (
                      <div key={i} className="py-0.5 border-b border-white/5 last:border-0 text-white/75">
                        <span className="text-sky-200/90">({en.x},{en.y})</span>
                        {en.color && <span className="ml-2" style={{ color: en.color }}>■ {en.color}</span>}
                        {en.field && <span className="text-white/55 ml-2">field {en.field}</span>}
                        {en.visual && <span className="text-emerald-200/80 ml-2">{en.visual}</span>}
                        {en.entity && <span className="text-amber-200/80 ml-2">entity #{en.entity.id}{en.entity.label ? ` ${en.entity.label}` : ''}</span>}
                        {en.ui && <span className="text-white/60 ml-2">ui {en.ui.id}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {tool === 'console' && (
              <div className="w-full h-full flex flex-col p-4 font-mono">
                <div className="text-[10.5px] tracking-[0.2em] text-emerald-200/70 mb-2">⌁ CONSOLE — the AI building, step by step</div>
                <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-white/12 bg-black/50 p-3 text-[11px] leading-relaxed">
                  {aiLog.length === 0 && <div className="text-white/45">no AI edits this session — connect an AI and every build step lands here, named and timed.</div>}
                  {aiLog.map((l, i) => (
                    <div key={i} className="flex gap-2 py-0.5 border-b border-white/5 last:border-0">
                      <span className="text-white/45 shrink-0">{new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                      <span className="text-emerald-200/90 shrink-0">{l.type}</span>
                      <span className="text-white/85 truncate">{l.summary}</span>
                      {l.author && <span className="text-amber-200/70 shrink-0 ml-auto">{l.author}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {tool === 'nodes' && <NodesViewM graph={eyeData?.graph ?? null} />}
            {tool === 'crew' && <CrewViewM icons={icons} current={scene} onJoin={crewJoin} />}
            {tool === 'versions' && <VersionsViewM cfg={cfgStable} />}
            {tool === 'publish' && <PublishViewM cfg={cfgStable} />}
            {tool === 'mine' && <MyWorldsViewM icons={icons} current={scene} onPick={pickScene} />}
            {tool === 'config' && (
              <ConfigViewM cfg={cfgStable} sceneIsSpace={sceneIsSpace} />
            )}
            {tool === 'chat' && (
              <GridChat inline slotKey={'world-chat:' + (scene.startsWith('space:') ? scene.slice(6).toUpperCase() : scene)} title={selected?.name ?? 'THIS WORLD'} />
            )}
            {tool === 'connect' && (
              <div className="w-full h-full overflow-y-auto p-4 font-mono">
                <div className="text-[10.5px] tracking-[0.2em] text-emerald-200/80 mb-2">⚿ CONNECT YOUR AI</div>
                <p className="text-[11px] text-white/60 leading-relaxed mb-3">Paste this into your working AI (Claude, or any MCP agent) — it carries your world&rsquo;s build key, reads the guide, and builds with you.</p>
                {plugErr && <p className="text-[11px] text-amber-200/85 leading-relaxed mb-2">{plugErr}</p>}
                {!plugErr && !plugToken && <p className="text-[11px] text-white/45 mb-2">minting a build key…</p>}
                {plugToken && <>
                  <div className="rounded-xl bg-black/60 border border-white/12 p-3 text-[11.5px] text-white/80 leading-relaxed select-all whitespace-pre-wrap max-h-[46vh] overflow-y-auto">{connectPrompt}</div>
                  <button onClick={async () => { try { await navigator.clipboard.writeText(connectPrompt); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* manual */ } }}
                    className="mt-3 w-full py-2.5 rounded-xl border border-emerald-300/50 bg-emerald-400/15 text-emerald-100 text-[12px] tracking-[0.18em] hover:bg-emerald-400/25 transition-colors">
                    {copied ? '✓ COPIED — PASTE TO YOUR AI' : '⧉ COPY THE PROMPT (with your build key)'}
                  </button>
                  <p className="text-[10px] text-white/35 mt-2">this key IS write-access to this world — share only with your AI. Re-opening mints a fresh one.</p>
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
      {brewIconOpen && uiSet === 'main' && (
        <BrewIconPanel bounds={inset} onClose={() => setBrewIconOpen(false)} />
      )}

      {/* ✦ THE PREMIUM GATE — field-bounded; buy once, it's on your account */}
      {premGate && (
        <div className="fixed z-[128] flex items-center justify-center backdrop-blur-sm"
          style={{ top: inset.top, right: inset.right, bottom: inset.bottom, left: inset.left, background: 'rgba(5,6,12,0.9)', borderRadius: 10 }}
          onClick={() => setPremGate(null)}>
          <div className="w-full max-w-[440px] rounded-2xl border border-amber-300/30 bg-[#14100a]/97 p-5 m-4 font-mono" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] tracking-[0.25em] text-amber-200/90">✦ PREMIUM WORLD</span>
              <button onClick={() => setPremGate(null)} aria-label="close"
                className="w-8 h-8 grid place-items-center rounded-lg text-white/60 hover:text-white hover:bg-white/10 text-[16px]">✕</button>
            </div>
            <div className="text-[15px] tracking-[0.15em] text-white/95 mb-1">{selected?.name ?? premGate.slug.toUpperCase()}</div>
            <p className="text-[11px] text-white/55 leading-relaxed mb-3">buy it once — it saves to your account and this world opens for you forever (plus co-program access).</p>
            {premGate.err && <p className="text-[11px] text-amber-200/90 mb-2">{premGate.err}</p>}
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
                className="w-full py-2.5 rounded-xl border border-amber-300/50 bg-amber-400/15 text-amber-100 text-[12px] tracking-[0.18em] hover:bg-amber-400/25 disabled:opacity-40 transition-colors">
                {premGate.busy ? '…' : premGate.buyable ? `✦ BUY & PLAY — $${premGate.usd}` : 'payments not configured yet'}
              </button>
            ) : (
              <a data-prem-signin href={'/auth/signin?callbackUrl=' + encodeURIComponent('/grid?w=space:' + premGate.slug + '&buy=' + premGate.slug)}
                className="block text-center w-full py-2.5 rounded-xl border border-amber-300/50 bg-amber-400/15 text-amber-100 text-[12px] tracking-[0.18em] hover:bg-amber-400/25 transition-colors">
                CREATE ACCOUNT / SIGN IN — THEN BUY ${premGate.usd}
              </a>
            )}
          </div>
        </div>
      )}

      {/* ═ THE BOTTOM BAR ═  The DOCKSTAR is ABSOLUTELY centered and PRIMARY
          (Galen: "always primary and centered" — mobile was smooshing it out).
          Side zones are absolute and overflow-hidden: they can never push the
          cup. NARROW: no title, no REC — the phone bar is cup + essentials. */}
      <div className="fixed bottom-0 inset-x-0 z-[135]" style={{ height: BAR_H }}>
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
              className="font-mono text-[12px] tracking-[0.16em] px-3.5 py-2 rounded-xl border bg-black/60 border-white/20 text-amber-100/95 hover:border-amber-300/50 transition-colors shrink-0">
              Cartridge.Cafe
            </button>
            ) : uiSet !== 'engine' ? (
            <button data-grid-title onClick={() => { setAttribOpen(o => !o); setSelOpen(false) }}
              className="font-mono text-[12px] tracking-[0.16em] px-3.5 py-2 rounded-xl border bg-black/60 border-white/20 text-white/90 hover:border-amber-300/50 transition-colors shrink-0 max-w-full truncate">
              {selected?.name ?? '—'}
            </button>
            ) : null)}
            <span className="flex-1" />
            {/* ◉ COMMONS — immediately left of the dockstar (MAIN) */}
            {uiSet === 'main' && (
              <button data-grid-commons onClick={() => { setChatOpen(o => !o); setBrewIconOpen(false); setSelOpen(false); setInstrOpen(false) }}
                className={`font-mono text-[11px] tracking-[0.18em] px-3.5 py-2 rounded-xl border transition-colors shrink-0 ${
                  chatOpen ? 'bg-emerald-400/25 border-emerald-300/60 text-emerald-100' : 'bg-black/70 border-white/25 text-white/85 hover:text-white'}`}>
                ◉ COMMONS
              </button>
            )}
            {/* ● REC — GAMES-play, desktop only (Galen: not needed on mobile) */}
            {!narrow && uiSet === 'games' && phase === 'play' && (
              <button data-grid-rec onClick={() => cmd('rec')}
                title={rec.on ? 'stop & download the recording' : 'record this world to a video file — nothing is uploaded'}
                className={`font-mono text-[11px] tracking-[0.18em] px-3.5 py-2 rounded-xl border transition-colors inline-flex items-center gap-2 shrink-0 ${
                  rec.on ? 'bg-red-500/25 border-red-400/60 text-red-100' : 'bg-black/70 border-white/25 text-white/85 hover:text-white'}`}>
                <span className={`inline-block w-2 h-2 rounded-full bg-red-500 ${rec.on ? 'animate-pulse' : ''}`} />
                {rec.on ? `${Math.floor(rec.secs / 60)}:${String(rec.secs % 60).padStart(2, '0')}` : 'REC'}
              </button>
            )}
          </div>
          {/* THE DOCKSTAR — absolutely centered; nothing can move it */}
          <button onClick={() => { setSelOpen(o => !o); setInstrOpen(false); setConnectOpen(false); setAttribOpen(false); setBrewIconOpen(false) }} aria-label="ui selector"
            title="the dockstar — choose your UI"
            className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 grid place-items-center rounded-2xl border transition-all z-10 ${
              selOpen ? 'bg-amber-400/25 border-amber-300/70 scale-105' : 'bg-black/60 border-white/20 hover:border-amber-300/50 hover:bg-black/80'}`}
            style={{ boxShadow: selOpen ? '0 0 18px rgba(245,176,76,0.35)' : '0 2px 8px rgba(0,0,0,0.5)' }}>
            <img src="/cartridge-cup.svg" alt="" className="w-7 h-7" />
          </button>
          {/* RIGHT ZONE */}
          <div className="absolute inset-y-0 right-0 flex items-center justify-start gap-2 pr-3 overflow-hidden" style={{ left: 'calc(50% + 38px)' }}>
            {/* ◆ BREW ICON — immediately right of the dockstar (MAIN) */}
            {uiSet === 'main' && (
              <button data-grid-brewicon onClick={() => { setBrewIconOpen(o => !o); setChatOpen(false); setSelOpen(false); setInstrOpen(false) }}
                className={`font-mono text-[11px] tracking-[0.18em] px-3.5 py-2 rounded-xl border transition-colors shrink-0 ${
                  brewIconOpen ? 'bg-amber-400/25 border-amber-300/60 text-amber-100' : 'bg-black/70 border-white/25 text-white/85 hover:text-white'}`}>
                ◆ BREW ICON
              </button>
            )}
            <span className="flex-1" />
            {/* ? INSTRUCTIONS — GAMES only (not MAIN, not ENGINE, not CREATE) */}
            {uiSet === 'games' && (
            <button onClick={() => { setInstrOpen(o => !o); setSelOpen(false); setConnectOpen(false) }}
              className={`font-mono text-[11px] tracking-[0.18em] px-3.5 py-2 rounded-xl border transition-colors shrink-0 ${
                instrOpen ? 'bg-white/20 border-white/40 text-white' : 'bg-black/70 border-white/25 text-white/85 hover:text-white'}`}>
              ? INSTRUCTIONS
            </button>
            )}
            {uiSet === 'games' && phase === 'play' && (
              <button onClick={async () => {
                const url = window.location.href
                try { await navigator.share?.({ url, title: selected?.name }) }
                catch { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* manual */ } }
                if (!navigator.share) { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* manual */ } }
              }}
                className="font-mono text-[11px] tracking-[0.18em] px-3.5 py-2 rounded-xl border bg-black/70 border-white/25 text-white/85 hover:text-white transition-colors shrink-0">
                {copied ? '✓ COPIED' : '↗ SHARE'}
              </button>
            )}
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
      <div className="text-[10.5px] tracking-[0.2em] text-sky-200/70 mb-1">⛭ CO-BUILD — open live-editing worlds, join in</div>
      <p className="text-[10.5px] text-white/45 mb-3">these worlds build in the open — join one and it loads with the ⚿ connect prompt ready for your AI. Editing membership covers every open world.</p>
      {open === null && <div className="text-[11px] text-white/45">…</div>}
      {open?.length === 0 && <div className="text-[11px] text-white/45">no open builds right now — ⬆ PUBLISH can open one of yours (permanently).</div>}
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
                  : <span className="text-[20px] text-white/30">{e.name.slice(0, 1)}</span>}
              </div>
              <div className="px-2 py-1.5">
                <div className="text-[10px] tracking-[0.12em] text-white/85 truncate">{e.name}</div>
                <div className="text-[9px] text-sky-200/80 tracking-[0.15em]">◉ JOIN THE BUILD</div>
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
          <button onClick={() => setSel(null)} className="px-2.5 py-1 rounded-lg border border-white/20 text-white/75 text-[11px] hover:bg-white/5">◂ BACK</button>
          <span className={`text-[10px] tracking-[0.15em] ${tint[sel.kind]}`}>{sel.kind.toUpperCase()}</span>
          <span className="text-[12px] text-white/90 truncate">{sel.title}</span>
          {'author' in sel && (sel as { author?: string }).author ? <span className="ml-auto text-[10px] text-amber-200/70">{(sel as { author?: string }).author}</span> : null}
        </div>
        <pre className="flex-1 min-h-0 overflow-auto rounded-xl border border-white/12 bg-black/60 p-3 text-[10.5px] leading-relaxed text-white/85 whitespace-pre-wrap break-words">
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
        className="w-full text-left flex items-center py-1 px-1 rounded hover:bg-white/5 text-[11.5px] leading-snug">
        <span className="shrink-0 text-white/25 whitespace-pre">{pre}</span>
        <span className={`shrink-0 mr-2 ${tint[n.kind]}`}>●</span>
        <span className="text-white/90 truncate">{n.title}</span>
      </button>
    )
    const Stage = ({ label }: { label: string }) => (
      <div className="flex items-center gap-2 my-1.5 text-[9.5px] tracking-[0.25em] text-white/40">
        <span className="text-sky-300/60">↓</span>{label}
      </div>
    )
    return (
      <div className="w-full h-full overflow-y-auto p-4 font-mono">
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => setMode('list')} className="px-2.5 py-1 rounded-lg border border-white/20 text-white/75 text-[11px] hover:bg-white/5">◂ BACK</button>
          <span className="text-[10.5px] tracking-[0.2em] text-sky-200/70">⬡ THE FLOW — tap any node for its code</span>
        </div>
        {hooks.length > 0 && <>
          <div className="text-[9.5px] tracking-[0.25em] text-violet-300/70">✎ HOOKS — run every tick, drive the world</div>
          {hooks.map((n, i) => <NodeBtn key={n.id} n={n} pre={i === hooks.length - 1 ? ' └─ ' : ' ├─ '} />)}
          <Stage label="DRIVE THE VISUALS" />
        </>}
        <div className="text-[9.5px] tracking-[0.25em] text-amber-200/70">◆ VISUALS ─paint→ ▦ FIELDS</div>
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
          <div className="mt-1 text-[9.5px] tracking-[0.25em] text-sky-200/60">▦ FIELDS with no visual (data only — render as nothing)</div>
          {orphanFields.map((n, i) => <NodeBtn key={n.id} n={n} pre={i === orphanFields.length - 1 ? ' └─ ' : ' ├─ '} />)}
        </>}
        {modules.length > 0 && <>
          <Stage label="COMPOSED FROM" />
          <div className="text-[9.5px] tracking-[0.25em] text-emerald-200/70">⚙ MODULES — the shader library under every visual</div>
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
        <span className="text-[10.5px] tracking-[0.2em] text-sky-200/70">⬢ NODES — who builds what</span>
        <button onClick={() => setMode('adv')} disabled={!graph}
          className="px-3 py-1 rounded-lg border border-sky-300/40 text-sky-200/90 text-[10px] tracking-[0.15em] hover:bg-sky-400/10 disabled:opacity-35">
          ⬡ ADVANCED
        </button>
      </div>
      {!graph && <div className="text-[11px] text-white/45">reading the world…</div>}
      {graph && rows.length === 0 && <div className="rounded-xl border border-white/12 bg-black/50 p-3.5 text-[11.5px] text-white/60">an empty world — no nodes yet.</div>}
      {rows.map(n => (
        <button key={n.id} onClick={() => { setSel(n) }}
          className="w-full text-left flex items-center gap-3 py-1.5 border-b border-white/8 text-[11.5px] hover:bg-white/5">
          <span className={`shrink-0 w-14 text-[9.5px] tracking-[0.15em] ${tint[n.kind]}`}>{n.kind.toUpperCase()}</span>
          <span className="text-white/90 truncate">{n.title}</span>
          {'author' in n && (n as { author?: string }).author ? <span className="ml-auto text-amber-200/70 shrink-0">{(n as { author?: string }).author}</span> : null}
        </button>
      ))}
    </div>
  )
}

// ⚙ CONFIG — the old world tools, for real (minus lineage — that lives on the
// title). Space owners get the management overlay (name · visibility · keys);
// the toggles drive the engine's own writes over cfg: commands.
function ConfigView({ cfg, sceneIsSpace }: {
  cfg: GridCfg | null
  sceneIsSpace: boolean
}) {
  const fire = (k: string) => { try { window.dispatchEvent(new CustomEvent('cafe:shell-cmd', { detail: 'cfg:' + k })) } catch { /* ssr */ } }
  const Row = ({ label, on, k, disabled, hint }: { label: string; on: boolean; k: string; disabled?: boolean; hint?: string }) => (
    <div className="flex items-center justify-between py-2 border-b border-white/8 text-[12px]" title={hint}>
      <span className="text-white/80">{label}</span>
      <button onClick={() => fire(k)} disabled={disabled}
        className={`px-2.5 py-0.5 rounded-full border text-[11px] tracking-[0.15em] transition-colors disabled:opacity-35 ${
          on ? 'bg-emerald-400/20 border-emerald-300/50 text-emerald-200' : 'bg-white/5 border-white/15 text-white/45'}`}>
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

  // ◲ SPRITES — the real panel, embedded in the under-area (never over the game)
  const [spritesOpen, setSpritesOpen] = useState(false)

  return (
    <div className="relative w-full h-full overflow-y-auto p-4 font-mono">
      <div className="text-[10.5px] tracking-[0.2em] text-amber-200/70 mb-2">⚙ WORLD CONFIG</div>
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
        {/* ▦ DEVICE — the fit law: which doors admit phones */}
        <div className="flex items-center justify-between py-2 text-[12px]"
          title="AUTO = desktop by default. MOBILE declares this world phone-fit (phones are admitted); DESKTOP declares it desktop-only.">
          <span className="text-white/80">device</span>
          <span className="flex gap-1.5">
            {(['auto', 'mobile', 'desktop'] as const).map(d => (
              <button key={d} data-cfg-device={d} disabled={!ownerLaw}
                onClick={() => { try { window.dispatchEvent(new CustomEvent('cafe:shell-cmd', { detail: 'card:' + JSON.stringify({ device: d === 'auto' ? null : d }) })) } catch { /* ssr */ } }}
                className={`px-2.5 py-0.5 rounded-full border text-[10.5px] tracking-[0.12em] transition-colors disabled:opacity-35 ${
                  (cfg?.device ?? 'auto') === d ? 'border-sky-300/60 bg-sky-400/15 text-sky-200' : 'border-white/15 text-white/45 hover:text-white'}`}>
                {d.toUpperCase()}
              </button>
            ))}
          </span>
        </div>
        {(cfg?.gridW || cfg?.gridH) && (
          <div className="flex items-center justify-between py-2 border-t border-white/8 text-[12px]">
            <span className="text-white/80" title="declared world dimensions — the frame cover-fills to these; undeclared worlds letterbox by design">dimensions</span>
            <span className="text-white/55 font-mono">{cfg?.gridW ?? '—'} × {cfg?.gridH ?? '—'}</span>
          </div>
        )}
      </div>

      {/* ▤ THE CARD — what the catalog deals: kind · type · tags · blurb ·
          story · instructions. Writes ride the card: cmd into worldData. */}
      {ownedSpace && <CardSection cfg={cfg} />}

      {/* owner workbench — invite / icon / sprites */}
      {ownedSpace && (
        <div className="rounded-xl border border-white/12 bg-black/40 p-3.5 mb-3 text-[11px]">
          <div className="text-[10.5px] tracking-[0.2em] text-white/50 mb-2">THE WORKBENCH</div>
          <div className="flex flex-wrap gap-2">
            <button onClick={mintInvite}
              title="mint a ONE-TIME join link — the first signed-in person to open it joins your crew as a builder; the link dies on use"
              className="px-3 py-1.5 rounded-lg border border-white/20 bg-black/50 text-white/80 hover:text-white text-[11px] tracking-[0.15em] transition-colors">
              {invite === 'busy' ? '…' : invite === 'copied' ? '✓ LINK COPIED' : invite === 'failed' ? 'MINT FAILED' : '⚭ INVITE A BUILDER'}
            </button>
            <button onClick={() => setSpritesOpen(true)}
              title="upload pixel art — rip sprite sheets into slots any visual can sample"
              className="px-3 py-1.5 rounded-lg border border-white/20 bg-black/50 text-white/80 hover:text-white text-[11px] tracking-[0.15em] transition-colors">
              ◲ SPRITES
            </button>
          </div>
          <div className="mt-3 flex gap-2 items-center">
            <input value={iconDesc} onChange={e => setIconDesc(e.target.value)} maxLength={120}
              placeholder="◆ icon: describe it (optional)…"
              className="flex-1 px-2.5 py-1.5 rounded-lg bg-black/50 border border-white/15 text-[11px] text-white/85 placeholder:text-white/30 outline-none focus:border-white/35" />
            <button onClick={copyIconPrompt}
              title="your AI writes a tiny shader icon for this world's shelf bubble — copy the prompt, paste it to your AI"
              className="px-3 py-1.5 rounded-lg border border-white/20 bg-black/50 text-white/80 hover:text-white text-[11px] tracking-[0.15em] transition-colors shrink-0">
              {iconCopied ? '✓ COPIED' : '◆ MAKE ICON'}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-white/12 bg-black/40 p-3.5 text-[11px] leading-relaxed text-white/55">
        social contract: <span className="text-white/85">{cfg?.policy ? `build: ${cfg.policy} · sealed` : 'undeclared · default (owner builds, everyone plays)'}</span>
        {!sceneIsSpace && <div className="mt-1.5 text-white/40">house cartridge — owner controls apply on real worlds.</div>}
      </div>

      {/* the sprites panel fills THIS area — the under-area, never the game */}
      {spritesOpen && slug && <SpritesPanel slug={slug} onClose={() => setSpritesOpen(false)} />}
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
    return <div className="w-full h-full grid place-items-center p-6 font-mono text-[11px] text-white/45 text-center">house cartridge — versions live on real worlds.</div>
  }
  return (
    <div className="w-full h-full overflow-y-auto p-4 font-mono">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <span className="text-[10.5px] tracking-[0.2em] text-amber-200/70">⏱ VERSIONS — every save point of this world</span>
        {owner && (
          <div className="flex gap-2 items-center">
            <input value={verNote} onChange={e => setVerNote(e.target.value)} maxLength={200} placeholder="note (optional)"
              className="w-36 px-2 py-1 rounded-lg bg-black/50 border border-white/15 text-[10.5px] text-white/85 placeholder:text-white/30 outline-none focus:border-white/35" />
            <button onClick={savePoint} disabled={verBusy}
              className="px-2.5 py-1 rounded-lg border border-amber-300/40 bg-amber-400/15 text-amber-200 text-[10.5px] tracking-[0.15em] hover:bg-amber-400/25 disabled:opacity-40 transition-colors">
              {verBusy ? '…' : '⚑ SAVE A POINT'}
            </button>
          </div>
        )}
      </div>
      <button onClick={() => owner && cmd('ver:live')} disabled={!owner}
        className={`w-full text-left px-2.5 py-1.5 rounded-lg mb-1 border text-[11px] transition-colors disabled:cursor-default ${
          cfg?.ver == null ? 'border-emerald-300/50 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-black/30 text-white/65 hover:text-white'}`}>
        LIVE <span className="text-white/40 ml-2">now</span>
      </button>
      {[...vers].sort((a, b) => b.version - a.version).map(v => (
        <button key={v.version} onClick={() => owner && cmd('ver:' + v.version)} disabled={!owner}
          className={`w-full text-left px-2.5 py-1.5 rounded-lg mb-1 border text-[11px] transition-colors disabled:cursor-default ${
            cfg?.ver === v.version ? 'border-emerald-300/50 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-black/30 text-white/65 hover:text-white'}`}>
          v{v.version}
          <span className="text-white/40 ml-2">{new Date(v.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          {v.note && <span className="text-amber-200/70 ml-2">{v.note}</span>}
        </button>
      ))}
      {vers.length === 0 && <div className="text-white/40 px-1 py-1">no save points yet{owner ? ' — ⚑ makes one from the live world.' : '.'}</div>}
      {!owner && <div className="mt-2 text-[10px] text-white/40">only the maker restores versions.</div>}
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
      <div className="text-[10.5px] tracking-[0.2em] text-emerald-200/70 mb-2">⌂ MY WORLDS — pick one into the frame</div>
      {mine === null && <div className="text-[11px] text-white/45">…</div>}
      {mine?.length === 0 && <div className="text-[11px] text-white/45">no worlds on your deed yet — sign in, or brew one at /create.</div>}
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
                  : <span className="text-[20px] text-white/30">{e.name.slice(0, 1)}</span>}
              </div>
              <div className="px-2 py-1.5 text-[10px] tracking-[0.12em] text-white/85 truncate">{e.name}</div>
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
    <div className="rounded-xl border border-white/12 bg-black/40 p-3.5 mb-3 text-[11px] space-y-2">
      <div className="text-[10.5px] tracking-[0.2em] text-white/50">▤ THE CARD — what the catalog deals</div>
      <div className="flex items-center gap-1.5">
        {(['auto', 'toy', 'world', 'game'] as const).map(k => (
          <button key={k} data-card-kind={k}
            onClick={() => { setKind(k); send({ card: { kind: k === 'auto' ? null : k } }) }}
            title={k === 'auto' ? 'the anatomy decides: rules built → game; multiplayer/big grid → world; else toy' : k}
            className={`px-2.5 py-0.5 rounded-full border text-[10.5px] tracking-[0.12em] transition-colors ${kind === k
              ? 'border-amber-300/60 bg-amber-400/15 text-amber-200' : 'border-white/20 text-white/50 hover:text-white'}`}>
            {k.toUpperCase()}
          </button>
        ))}
      </div>
      <select value={typ} onChange={e => { setTyp(e.target.value); send({ card: { type: e.target.value || null } }) }}
        className="w-full bg-black/50 border border-white/15 rounded-lg px-2.5 py-1.5 text-[11px] text-white/85 outline-none focus:border-amber-300/50">
        <option value="">type… (the vocabulary)</option>
        {types.map(t => <option key={t.id} value={t.id}>{t.label ?? t.id}</option>)}
      </select>
      <input value={tags} onChange={e => setTags(e.target.value)}
        onBlur={() => send({ card: { tags: tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) } })}
        placeholder="tags, comma, separated"
        className="w-full bg-black/50 border border-white/15 rounded-lg px-2.5 py-1.5 text-[11px] text-white/85 placeholder:text-white/30 outline-none focus:border-amber-300/50" />
      <input value={blurb} onChange={e => setBlurb(e.target.value)} onBlur={() => send({ blurb: blurb.trim() })}
        placeholder="the blurb — one line the card shows"
        className="w-full bg-black/50 border border-white/15 rounded-lg px-2.5 py-1.5 text-[11px] text-white/85 placeholder:text-white/30 outline-none focus:border-amber-300/50" />
      <textarea value={instr} onChange={e => setInstr(e.target.value)} onBlur={() => send({ instructions: instr.trim() })}
        placeholder="instructions — how to PLAY it (the ? INSTRUCTIONS panel shows this)"
        rows={3}
        className="w-full bg-black/50 border border-white/15 rounded-lg px-2.5 py-1.5 text-[11px] leading-snug text-white/85 placeholder:text-white/30 outline-none focus:border-amber-300/50 resize-y" />
      <textarea value={vision} onChange={e => setVision(e.target.value)} onBlur={() => send({ vision: vision.trim() })}
        placeholder="the story (vision) — what this world IS"
        rows={2}
        className="w-full bg-black/50 border border-white/15 rounded-lg px-2.5 py-1.5 text-[11px] leading-snug text-white/85 placeholder:text-white/30 outline-none focus:border-amber-300/50 resize-y" />
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
  if (!slug) return <div className="w-full h-full grid place-items-center p-6 font-mono text-[11px] text-white/45 text-center">house cartridge — publishing lives on real worlds.</div>
  if (!owner) return <div className="w-full h-full grid place-items-center p-6 font-mono text-[11px] text-white/45 text-center">only the maker publishes this world.</div>
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
    : 'text-white/60 border-white/20 bg-black/40'
  const Btn = ({ label, onClick, tone, disabled, hint }: { label: string; onClick: () => void; tone: string; disabled?: boolean; hint?: string }) => (
    <button onClick={onClick} disabled={disabled} title={hint}
      className={`px-3.5 py-2 rounded-xl border text-[11px] tracking-[0.15em] transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${tone}`}>
      {label}
    </button>
  )
  return (
    <div className="w-full h-full overflow-y-auto p-4 font-mono text-[11px]">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[10.5px] tracking-[0.2em] text-white/50">⬆ PUBLISH</span>
        <span data-pub-state className={`px-3 py-1 rounded-full border text-[10.5px] tracking-[0.18em] ${stateTint}`}>{state}</span>
      </div>
      <div className="rounded-xl border border-white/12 bg-black/40 p-3.5 mb-3 leading-relaxed text-white/60">
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
          <div className="text-[11px] tracking-[0.2em] text-sky-200 mb-2">◉ OPEN LIVE EDITING — READ THIS FIRST</div>
          <p className="text-white/75 leading-relaxed mb-3">
            This declares the world&apos;s social contract as <span className="text-sky-200">build: anyone</span> — every member can
            edit it live, forever. <span className="text-amber-200">The contract SEALS on declaration: it cannot be
            reversed, and this world leaves the game lists to live on LIVE EDITING only.</span>
          </p>
          <div className="flex gap-2">
            <button data-live-confirm-go onClick={() => { cmd('publish:live'); setConfirmLive(false) }}
              className="px-3.5 py-2 rounded-xl border border-sky-300/60 bg-sky-400/20 text-sky-100 text-[11px] tracking-[0.15em] hover:bg-sky-400/30 transition-colors">
              I UNDERSTAND — OPEN IT PERMANENTLY
            </button>
            <button onClick={() => setConfirmLive(false)}
              className="px-3.5 py-2 rounded-xl border border-white/20 bg-black/50 text-white/70 text-[11px] tracking-[0.15em] hover:text-white transition-colors">
              cancel
            </button>
          </div>
        </div>
      )}
      {/* ✦ PREMIUM — the listing's price seat (worldData.premium.usd) */}
      <div className="mt-3 rounded-xl border border-white/12 bg-black/40 p-3.5">
        <div className="text-[10.5px] tracking-[0.2em] text-white/50 mb-2">✦ PREMIUM</div>
        <PremiumSeat current={cfg?.premium ?? null} />
      </div>
      <div className="mt-3 text-[10px] text-white/40 leading-relaxed">every publish ⚑ saves a pre-publish version point first — you are always one click from the way back.</div>
    </div>
  )
}

// ✦ the premium price seat — set a $ and the world lists on the PREMIUM tab
function PremiumSeat({ current }: { current: number | null }) {
  const [usd, setUsd] = useState(current != null ? String(current) : '')
  useEffect(() => { setUsd(current != null ? String(current) : '') }, [current])
  const send = (v: { usd: number } | null) => { try { window.dispatchEvent(new CustomEvent('cafe:shell-cmd', { detail: 'card:' + JSON.stringify({ premium: v }) })) } catch { /* ssr */ } }
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-white/55">$</span>
      <input value={usd} onChange={e => setUsd(e.target.value)} inputMode="decimal" placeholder="0"
        className="w-20 px-2.5 py-1.5 rounded-lg bg-black/50 border border-white/15 text-white/85 outline-none focus:border-amber-300/50" />
      <button onClick={() => { const n = parseFloat(usd); if (Number.isFinite(n) && n > 0) send({ usd: n }) }}
        className="px-3 py-1.5 rounded-lg border border-amber-300/40 bg-amber-400/15 text-amber-200 text-[10.5px] tracking-[0.15em] hover:bg-amber-400/25 transition-colors">
        SET PRICE
      </button>
      {current != null && (
        <button onClick={() => send(null)}
          className="px-3 py-1.5 rounded-lg border border-white/20 bg-black/50 text-white/60 text-[10.5px] tracking-[0.15em] hover:text-white transition-colors">
          CLEAR
        </button>
      )}
      <span className="text-white/40 ml-1">{current != null ? `listed on ✦ PREMIUM at $${current}` : 'free — set a price to list on ✦ PREMIUM'}</span>
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
      <div className="w-full max-w-[980px] h-full flex flex-col font-mono text-[11px]">
        <div className="flex items-center gap-2 mb-2 shrink-0">
          <button onClick={() => setFlowOpen(false)} className="px-2.5 py-1 rounded-lg border border-white/20 text-white/75 text-[11px] hover:bg-white/5">◂ BACK</button>
          <span className="text-[10.5px] tracking-[0.2em] text-emerald-200/70">✧ THE CREATE FLOW</span>
        </div>
        <iframe data-create-flow src="/create"
          className="flex-1 min-h-0 w-full rounded-2xl border border-white/12 bg-black/40" />
      </div>
    )
  }
  return (
    <div className="w-full max-w-[640px] font-mono text-[11px]">
      <div className="text-[10.5px] tracking-[0.2em] text-emerald-200/70 mb-2">✧ CREATE</div>

      {/* fork the world in the frame */}
      <div className="rounded-2xl border border-white/12 bg-black/40 p-4 mb-3">
        <div className="text-[12px] tracking-[0.18em] text-white/90 mb-1">⑄ FORK {baseName.toUpperCase()}</div>
        {baseSlug ? (forkable ? (
          <>
            <div className="text-white/55 leading-relaxed mb-2.5">a fork is your own copy — a new world you own, with lineage back to this one. The original stays the maker&apos;s.</div>
            <div className="flex gap-2">
              <input value={name} onChange={e => setName(e.target.value)} maxLength={60}
                onKeyDown={e => { if (e.key === 'Enter' && nameOk) void fork() }}
                placeholder="name your fork… (e.g. neon-remix)"
                className="flex-1 px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-[12px] text-white/90 placeholder:text-white/30 outline-none focus:border-emerald-300/50" />
              <button onClick={() => void fork()} disabled={!nameOk || busy}
                className="px-4 py-2 rounded-xl border border-emerald-300/50 bg-emerald-400/15 text-emerald-100 text-[11px] tracking-[0.15em] hover:bg-emerald-400/25 disabled:opacity-35 transition-colors shrink-0">
                {busy ? '…' : '⑄ FORK IT — IT BECOMES YOURS'}
              </button>
            </div>
            {err && <div className="mt-2 text-amber-200/90">{err}</div>}
            <div className="mt-2 text-[10px] text-white/40">it opens in the ENGINE — connect your AI there and tell it what the fork should become.</div>
          </>
        ) : (
          <div className="text-white/50 leading-relaxed">the maker hasn&apos;t enabled forking on this world — pick another from the shelf, or brew below.</div>
        )) : (
          <div className="text-white/50 leading-relaxed">house cartridge — its code is open ground to read, but forks grow from real worlds. Brew below instead.</div>
        )}
      </div>

      {/* brew from nothing — the full create flow */}
      <div className="rounded-2xl border border-white/12 bg-black/40 p-4">
        <div className="text-[12px] tracking-[0.18em] text-white/90 mb-1">✧ BREW FROM NOTHING</div>
        <div className="text-white/55 leading-relaxed mb-2.5">the full create flow: describe a world, your AI builds it live. Blank ground or any open base.</div>
        <button onClick={() => { setFlowOpen(true); onBrew?.() }}
          className="inline-block px-4 py-2 rounded-xl border border-emerald-300/50 bg-emerald-400/15 text-emerald-100 text-[11px] tracking-[0.15em] hover:bg-emerald-400/25 transition-colors">
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
          <span className="text-[12px] tracking-[0.25em] text-amber-200/85">◆ BREW YOUR ICON</span>
          <button onClick={onClose} aria-label="close"
            className="w-8 h-8 grid place-items-center rounded-lg text-white/60 hover:text-white hover:bg-white/10 text-[16px]">✕</button>
        </div>
        <p className="text-[11px] text-white/55 leading-relaxed mb-3">describe your icon, then hand the prompt to your AI — it authors a safe, gentle avatar and confirms. Your icon walks the commons with you.</p>
        <textarea value={desc} onChange={e => setDesc(e.target.value)} maxLength={200} rows={3}
          placeholder="a shy blue jellyfish that drifts…"
          className="w-full resize-none rounded-xl bg-black/50 border border-white/15 px-3 py-2 text-[12px] text-white/90 placeholder:text-white/30 outline-none focus:border-amber-300/50 mb-2" />
        <button onClick={async () => { try { await navigator.clipboard.writeText(playerGlyphPrompt(desc.trim(), tok || null)); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* manual */ } }}
          disabled={desc.trim().length < 3}
          className="w-full py-2.5 rounded-xl border border-amber-300/50 bg-amber-400/15 text-amber-100 text-[12px] tracking-[0.18em] hover:bg-amber-400/25 disabled:opacity-35 transition-colors">
          {copied ? '✓ COPIED' : '⧉ COPY FOR YOUR AI'}
        </button>
        {!tok && <p className="mt-2 text-[10px] text-white/40">sign in to mint your icon key — the prompt needs it.</p>}
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
      <div className="text-[10.5px] tracking-[0.2em] text-white/60 mb-1">⑂ LINEAGE</div>
      {!isSpace && <div className="text-[10.5px] text-white/45 leading-relaxed">house cartridge — an original of the cafe.</div>}
      {isSpace && t === null && <div className="text-[10.5px] text-white/40">…</div>}
      {isSpace && t && (
        <div className="text-[10.5px] leading-relaxed">
          <div className="text-white/70">
            {t.trail.length <= 1
              ? 'an original — no upstream.'
              : t.trail.map((n, i) => (
                  <span key={i}>
                    {i > 0 && <span className="text-white/30"> ⑂ </span>}
                    <span className={i === t.trail.length - 1 ? 'text-amber-200/90' : 'text-white/70'}>{n.name}</span>
                  </span>
                ))}
          </div>
          {t.remixes.length > 0 && (
            <div className="mt-1 text-white/45">forks: {t.remixes.map(r => r.name).join(' · ')}</div>
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
const VersionsViewM = memo(VersionsView)
const CrewViewM = memo(CrewView)
const NodesViewM = memo(NodesView)
const MyWorldsViewM = memo(MyWorldsView)
