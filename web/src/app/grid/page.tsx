'use client'

// ═══ THE GRID — from scratch (Galen, Aug 28) ═══
// "First thing is to grab the way the grid was contained in the RECKONING, and
// plug in the resizable grid with the blue outline. First proof is just some
// buttons to click to change dimension size, to make sure this flows right."
//
// THE RECKONING'S CONTAINMENT: FieldEngine's `viewport` prop — the engine root
// insets from each window edge, chromeless, with its OWN 0.32s ease-out on the
// inset (built for the vote reckoning's embeds). The world canvas rebuffers to
// the contained rect automatically (clientWidth-driven).
//
// THE FRAME: the blue outline + gold corners from /design/shell, as a DOM
// frame at the SAME inset with the SAME transition — they move as one.
//
// Nothing else. The selector overlay / UI sets dock onto this once the resize
// flow is proven.
import { useEffect, useMemo, useState } from 'react'
import FieldEngine from '@/app/engine/FieldEngine'

type Inset = { top: number; right: number; bottom: number; left: number }

// dimension presets — each computes an inset for the CURRENT window
const PRESETS = ['FULL', 'WIDE', 'SQUARE', 'TALL', 'MINI'] as const
type Preset = typeof PRESETS[number]

function insetFor(p: Preset, W: number, H: number): Inset {
  const M = 16                                   // breathing margin
  const TOP = 16, BOTTOM = 64                    // no top bar — just margin; bottom = proof buttons
  const availW = W - M * 2, availH = H - TOP - BOTTOM
  const fit = (aspect: number, scale = 1) => {
    let w = availW * scale, h = w / aspect
    if (h > availH * scale) { h = availH * scale; w = h * aspect }
    const left = (W - w) / 2, top = TOP + (availH - h) / 2
    return { top, right: W - left - w, bottom: H - top - h, left }
  }
  switch (p) {
    case 'FULL': return { top: TOP, right: M, bottom: BOTTOM, left: M }
    case 'WIDE': return fit(16 / 9)
    case 'SQUARE': return fit(1)
    case 'TALL': return fit(9 / 16)
    case 'MINI': return fit(16 / 10, 0.45)
  }
}

const EASE = 'top 0.32s ease-out, right 0.32s ease-out, bottom 0.32s ease-out, left 0.32s ease-out'

export default function TheGrid() {
  const [win, setWin] = useState({ w: 1280, h: 800 })
  const [preset, setPreset] = useState<Preset>('FULL')
  const [selOpen, setSelOpen] = useState(false)                                  // the dockstar's selector
  const [uiSet, setUiSet] = useState<'games' | 'main' | 'engine' | 'create'>('games')   // the docked UI set
  useEffect(() => {
    const m = () => setWin({ w: window.innerWidth, h: window.innerHeight })
    m(); window.addEventListener('resize', m)
    return () => window.removeEventListener('resize', m)
  }, [])
  const inset = useMemo(() => insetFor(preset, win.w, win.h), [preset, win])

  // UNIFIED RESIZE (Galen: 'square does an instant snap — is this a unified
  // function?'): it wasn't — the inset EASED (CSS 0.32s) while the camera
  // re-fit fired ONCE after, as a snap. Now one source drives both: during the
  // ease we re-fit EVERY FRAME against the live (animating) container rect, so
  // the cover-camera glides with the frame. Cover worlds re-cover continuously;
  // contain worlds keep their own declaration.
  useEffect(() => {
    let raf = 0
    const t0 = performance.now()
    const tick = () => {
      try { window.dispatchEvent(new Event('resize')) } catch { /* ssr */ }
      if (performance.now() - t0 < 460) raf = requestAnimationFrame(tick)   // ease 320ms + settle
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inset])

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #0c0b14, #050509)' }}>
      {/* THE ONE GRID — the reckoning containment: chromeless engine at the
          inset. externalTopbar: the engine's own ◂/identity strip yields — the
          world's name lives in OUR top bar, never inside the game. */}
      <FieldEngine playScene="CINDERFELL" hooksTrusted viewport={inset} externalTopbar />

      {/* THE FRAME — blue outline + gold corners, riding the same inset/ease */}
      <div
        className="fixed pointer-events-none"
        style={{
          top: inset.top, right: inset.right, bottom: inset.bottom, left: inset.left,
          border: '1px solid rgba(80,200,255,0.45)', borderRadius: 10,
          boxShadow: '0 0 0 1px rgba(0,0,0,0.6), inset 0 0 40px rgba(0,0,0,0.35)',
          transition: EASE,
        }}
      >
        {([['top', 'left'], ['top', 'right'], ['bottom', 'left'], ['bottom', 'right']] as const).map(([v, h]) => (
          <span key={v + h} aria-hidden style={{
            position: 'absolute', width: 22, height: 22, [v]: -1, [h]: -1,
            [`border${v[0].toUpperCase() + v.slice(1)}`]: '2px solid rgba(255,190,60,0.9)',
            [`border${h[0].toUpperCase() + h.slice(1)}`]: '2px solid rgba(255,190,60,0.9)',
            [`border${v[0].toUpperCase() + v.slice(1)}${h === 'left' ? 'Left' : 'Right'}Radius`]: 10,
          } as React.CSSProperties} />
        ))}
      </div>

      {/* THE UI SELECTOR — an OVERLAY over the GAME FIELD only (Galen: "I don't
          want a dropdown, I want an overlay. Bottom bar is NEVER covered.").
          It fills the frame's inset rect exactly — the bottom bar stays live
          below it. Every set is offered on every device (mobile has the engine:
          create = paste the prompt into your working AI). */}
      {selOpen && (
        <div
          className="fixed z-[126] flex items-center justify-center backdrop-blur-sm"
          style={{ top: inset.top, right: inset.right, bottom: inset.bottom, left: inset.left, background: 'rgba(5,6,12,0.82)', borderRadius: 10, transition: EASE }}
          onClick={() => setSelOpen(false)}
        >
          <div className="grid grid-cols-2 gap-3 p-4 w-full max-w-[520px]" onClick={e => e.stopPropagation()}>
            {([
              ['games', '▶', 'GAMES', 'browse — click the grid to play'],
              ['main', '◉', 'MAIN', 'the commons + social space'],
              ['engine', '⚙', 'ENGINE', 'world tools · builderbox'],
              ['create', '✚', 'CREATE', 'new world · fork from grid · paste the prompt to your AI'],
            ] as const).map(([k, icon, label, sub]) => (
              <button key={k}
                onClick={() => { setUiSet(k); setSelOpen(false) }}
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

      {/* THE BOTTOM BAR — the ONE control spot (never covered by any overlay).
          The ▣ dockstar lives here now; the dimension buttons remain as the
          resize proof until GAMES docks (sizing itself moves into the world
          GENERATION flow — a world's dimension is declared at creation). */}
      <div className="fixed bottom-0 inset-x-0 h-[64px] z-[135] flex items-center justify-center gap-2"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {PRESETS.map(p => (
          <button key={p} onClick={() => setPreset(p)}
            className={`font-mono text-[12px] tracking-[0.2em] px-4 py-2 rounded-xl border transition-colors ${
              preset === p ? 'bg-sky-400/15 border-sky-300/60 text-sky-100' : 'bg-black/50 border-white/12 text-white/45 hover:text-white/80'}`}>
            {p}
          </button>
        ))}
        <span className="w-px h-6 bg-white/10 mx-1" aria-hidden />
        <button
          onClick={() => setSelOpen(o => !o)}
          aria-label="ui selector"
          className={`w-10 h-10 grid place-items-center rounded-xl backdrop-blur border text-[16px] transition-colors ${
            selOpen ? 'bg-amber-400/25 border-amber-300/70 text-amber-100' : 'bg-black/55 border-white/15 text-white/75 hover:text-amber-200'}`}
          title="▣ dockstar — choose the UI"
        >▣</button>
      </div>
    </div>
  )
}
