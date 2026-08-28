'use client'

// ═══ THE GRID (Galen, Aug 28) ═══
// ONE contained grid (reckoning viewport-inset + blue/gold frame), UI SETS
// docking around it via the DOCKSTAR — the cafe-cup button, CENTERED in the
// bottom bar (the one control spot, never covered). No GAMES button anywhere:
// the dockstar IS the way between sets.
//
// GAMES · BROWSE — the frame shrinks to a MINI window at the TOP; the space
// below is the ICON SHELF: big game tiles (baked icons) + the tab row.
// Selecting a tile hot-swaps that world INTO the frame, live. CLICKING THE
// FRAME CONFIRMS → it expands into play. Bottom bar: ? INSTRUCTIONS right,
// cup-dockstar center.
import { useCallback, useEffect, useMemo, useState } from 'react'
import FieldEngine from '@/app/engine/FieldEngine'

type Inset = { top: number; right: number; bottom: number; left: number }
type UiSet = 'games' | 'main' | 'engine' | 'create'
type Phase = 'browse' | 'play'
type Entry = { slug: string; name: string; scene: string }

const EASE = 'top 0.32s ease-out, right 0.32s ease-out, bottom 0.32s ease-out, left 0.32s ease-out'
const M = 16, BAR_H = 64
const LOCAL: Entry[] = [
  { slug: 'cinderfell', name: 'CINDERFELL', scene: 'CINDERFELL' },
  { slug: 'one-home', name: 'STARFIELD', scene: 'ONE-HOME' },
]

export default function TheGrid() {
  const [win, setWin] = useState({ w: 1280, h: 800 })
  const [uiSet, setUiSet] = useState<UiSet>('games')
  const [phase, setPhase] = useState<Phase>('browse')
  const [tab, setTab] = useState<'published' | 'premium'>('published')
  const [entries, setEntries] = useState<Entry[]>(LOCAL)
  const [icons, setIcons] = useState<Map<string, string>>(new Map())
  const [scene, setScene] = useState<string>(LOCAL[0].scene)
  const [selOpen, setSelOpen] = useState(false)
  const [instrOpen, setInstrOpen] = useState(false)
  const [instrText, setInstrText] = useState<string>('')

  useEffect(() => {
    const m = () => setWin({ w: window.innerWidth, h: window.innerHeight })
    m(); window.addEventListener('resize', m)
    return () => window.removeEventListener('resize', m)
  }, [])

  // catalog + baked icons (prod: real; local: bundled cartridges, letter tiles)
  useEffect(() => {
    fetch(`/api/cards?tab=${tab}`).then(r => r.json())
      .then((d: { cards?: Array<{ slug: string; name: string }> }) => {
        if (Array.isArray(d.cards) && d.cards.length)
          setEntries(d.cards.map(c => ({ slug: c.slug, name: c.name, scene: 'space:' + c.slug })))
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
      }).catch(() => { /* letter tiles carry it */ })
  }, [])

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

  // ── THE INSET — browse: MINI frame at the TOP (the icon shelf gets the room) ──
  const browsing = uiSet === 'games' && phase === 'browse'
  const inset = useMemo<Inset>(() => {
    const W = win.w, H = win.h
    if (!browsing) return { top: M, right: M, bottom: BAR_H + 10, left: M }
    const availH = H - M - BAR_H - 10
    let w = (W - M * 2) * 0.42, h = w / (16 / 10)
    const hMax = availH * 0.4
    if (h > hMax) { h = hMax; w = h * (16 / 10) }
    const left = (W - w) / 2
    return { top: M, right: W - left - w, bottom: H - M - h, left }
  }, [browsing, win])

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

  const pick = useCallback((e: Entry) => setScene(e.scene), [])
  const selected = entries.find(e => e.scene === scene) ?? LOCAL.find(e => e.scene === scene)

  // instructions for the selected world (local cartridge or live space)
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

  const shelfTop = win.h - inset.bottom + 12   // just under the frame in browse

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #0c0b14, #050509)' }}>
      {/* THE ONE GRID */}
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

      {/* CLICK THE FRAME TO PLAY (browse) — the world is the button */}
      {browsing && (
        <button aria-label={`play ${selected?.name ?? ''}`} onClick={() => setPhase('play')}
          className="fixed z-[115] group cursor-pointer"
          style={{ top: inset.top, right: inset.right, bottom: inset.bottom, left: inset.left, background: 'transparent', border: 'none', transition: EASE }}>
          <span className="absolute inset-x-0 bottom-2 mx-auto w-max font-mono text-[10px] tracking-[0.25em] px-2.5 py-1 rounded-lg bg-black/55 border border-white/15 text-white/70 opacity-0 group-hover:opacity-100 transition-opacity">
            ▶ PLAY {selected?.name ?? ''}
          </span>
        </button>
      )}

      {/* ═ THE ICON SHELF (browse) — the space the mini frame frees up ═ */}
      {browsing && (
        <div className="fixed inset-x-0 z-[112] flex flex-col items-center gap-3 px-4 overflow-y-auto"
          style={{ top: shelfTop, bottom: BAR_H + 6 }}>
          {/* tab row — which games deal in */}
          <div className="flex items-center gap-1.5 shrink-0">
            {([['published', '▶ GAMES'], ['premium', '✦ PREMIUM']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`font-mono text-[10.5px] tracking-[0.18em] px-3 py-1 rounded-lg border transition-colors ${
                  tab === k ? 'bg-emerald-400/15 border-emerald-300/50 text-emerald-100' : 'bg-black/40 border-white/10 text-white/40 hover:text-white/70'}`}>
                {label}
              </button>
            ))}
          </div>
          {/* the icons — big tiles, real estate */}
          <div className="grid gap-3 w-full max-w-[980px] pb-2"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))' }}>
            {entries.map(e => {
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
          </div>
        </div>
      )}

      {/* THE UI SELECTOR — overlay over the FIELD only; the bar is never covered */}
      {selOpen && (
        <div className="fixed z-[126] flex items-center justify-center backdrop-blur-sm"
          style={{ top: M, right: M, bottom: BAR_H + 10, left: M, background: 'rgba(5,6,12,0.86)', borderRadius: 10 }}
          onClick={() => setSelOpen(false)}>
          <div className="grid grid-cols-2 gap-3 p-4 w-full max-w-[520px]" onClick={e => e.stopPropagation()}>
            {([
              ['games', '▶', 'GAMES', 'browse the shelf — click the frame to play'],
              ['main', '◉', 'MAIN', 'the commons + social space'],
              ['engine', '⚙', 'ENGINE', 'world tools · builderbox'],
              ['create', '✚', 'CREATE', 'new world · fork from grid · paste the prompt to your AI'],
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
          </div>
        </div>
      )}

      {/* INSTRUCTIONS — field-bounded overlay (the bar stays live) */}
      {instrOpen && (
        <div className="fixed z-[127] flex items-center justify-center backdrop-blur-sm"
          style={{ top: M, right: M, bottom: BAR_H + 10, left: M, background: 'rgba(5,6,12,0.86)', borderRadius: 10 }}
          onClick={() => setInstrOpen(false)}>
          <div className="w-full max-w-[560px] max-h-[70%] overflow-y-auto rounded-2xl border border-white/12 bg-[#0d0c14]/97 p-5 m-4"
            onClick={e => e.stopPropagation()}>
            <div className="font-mono text-[12px] tracking-[0.25em] text-white/50 mb-2">? INSTRUCTIONS — {selected?.name}</div>
            <div className="font-mono text-[13px] leading-relaxed text-white/80 whitespace-pre-wrap">{instrText}</div>
          </div>
        </div>
      )}

      {/* ═ THE BOTTOM BAR — instructions right · CUP DOCKSTAR center ═ */}
      <div className="fixed bottom-0 inset-x-0 z-[135] flex items-center"
        style={{ height: BAR_H, paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex-1" />
        {/* THE DOCKSTAR — the cafe cup, a real button; the one way between sets */}
        <button onClick={() => { setSelOpen(o => !o); setInstrOpen(false) }} aria-label="ui selector"
          title="the dockstar — choose your UI"
          className={`w-12 h-12 grid place-items-center rounded-2xl border transition-all ${
            selOpen ? 'bg-amber-400/25 border-amber-300/70 scale-105' : 'bg-black/60 border-white/20 hover:border-amber-300/50 hover:bg-black/80'}`}
          style={{ boxShadow: selOpen ? '0 0 18px rgba(245,176,76,0.35)' : '0 2px 8px rgba(0,0,0,0.5)' }}>
          <img src="/cartridge-cup.svg" alt="" className="w-7 h-7" />
        </button>
        <div className="flex-1 flex justify-end pr-3">
          <button onClick={() => { setInstrOpen(o => !o); setSelOpen(false) }}
            className={`font-mono text-[11px] tracking-[0.18em] px-3.5 py-2 rounded-xl border transition-colors ${
              instrOpen ? 'bg-white/15 border-white/30 text-white' : 'bg-black/50 border-white/12 text-white/55 hover:text-white/85'}`}>
            ? INSTRUCTIONS
          </button>
        </div>
      </div>
    </div>
  )
}
