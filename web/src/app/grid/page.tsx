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
  const TOP = 52, BOTTOM = 64                    // reserved bands (title / buttons)
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
  useEffect(() => {
    const m = () => setWin({ w: window.innerWidth, h: window.innerHeight })
    m(); window.addEventListener('resize', m)
    return () => window.removeEventListener('resize', m)
  }, [])
  const inset = useMemo(() => insetFor(preset, win.w, win.h), [preset, win])

  // COVER re-fit: the engine's camera fit listens to window resize; when the
  // CONTAINER changes (a preset lands) we nudge it after the 0.32s ease so the
  // world re-covers the new aspect — more or less game shown, never letterbox
  // (for worlds that DECLARE their rect; contain-style worlds keep letterboxing
  // by their own declaration — maximally flexible, per world).
  useEffect(() => {
    const t = setTimeout(() => { try { window.dispatchEvent(new Event('resize')) } catch { /* ssr */ } }, 360)
    return () => clearTimeout(t)
  }, [inset])

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #0c0b14, #050509)' }}>
      {/* THE ONE GRID — the reckoning containment: chromeless engine at the inset */}
      <FieldEngine playScene="CINDERFELL" hooksTrusted viewport={inset} />

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

      {/* title band — minimal for now; the SELECTOR overlay docks here next */}
      <div className="fixed top-0 inset-x-0 h-[52px] z-[120] flex items-center justify-center pointer-events-none">
        <span className="font-mono text-[13px] tracking-[0.3em] text-white/70">CARTRIDGE.CAFE</span>
      </div>

      {/* THE PROOF — dimension buttons: click → the grid + frame flow together */}
      <div className="fixed bottom-0 inset-x-0 h-[64px] z-[120] flex items-center justify-center gap-2">
        {PRESETS.map(p => (
          <button key={p} onClick={() => setPreset(p)}
            className={`font-mono text-[12px] tracking-[0.2em] px-4 py-2 rounded-xl border transition-colors ${
              preset === p ? 'bg-sky-400/15 border-sky-300/60 text-sky-100' : 'bg-black/50 border-white/12 text-white/45 hover:text-white/80'}`}>
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}
