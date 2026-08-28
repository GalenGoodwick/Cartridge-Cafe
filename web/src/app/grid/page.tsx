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
import { useCallback, useEffect, useMemo, useState } from 'react'
import FieldEngine from '@/app/engine/FieldEngine'
import GridChat from './GridChat'
import type { AiNodeGraph, ANode } from '@/app/engine/ai-view/NodeGraph'
import SpaceManagementOverlay from '@/app/engine/SpaceManagementOverlay'

type Inset = { top: number; right: number; bottom: number; left: number }
type UiSet = 'games' | 'main' | 'engine' | 'create'
type Phase = 'browse' | 'play'
type Tab = 'live' | 'published' | 'premium' | 'search'
type Entry = { slug: string; name: string; scene: string; maker?: string }

const EASE = 'top 0.32s ease-out, right 0.32s ease-out, bottom 0.32s ease-out, left 0.32s ease-out'
const M = 16, BAR_H = 64, DOCK_W = 248
const MIN_W = 180, MIN_H = 120   // the frame can NEVER smash to a line
const LOCAL: Entry[] = [
  { slug: 'cinderfell', name: 'CINDERFELL', scene: 'CINDERFELL', maker: 'Galen' },
  { slug: 'one-home', name: 'STARFIELD', scene: 'ONE-HOME', maker: 'Opus' },
]

export default function TheGrid() {
  const [win, setWin] = useState({ w: 1280, h: 800 })
  const [uiSet, setUiSet] = useState<UiSet>('games')
  const [phase, setPhase] = useState<Phase>('browse')
  const [tab, setTab] = useState<Tab>('published')
  const [q, setQ] = useState('')
  const [entries, setEntries] = useState<Entry[]>(LOCAL)
  const [icons, setIcons] = useState<Map<string, string>>(new Map())
  const [scene, setScene] = useState<string>(LOCAL[0].scene)
  const [selOpen, setSelOpen] = useState(false)
  const [instrOpen, setInstrOpen] = useState(false)
  const [instrText, setInstrText] = useState<string>('')
  const [connectOpen, setConnectOpen] = useState(false)
  const [attribOpen, setAttribOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [tool, setTool] = useState<'eye' | 'console' | 'nodes' | 'config' | 'chat' | 'connect'>('eye')   // ENGINE's under-area view
  const [eyeData, setEyeData] = useState<{
    focus?: { action?: string; fieldName?: string; at?: number } | null
    eye?: { png?: string; at?: number; name?: string } | null
    shot?: string
    graph?: AiNodeGraph | null
    config?: { isOwner: boolean; spaceId: string | null; spaceSlug: string | null; multiplayer: boolean; rReset: boolean; forkable: boolean; presenceOff: boolean; policy: string | null } | null
  } | null>(null)

  const [aiLog, setAiLog] = useState<Array<{ type: string; summary: string; author: string | null; t: number }>>([])
  const [copied, setCopied] = useState(false)

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
        if (Array.isArray(d.cards) && d.cards.length)
          setEntries(d.cards.map(c => ({ slug: c.slug, name: c.name, scene: 'space:' + c.slug, maker: c.maker?.name ?? c.maker?.handle ?? undefined })))
        else setEntries(LOCAL)
      })
      .catch(() => setEntries(LOCAL))
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
    } catch { /* ssr */ }
  }, [])
  useEffect(() => {
    try {
      const u = new URL(window.location.href)
      u.searchParams.set('w', scene); u.searchParams.set('ui', uiSet)
      if (phase === 'play') u.searchParams.set('ph', 'play'); else u.searchParams.delete('ph')
      window.history.replaceState(null, '', u.toString())
    } catch { /* fine */ }
  }, [scene, uiSet, phase])

  // ── THE INSET — one function, CLAMPED (a window mid-resize can never smash
  // the frame below MIN_W×MIN_H — it holds shape until there's room) ──
  const browsing = uiSet === 'games' && phase === 'browse'
  const engineSet = uiSet === 'engine'
  const narrow = win.w < 700                      // the dock becomes a BOTTOM SHEET on narrow screens
  const dockBottomH = 168                          // narrow engine dock height
  const miniTop = browsing || engineSet   // GAMES-browse AND ENGINE share the shrink-to-top layout
  const inset = useMemo<Inset>(() => {
    const W = Math.max(win.w, MIN_W + M * 2), H = Math.max(win.h, MIN_H + M + BAR_H + 10)
    if (!miniTop) return { top: M, right: M, bottom: BAR_H + 10, left: M }
    const availH = H - M - BAR_H - 10
    let w = (W - M * 2) * 0.42, h = w / (16 / 10)
    const hMax = availH * 0.4
    if (h > hMax) { h = hMax; w = h * (16 / 10) }
    w = Math.max(w, MIN_W); h = Math.max(h, MIN_H)
    const left = Math.max((W - w) / 2, M)
    return { top: M, right: Math.max(W - left - w, M), bottom: Math.max(H - M - h, BAR_H + 10), left }
  }, [miniTop, win])

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

  useEffect(() => {
    const on = (e: Event) => setEyeData((e as CustomEvent).detail ?? null)
    window.addEventListener('cafe:eye', on)
    return () => window.removeEventListener('cafe:eye', on)
  }, [])
  // entering ENGINE arms the engine's eye-watch (after the transition hygiene)
  useEffect(() => {
    if (!engineSet) return
    const t = setTimeout(() => { try { window.dispatchEvent(new CustomEvent('cafe:shell-cmd', { detail: 'eye' })) } catch { /* ssr */ } }, 50)
    return () => clearTimeout(t)
  }, [engineSet, scene])

  const pick = useCallback((e: Entry) => setScene(e.scene), [])

  // TRANSITION HYGIENE (Galen: builderbox stuck open from engine → play): any
  // set/phase change closes the engine's panels — nothing follows you through.
  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent('cafe:shell-cmd', { detail: 'closepanels' })) } catch { /* ssr */ }
    setConnectOpen(false); setInstrOpen(false); setAttribOpen(false); setChatOpen(false)
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

  const connectPrompt = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin.replace('localhost:3131', 'cartridge.cafe') : 'https://cartridge.cafe'
    return `Connect to ${origin} as my builder. Read the guide first: GET ${origin}/api/engine/guide — then open my world "${selected?.name ?? 'my world'}" and build with me. Bridge commands go to POST ${origin}/api/engine/bridge with my world key.`
  }, [selected])

  const shelfTop = win.h - inset.bottom + 12
  const cmd = (c: string) => { try { window.dispatchEvent(new CustomEvent('cafe:shell-cmd', { detail: c })) } catch { /* ssr */ } }

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #0c0b14, #050509)' }}>
      <FieldEngine playScene={scene} hooksTrusted viewport={inset} externalTopbar />

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
        <button aria-label={`play ${selected?.name ?? ''}`} onClick={() => setPhase('play')}
          className="fixed z-[115] group cursor-pointer"
          style={{ top: inset.top, right: inset.right, bottom: inset.bottom, left: inset.left, background: 'transparent', border: 'none', transition: EASE }}>
          <span className="absolute inset-x-0 bottom-2 mx-auto w-max font-mono text-[10px] tracking-[0.25em] px-2.5 py-1 rounded-lg bg-black/55 border border-white/15 text-white/70 opacity-0 group-hover:opacity-100 transition-opacity">
            ▶ PLAY {selected?.name ?? ''}
          </span>
        </button>
      )}

      {/* ═ THE ICON SHELF (games·browse) ═ */}
      {browsing && (
        <div className="fixed inset-x-0 z-[112] flex flex-col items-center gap-3 px-4 overflow-y-auto"
          style={{ top: shelfTop, bottom: BAR_H + 6 }}>
          {/* TAB ROW — ◉ LIVE EDITING hooks people · FREE GAMES · PREMIUM · search */}
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-center">
            {([['live', '◉ LIVE EDITING'], ['published', 'FREE GAMES'], ['premium', '✦ PREMIUM']] as const).map(([k, label]) => (
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
          button — the universal law) */}
      {engineSet && (
        <button aria-label={`play ${selected?.name ?? ''}`} onClick={() => { setUiSet('games'); setPhase('play') }}
          className="fixed z-[114] group cursor-pointer"
          style={{ top: inset.top, right: inset.right, bottom: inset.bottom, left: inset.left, background: 'transparent', border: 'none', transition: EASE }}>
          <span className="absolute inset-x-0 bottom-2 mx-auto w-max font-mono text-[10px] tracking-[0.25em] px-2.5 py-1 rounded-lg bg-black/55 border border-white/15 text-white/70 opacity-0 group-hover:opacity-100 transition-opacity">
            ▶ PLAY {selected?.name ?? ''}
          </span>
        </button>
      )}

      {/* THE UI SELECTOR — field-bounded overlay; + ACCOUNT (Galen) */}
      {selOpen && (
        <div className="fixed z-[126] flex items-center justify-center backdrop-blur-sm"
          style={{ top: M, right: M, bottom: BAR_H + 10, left: M, background: 'rgba(5,6,12,0.86)', borderRadius: 10 }}
          onClick={() => setSelOpen(false)}>
          <div className="grid grid-cols-2 gap-3 p-4 w-full max-w-[520px]" onClick={e => e.stopPropagation()}>
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
            <button onClick={() => { window.location.href = '/mine' }}
              className="col-span-2 text-left rounded-2xl border border-white/12 bg-black/40 hover:border-white/25 p-4 transition-colors flex items-center gap-3">
              <span className="text-[20px] text-white/70">◐</span>
              <span>
                <span className="font-mono text-[13px] tracking-[0.2em] text-white/90 block">ACCOUNT</span>
                <span className="font-mono text-[10px] text-white/40">sign in · my worlds · membership</span>
              </span>
            </button>
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
            <p className="text-[11px] text-white/50 leading-relaxed mb-3">Paste this into your working AI (Claude, or any MCP agent) — it reads the guide and builds with you. Works on any device.</p>
            <div className="rounded-xl bg-black/60 border border-white/12 p-3 text-[11.5px] text-white/80 leading-relaxed select-all">{connectPrompt}</div>
            <button onClick={async () => { try { await navigator.clipboard.writeText(connectPrompt); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* manual */ } }}
              className="mt-3 w-full py-2.5 rounded-xl border border-emerald-300/50 bg-emerald-400/15 text-emerald-100 text-[12px] tracking-[0.18em] hover:bg-emerald-400/25 transition-colors">
              {copied ? '✓ COPIED' : '⧉ COPY THE PROMPT'}
            </button>
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
            <div className="text-[10.5px] tracking-[0.2em] text-white/60 mb-1">⑂ LINEAGE</div>
            <div className="text-[10.5px] text-white/45 leading-relaxed">what it grew from · its forks (wires to the lineage store next)</div>
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
            {([['eye', '◈ EYE'], ['console', '⌁ CONSOLE'], ['nodes', '⬢ NODES'], ['config', '⚙ CONFIG'], ['chat', '◉ CHAT']] as const).map(([k, label]) => (
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
          <div className="w-full max-w-[860px] flex-1 min-h-0 rounded-2xl border border-white/10 bg-black/40 overflow-hidden">
            {tool === 'eye' && (
              <div className="w-full h-full flex flex-col p-4 font-mono">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10.5px] tracking-[0.2em] text-sky-200/70">◈ THE EYE — hand the AI your view</span>
                  <button onClick={() => { try { window.dispatchEvent(new CustomEvent('cafe:shell-cmd', { detail: 'snapshot' })) } catch { /* ssr */ } }}
                    className="px-3.5 py-1.5 rounded-lg border border-sky-300/50 bg-sky-400/10 text-sky-100 text-[11px] tracking-[0.15em] hover:bg-sky-400/20 transition-colors">
                    {eyeData?.shot === 'sending' ? '…' : eyeData?.shot === 'sent' ? '✓ SENT TO THE AI' : '📸 SNAPSHOT → AI'}
                  </button>
                </div>
                {eyeData?.focus?.action && (
                  <div className="text-[10.5px] text-white/60 mb-2">ai focus: <span className="text-emerald-200/90">{eyeData.focus.action}</span>{eyeData.focus.fieldName ? <span className="text-white/45"> · {eyeData.focus.fieldName}</span> : null}</div>
                )}
                <div className="flex-1 min-h-0 rounded-xl border border-white/12 bg-black/50 grid place-items-center overflow-hidden">
                  {eyeData?.eye?.png
                    ? <img src={`data:image/png;base64,${eyeData.eye.png}`.replace('base64,data:', '').replace('base64,i', 'base64,i')} alt="the eye" className="max-w-full max-h-full object-contain" />
                    : <span className="text-[11px] text-white/45 p-6 text-center">no image yet — 📸 sends your live frame to the connected AI over the bridge; its probes land here too.</span>}
                </div>
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
            {tool === 'nodes' && <NodesView graph={eyeData?.graph ?? null} />}
            {tool === 'config' && (
              <ConfigView cfg={eyeData?.config ?? null} sceneIsSpace={scene.startsWith('space:')} />
            )}
            {tool === 'chat' && (
              <GridChat inline slotKey={'world-chat:' + (scene.startsWith('space:') ? scene.slice(6).toUpperCase() : scene)} title={selected?.name ?? 'THIS WORLD'} />
            )}
            {tool === 'connect' && (
              <div className="w-full h-full overflow-y-auto p-4 font-mono">
                <div className="text-[10.5px] tracking-[0.2em] text-emerald-200/80 mb-2">⚿ CONNECT YOUR AI</div>
                <p className="text-[11px] text-white/60 leading-relaxed mb-3">Paste this into your working AI (Claude, or any MCP agent) — it reads the guide and builds with you. Any device.</p>
                <div className="rounded-xl bg-black/60 border border-white/12 p-3 text-[11.5px] text-white/85 leading-relaxed select-all">{connectPrompt}</div>
                <button onClick={async () => { try { await navigator.clipboard.writeText(connectPrompt); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* manual */ } }}
                  className="mt-3 w-full py-2.5 rounded-xl border border-emerald-300/50 bg-emerald-400/15 text-emerald-100 text-[12px] tracking-[0.18em] hover:bg-emerald-400/25 transition-colors">
                  {copied ? '✓ COPIED' : '⧉ COPY THE PROMPT'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═ THE BOTTOM BAR ═ */}
      <div className="fixed bottom-0 inset-x-0 z-[135] flex items-center"
        style={{ height: BAR_H, paddingBottom: 'max(env(safe-area-inset-bottom), 6px)' }}>
        <div className="flex-1 flex justify-start pl-3">
          {/* THE TITLE — leftmost; clicking opens attribution/lineage.
              Not in ENGINE (the dock already names the world). */}
          {uiSet !== 'engine' && (
          <button data-grid-title onClick={() => { setAttribOpen(o => !o); setSelOpen(false) }}
            className="font-mono text-[12px] tracking-[0.16em] px-3.5 py-2 rounded-xl border bg-black/60 border-white/20 text-white/90 hover:border-amber-300/50 transition-colors"
            style={{ margin: '8px 0' }}>
            {selected?.name ?? '—'}
          </button>
          )}
        </div>
        {/* THE DOCKSTAR — the cup, buffered above AND below */}
        <button onClick={() => { setSelOpen(o => !o); setInstrOpen(false); setConnectOpen(false); setAttribOpen(false); setChatOpen(false) }} aria-label="ui selector"
          title="the dockstar — choose your UI"
          className={`w-12 h-12 grid place-items-center rounded-2xl border transition-all ${
            selOpen ? 'bg-amber-400/25 border-amber-300/70 scale-105' : 'bg-black/60 border-white/20 hover:border-amber-300/50 hover:bg-black/80'}`}
          style={{ margin: '8px 0', boxShadow: selOpen ? '0 0 18px rgba(245,176,76,0.35)' : '0 2px 8px rgba(0,0,0,0.5)' }}>
          <img src="/cartridge-cup.svg" alt="" className="w-7 h-7" />
        </button>
        <div className="flex-1 flex justify-end gap-2 pr-3">
          <button onClick={() => { setInstrOpen(o => !o); setSelOpen(false); setConnectOpen(false) }}
            className={`font-mono text-[11px] tracking-[0.18em] px-3.5 py-2 rounded-xl border transition-colors ${
              instrOpen ? 'bg-white/20 border-white/40 text-white' : 'bg-black/70 border-white/25 text-white/85 hover:text-white'}`}
            style={{ margin: '8px 0' }}>
            ? INSTRUCTIONS
          </button>
          {uiSet === 'games' && phase === 'play' && (
            <button onClick={async () => {
              const url = window.location.href
              try { await navigator.share?.({ url, title: selected?.name }) }
              catch { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* manual */ } }
              if (!navigator.share) { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* manual */ } }
            }}
              className="font-mono text-[11px] tracking-[0.18em] px-3.5 py-2 rounded-xl border bg-black/70 border-white/25 text-white/85 hover:text-white transition-colors"
              style={{ margin: '8px 0' }}>
              {copied ? '✓ COPIED' : '↗ SHARE'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}


// ⬢ NODES — who builds what, FROM THE GAME (the engine's live graph, code
// included). ADVANCED SWAPS the view in-area (no overlay, no two-column —
// responsive single column): grouped sections with edges; clicking a node
// opens its CODE full-area; ◂ backs out at every level.
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
    const groups: Array<[string, ANode[]]> = [
      ['MODULES', graph.modules as ANode[]], ['VISUALS', graph.visuals as ANode[]],
      ['FIELDS', graph.fields as ANode[]], ['HOOKS', graph.hooks as ANode[]],
    ]
    const edgeCount = (id: string) => graph.edges.filter(e => e.from === id || e.to === id).length
    return (
      <div className="w-full h-full overflow-y-auto p-4 font-mono">
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => setMode('list')} className="px-2.5 py-1 rounded-lg border border-white/20 text-white/75 text-[11px] hover:bg-white/5">◂ BACK</button>
          <span className="text-[10.5px] tracking-[0.2em] text-sky-200/70">⬡ THE GRAPH — tap a node for its code</span>
        </div>
        {groups.map(([label, ns]) => ns.length > 0 && (
          <div key={label} className="mb-3">
            <div className="text-[9.5px] tracking-[0.25em] text-white/45 mb-1">{label} · {ns.length}</div>
            {ns.map(n => (
              <button key={n.id} onClick={() => setSel(n)}
                className="w-full text-left flex items-center gap-3 py-2 px-2 rounded-lg border-b border-white/6 hover:bg-white/5 text-[11.5px]">
                <span className={`shrink-0 ${tint[n.kind]}`}>●</span>
                <span className="text-white/90 truncate">{n.title}</span>
                <span className="ml-auto shrink-0 text-[9.5px] text-white/35">{edgeCount(n.id)} links</span>
              </button>
            ))}
          </div>
        ))}
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
  cfg: { isOwner: boolean; spaceId: string | null; spaceSlug: string | null; multiplayer: boolean; rReset: boolean; forkable: boolean; presenceOff: boolean; policy: string | null } | null
  sceneIsSpace: boolean
}) {
  const fire = (k: string) => { try { window.dispatchEvent(new CustomEvent('cafe:shell-cmd', { detail: 'cfg:' + k })) } catch { /* ssr */ } }
  const Row = ({ label, on, k, disabled }: { label: string; on: boolean; k: string; disabled?: boolean }) => (
    <div className="flex items-center justify-between py-2 border-b border-white/8 text-[12px]">
      <span className="text-white/80">{label}</span>
      <button onClick={() => fire(k)} disabled={disabled}
        className={`px-2.5 py-0.5 rounded-full border text-[11px] tracking-[0.15em] transition-colors disabled:opacity-35 ${
          on ? 'bg-emerald-400/20 border-emerald-300/50 text-emerald-200' : 'bg-white/5 border-white/15 text-white/45'}`}>
        {on ? 'ON' : 'OFF'}
      </button>
    </div>
  )
  const ownerLaw = !!cfg?.isOwner
  return (
    <div className="w-full h-full overflow-y-auto p-4 font-mono">
      <div className="text-[10.5px] tracking-[0.2em] text-amber-200/70 mb-2">⚙ WORLD CONFIG</div>
      {cfg?.isOwner && cfg.spaceSlug && cfg.spaceId && (
        <div className="mb-3 rounded-xl border border-white/12 bg-black/40 overflow-hidden">
          <SpaceManagementOverlay embedded spaceSlug={cfg.spaceSlug} spaceId={cfg.spaceId} />
        </div>
      )}
      <div className="rounded-xl border border-white/12 bg-black/40 px-3.5 py-1 mb-3">
        <Row label="multiplayer" on={!!cfg?.multiplayer} k="multiplayer" disabled={!ownerLaw} />
        {/* player-presence row RETIRED (Aug 28) — pips are gone; multiplayer is co-presence */}
        <Row label="restart with R" on={!!cfg?.rReset} k="rreset" disabled={!ownerLaw} />
        <Row label="allow forking" on={!!cfg?.forkable} k="forkable" disabled={!ownerLaw} />
      </div>
      <div className="rounded-xl border border-white/12 bg-black/40 p-3.5 text-[11px] leading-relaxed text-white/55">
        social contract: <span className="text-white/85">{cfg?.policy ? `build: ${cfg.policy} · sealed` : 'undeclared · default (owner builds, everyone plays)'}</span>
        {!sceneIsSpace && <div className="mt-1.5 text-white/40">house cartridge — owner controls apply on real worlds.</div>}
        <div className="mt-1.5 text-white/40">THE CARD (kind · tags · blurb) docks here next.</div>
      </div>
    </div>
  )
}
