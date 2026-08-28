'use client'

// ═══ THE GRID (Galen, Aug 28) ═══
// ONE contained grid (the reckoning's viewport-inset containment + the blue/
// gold frame), UI SETS docking around it, picked from the ▣ dockstar's OVERLAY
// (which fills the game field exactly — the BOTTOM BAR is never covered,
// structurally). Every set on every device (create on mobile = paste the
// prompt to your working AI).
//
// GAMES — DOCKED: the grid shrinks to a preview window; the bottom bar becomes
// a TAB ROW + the game selector (previews hot-swap INTO the grid, live);
// CLICKING THE GRID CONFIRMS → the grid expands into play. ◱ returns to browse.
// MAIN / ENGINE / CREATE — seats held (they dock next).
import { useCallback, useEffect, useMemo, useState } from 'react'
import FieldEngine from '@/app/engine/FieldEngine'

type Inset = { top: number; right: number; bottom: number; left: number }
type UiSet = 'games' | 'main' | 'engine' | 'create'
type Phase = 'browse' | 'play'
type Entry = { slug: string; name: string; scene: string }

const EASE = 'top 0.32s ease-out, right 0.32s ease-out, bottom 0.32s ease-out, left 0.32s ease-out'
const M = 16
// local fallback worlds (no DB): both bundled cartridges — selection is real
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
  const [scene, setScene] = useState<string>(LOCAL[0].scene)
  const [selOpen, setSelOpen] = useState(false)

  useEffect(() => {
    const m = () => setWin({ w: window.innerWidth, h: window.innerHeight })
    m(); window.addEventListener('resize', m)
    return () => window.removeEventListener('resize', m)
  }, [])

  // the catalog for the selector row (prod: real cards; local: the cartridges)
  useEffect(() => {
    fetch(`/api/cards?tab=${tab}`).then(r => r.json())
      .then((d: { cards?: Array<{ slug: string; name: string }> }) => {
        if (Array.isArray(d.cards) && d.cards.length)
          setEntries(d.cards.map(c => ({ slug: c.slug, name: c.name, scene: 'space:' + c.slug })))
        else setEntries(LOCAL)
      })
      .catch(() => setEntries(LOCAL))
  }, [tab])

  // linkable: ?w=<scene>&ui=<set>&ph=<phase>
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

  // ── THE INSET — one function for every state (browse shrinks, play fills;
  // browser resize flows through the same math automatically) ──
  const browsing = uiSet === 'games' && phase === 'browse'
  const barH = browsing ? 118 : 64          // browse: tab row + preview row
  const inset = useMemo<Inset>(() => {
    const W = win.w, H = win.h
    const availW = W - M * 2, availH = H - M - barH - 10
    if (!browsing) return { top: M, right: M, bottom: barH + 10, left: M }
    // browse: a centered preview window (~55% of the fit box, 16:10)
    let w = availW * 0.55, h = w / (16 / 10)
    if (h > availH * 0.62) { h = availH * 0.62; w = h * (16 / 10) }
    const left = (W - w) / 2, top = M + (availH - h) / 2
    return { top, right: W - left - w, bottom: H - top - h, left }
  }, [browsing, win, barH])

  // UNIFIED eased resize: re-fit the cover-camera every frame of the ease
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

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #0c0b14, #050509)' }}>
      {/* THE ONE GRID — worlds hot-swap in; chromeless; contained at the inset */}
      <FieldEngine playScene={scene} hooksTrusted viewport={inset} externalTopbar />

      {/* THE FRAME — blue outline + gold corners, riding the same inset/ease */}
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

      {/* CLICK THE GRID TO PLAY — browse phase only: the world itself is the
          confirm button (the reckoning's cell-click, site-wide) */}
      {browsing && (
        <button
          aria-label={`play ${selected?.name ?? ''}`}
          onClick={() => setPhase('play')}
          className="fixed z-[115] group cursor-pointer"
          style={{ top: inset.top, right: inset.right, bottom: inset.bottom, left: inset.left, background: 'transparent', border: 'none', transition: EASE }}
        >
          <span className="absolute inset-x-0 bottom-3 mx-auto w-max font-mono text-[11px] tracking-[0.25em] px-3 py-1.5 rounded-lg bg-black/55 border border-white/15 text-white/70 opacity-0 group-hover:opacity-100 transition-opacity">
            ▶ CLICK TO PLAY {selected?.name ?? ''}
          </span>
        </button>
      )}

      {/* THE UI SELECTOR — overlay over the FIELD only; the bar is never covered */}
      {selOpen && (
        <div className="fixed z-[126] flex items-center justify-center backdrop-blur-sm"
          style={{ top: inset.top, right: inset.right, bottom: inset.bottom, left: inset.left, background: 'rgba(5,6,12,0.82)', borderRadius: 10, transition: EASE }}
          onClick={() => setSelOpen(false)}>
          <div className="grid grid-cols-2 gap-3 p-4 w-full max-w-[520px]" onClick={e => e.stopPropagation()}>
            {([
              ['games', '▶', 'GAMES', 'browse — click the grid to play'],
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

      {/* ═ THE BOTTOM BAR — the one control spot, NEVER covered ═ */}
      <div className="fixed bottom-0 inset-x-0 z-[135] flex flex-col justify-end"
        style={{ height: barH, paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}>
        {browsing && (
          <>
            {/* TAB ROW — which games deal into the selector */}
            <div className="flex items-center justify-center gap-1.5 pb-1.5">
              {([['published', '▶ GAMES'], ['premium', '✦ PREMIUM']] as const).map(([k, label]) => (
                <button key={k} onClick={() => setTab(k)}
                  className={`font-mono text-[10.5px] tracking-[0.18em] px-3 py-1 rounded-lg border transition-colors ${
                    tab === k ? 'bg-emerald-400/15 border-emerald-300/50 text-emerald-100' : 'bg-black/40 border-white/10 text-white/40 hover:text-white/70'}`}>
                  {label}
                </button>
              ))}
            </div>
            {/* PREVIEW ROW — selecting hot-swaps the world INTO the grid */}
            <div className="flex items-center gap-2 px-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'thin' }}>
              <div className="flex items-center gap-2 mx-auto">
                {entries.map(e => (
                  <button key={e.slug} onClick={() => pick(e)}
                    className={`shrink-0 font-mono text-[11px] tracking-[0.12em] px-3.5 py-2.5 rounded-xl border transition-colors ${
                      scene === e.scene ? 'bg-sky-400/15 border-sky-300/60 text-sky-100' : 'bg-black/50 border-white/12 text-white/55 hover:text-white/85'}`}>
                    {e.name}
                  </button>
                ))}
                <span className="w-px h-6 bg-white/10 mx-1" aria-hidden />
                <Dockstar open={selOpen} onToggle={() => setSelOpen(o => !o)} />
              </div>
            </div>
          </>
        )}
        {!browsing && (
          <div className="flex items-center justify-center gap-2 pb-1">
            {uiSet === 'games' && (
              <button onClick={() => setPhase('browse')}
                className="font-mono text-[12px] tracking-[0.2em] px-4 py-2 rounded-xl bg-black/55 border border-white/15 text-white/75 hover:text-white transition-colors">
                ◱ GAMES
              </button>
            )}
            {uiSet !== 'games' && (
              <span className="font-mono text-[10.5px] tracking-[0.2em] text-white/30 px-3">
                {uiSet.toUpperCase()} — docks here next
              </span>
            )}
            <Dockstar open={selOpen} onToggle={() => setSelOpen(o => !o)} />
          </div>
        )}
      </div>
    </div>
  )
}

function Dockstar({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} aria-label="ui selector" title="▣ dockstar — choose the UI"
      className={`shrink-0 w-10 h-10 grid place-items-center rounded-xl backdrop-blur border text-[16px] transition-colors ${
        open ? 'bg-amber-400/25 border-amber-300/70 text-amber-100' : 'bg-black/55 border-white/15 text-white/75 hover:text-amber-200'}`}>
      ▣
    </button>
  )
}
