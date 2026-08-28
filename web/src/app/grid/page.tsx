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
  const [toolsOpen, setToolsOpen] = useState(false)   // ⚙ WORLD CONFIG
  const [eyeOpen, setEyeOpen] = useState(false)       // ◈ EYE / NODE TOOLS
  const [aiLog, setAiLog] = useState<Array<{ type: string; summary: string; author: string | null; t: number }>>([])
  const [attribOpen, setAttribOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const m = () => setWin({ w: window.innerWidth, h: window.innerHeight })
    m(); window.addEventListener('resize', m)
    return () => window.removeEventListener('resize', m)
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
  const inset = useMemo<Inset>(() => {
    const W = Math.max(win.w, MIN_W + M * 2), H = Math.max(win.h, MIN_H + M + BAR_H + 10)
    const rightPad = engineSet && !narrow ? M + DOCK_W + 10 : M
    const bottomPad = engineSet && narrow ? BAR_H + 10 + dockBottomH + 8 : BAR_H + 10
    if (!browsing) {
      const w = Math.max(W - M - rightPad, MIN_W)
      const h = Math.max(H - M - bottomPad, MIN_H)
      return { top: M, right: W - M - w, bottom: H - M - h, left: M }
    }
    const availH = H - M - BAR_H - 10
    let w = (W - M * 2) * 0.42, h = w / (16 / 10)
    const hMax = availH * 0.4
    if (h > hMax) { h = hMax; w = h * (16 / 10) }
    w = Math.max(w, MIN_W); h = Math.max(h, MIN_H)
    const left = Math.max((W - w) / 2, M)
    return { top: M, right: Math.max(W - left - w, M), bottom: Math.max(H - M - h, BAR_H + 10), left }
  }, [browsing, engineSet, win])

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
    return () => window.removeEventListener('cafe:ai-log', on)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (eyeOpen) { try { window.dispatchEvent(new Event('cafe:ai-log-pull')) } catch { /* ssr */ } }
  }, [eyeOpen])

  const pick = useCallback((e: Entry) => setScene(e.scene), [])

  // TRANSITION HYGIENE (Galen: builderbox stuck open from engine → play): any
  // set/phase change closes the engine's panels — nothing follows you through.
  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent('cafe:shell-cmd', { detail: 'closepanels' })) } catch { /* ssr */ }
    setConnectOpen(false); setInstrOpen(false); setToolsOpen(false); setAttribOpen(false); setChatOpen(false); setEyeOpen(false)
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

      {/* ═ THE ENGINE DOCK — right strip on wide screens; a BOTTOM SHEET above
          the bar on narrow ones (a sidebar would starve a phone's frame) ═ */}
      {engineSet && (
        <div className={`fixed z-[118] font-mono ${narrow ? 'flex flex-row gap-2 overflow-x-auto items-stretch' : 'flex flex-col gap-2'}`}
          style={narrow
            ? { left: M, right: M, bottom: BAR_H + 10, height: dockBottomH, transition: EASE }
            : { top: M, right: M, bottom: BAR_H + 10, width: DOCK_W, transition: EASE }}>
          <div className={`rounded-2xl border border-amber-300/25 bg-[#12100a]/90 backdrop-blur p-3 ${narrow ? 'shrink-0 min-w-[150px]' : ''}`}>
            <div className="text-[10px] tracking-[0.25em] text-amber-200/70 mb-0.5">⚙ ENGINE</div>
            <div className="text-[13px] tracking-[0.12em] text-white/90 truncate">{selected?.name ?? '—'}</div>
            {selected?.maker && <div className="text-[10px] text-amber-200/60 mt-0.5 truncate">by {selected.maker}</div>}
          </div>
          <button onClick={() => setChatOpen(true)}
            className={`text-left rounded-xl border border-white/12 bg-black/50 px-3.5 py-3 text-[12px] tracking-[0.12em] text-white/85 hover:border-emerald-300/40 hover:text-white transition-colors ${narrow ? 'shrink-0 min-w-[150px]' : ''}`}>
            ◉ CHAT
            <span className="block text-[9.5px] text-white/45 mt-0.5">the humans in this world</span>
          </button>
          <button onClick={() => setEyeOpen(true)}
            className={`text-left rounded-xl border border-white/12 bg-black/50 px-3.5 py-3 text-[12px] tracking-[0.12em] text-white/85 hover:border-sky-300/40 hover:text-white transition-colors ${narrow ? 'shrink-0 min-w-[150px]' : ''}`}>
            ◈ EYE · NODES
            <span className="block text-[9.5px] text-white/45 mt-0.5">the AI console · node tools</span>
          </button>
          <button onClick={() => setToolsOpen(true)}
            className={`text-left rounded-xl border border-white/12 bg-black/50 px-3.5 py-3 text-[12px] tracking-[0.12em] text-white/85 hover:border-amber-300/40 hover:text-white transition-colors ${narrow ? 'shrink-0 min-w-[150px]' : ''}`}>
            ⚙ WORLD CONFIG
            <span className="block text-[9.5px] text-white/45 mt-0.5">name · visibility · dimensions</span>
          </button>
          <button onClick={() => setConnectOpen(true)}
            className={`text-left rounded-xl border border-emerald-300/60 bg-emerald-400/10 px-3.5 py-3 text-[12px] tracking-[0.12em] text-emerald-100 hover:bg-emerald-400/20 hover:border-emerald-300/80 transition-colors ${narrow ? 'shrink-0 min-w-[150px]' : ''}`}>
            ⚿ CONNECT AI
            <span className="block text-[9.5px] text-emerald-200/60 mt-0.5">paste the prompt into your AI</span>
          </button>
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

      {/* WORLD TOOLS — a FULL overlay (it's a lot): attribution · AI logs · lineage */}
      {toolsOpen && (
        <div className="fixed z-[127] flex items-center justify-center backdrop-blur-sm"
          style={{ top: M, right: M, bottom: BAR_H + 10, left: M, background: 'rgba(5,6,12,0.88)', borderRadius: 10 }}
          onClick={() => setToolsOpen(false)}>
          <div className="w-full max-w-[680px] h-[80%] overflow-y-auto rounded-2xl border border-amber-300/25 bg-[#12100a]/97 p-5 m-4 font-mono" onClick={e => e.stopPropagation()}>
            <div className="text-[12px] tracking-[0.25em] text-amber-200/80 mb-3">⚙ WORLD CONFIG — {selected?.name}</div>
            <div className="text-[10.5px] tracking-[0.2em] text-white/60 mb-1.5">SETTINGS</div>
            <div className="rounded-xl border border-white/12 bg-black/40 p-3.5 mb-3 text-[11px] leading-relaxed">
              <div className="flex justify-between py-1 border-b border-white/5"><span className="text-white/55">name</span><span className="text-white/90">{selected?.name}</span></div>
              <div className="flex justify-between py-1 border-b border-white/5"><span className="text-white/55">maker</span><span className="text-amber-200/85">{selected?.maker ?? '—'}</span></div>
              <div className="flex justify-between py-1 border-b border-white/5"><span className="text-white/55">scene</span><span className="text-white/70">{scene}</span></div>
              <div className="flex justify-between py-1"><span className="text-white/55">visibility · forkable · dimensions</span><span className="text-white/40">owner controls — wire next</span></div>
            </div>
            <div className="text-[10.5px] tracking-[0.2em] text-white/60 mb-1.5">▤ THE CARD</div>
            <div className="rounded-xl border border-white/12 bg-black/40 p-3.5 text-[11px] text-white/45 leading-relaxed">
              the world's shelf card — blurb, tags, icon bake. docks here from the classic panel next.
            </div>
          </div>
        </div>
      )}

      {/* ◈ THE EYE — the AI console + node tools (the builderbox's working
          half, rehomed as its own door) */}
      {eyeOpen && (
        <div className="fixed z-[127] flex items-center justify-center backdrop-blur-sm"
          style={{ top: M, right: M, bottom: BAR_H + 10, left: M, background: 'rgba(5,6,12,0.88)', borderRadius: 10 }}
          onClick={() => setEyeOpen(false)}>
          <div className="w-full max-w-[680px] h-[80%] flex flex-col rounded-2xl border border-sky-300/25 bg-[#0c1016]/97 p-5 m-4 font-mono" onClick={e => e.stopPropagation()}>
            <div className="text-[12px] tracking-[0.25em] text-sky-200/80 mb-3">◈ THE EYE — {selected?.name}</div>
            <div className="text-[10.5px] tracking-[0.2em] text-white/60 mb-1.5">AI CONSOLE</div>
            <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-white/12 bg-black/50 p-3 text-[11px] leading-relaxed mb-3">
              {aiLog.length === 0 && <div className="text-white/40">no AI edits yet this session — connect an AI and its every build step lands here, live.</div>}
              {aiLog.map((l, i) => (
                <div key={i} className="flex gap-2 py-0.5 border-b border-white/5 last:border-0">
                  <span className="text-white/40 shrink-0">{new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                  <span className="text-emerald-200/90 shrink-0">{l.type}</span>
                  <span className="text-white/85 truncate">{l.summary}</span>
                  {l.author && <span className="text-amber-200/70 shrink-0 ml-auto">{l.author}</span>}
                </div>
              ))}
            </div>
            <div className="text-[10.5px] tracking-[0.2em] text-white/60 mb-1.5">⬢ NODE TOOLS</div>
            <div className="rounded-xl border border-white/12 bg-black/40 p-3.5 text-[11px] text-white/45 leading-relaxed">
              who builds what — node holds, history, revert. docks here next.
            </div>
          </div>
        </div>
      )}

      {/* ◉ THE CHAT — field-bounded overlay, one thread per world */}
      {chatOpen && (
        <GridChat
          slotKey={'world-chat:' + (scene.startsWith('space:') ? scene.slice(6).toUpperCase() : scene)}
          title={selected?.name ?? 'THIS WORLD'}
          bounds={{ top: M, right: M, bottom: BAR_H + 10, left: M }}
          onClose={() => setChatOpen(false)}
        />
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
        <button onClick={() => { setSelOpen(o => !o); setInstrOpen(false); setConnectOpen(false); setAttribOpen(false); setToolsOpen(false); setChatOpen(false); setEyeOpen(false) }} aria-label="ui selector"
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
