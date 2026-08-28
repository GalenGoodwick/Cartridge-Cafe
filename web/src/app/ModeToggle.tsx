'use client'

// THE MODE TOGGLE (Galen, Aug 28) — lives on main; flips the whole site between
// PLAY (a console: play products, worlds show just the game) and ENGINE (a
// workshop: build worlds, worlds show edit controls). Shown everywhere,
// including mobile — but tapping ENGINE on a phone gets the desktop-only notice
// (the engine is desktop-only) instead of switching.
import { useState } from 'react'
import { useAppMode } from '@/app/engine/app-mode'

export default function ModeToggle({ compact }: { compact?: boolean }) {
  const { mode, ready, setMode } = useAppMode()
  const [blocked, setBlocked] = useState(false)
  if (!ready) return <div style={{ width: compact ? 96 : 150, height: 30 }} aria-hidden />

  const pick = (m: 'play' | 'engine') => {
    if (m === 'engine' && !setMode('engine')) { setBlocked(true); return }   // mobile: no engine
    setMode(m)
  }
  const seg = (m: 'play' | 'engine', label: string) => (
    <button
      onClick={() => pick(m)}
      aria-pressed={mode === m}
      className={`font-mono tracking-[0.15em] px-3 py-1.5 rounded-lg transition-colors ${compact ? 'text-[11px]' : 'text-[12px]'} ${
        mode === m
          ? (m === 'engine' ? 'bg-amber-400/20 border border-amber-300/60 text-amber-100' : 'bg-emerald-400/20 border border-emerald-300/60 text-emerald-100')
          : 'border border-white/12 text-white/45 hover:text-white/80'
      }`}
    >{label}</button>
  )

  return (
    <div className="relative shrink-0 flex items-center gap-1 rounded-xl p-0.5 bg-black/40" role="group" aria-label="site mode">
      {seg('play', '▶ PLAY')}
      {seg('engine', '⚙ ENGINE')}
      {blocked && (
        <>
          <div className="fixed inset-0 z-[130]" onClick={() => setBlocked(false)} />
          <div className="absolute z-[131] top-full right-0 mt-2 w-64 rounded-xl border border-amber-300/30 bg-[#171009]/97 backdrop-blur p-4 shadow-2xl">
            <div className="text-[28px] mb-1">🖥️</div>
            <div className="font-mono text-[13px] tracking-[0.15em] text-amber-200 mb-1">ENGINE IS DESKTOP-ONLY</div>
            <p className="font-mono text-[11px] leading-relaxed text-white/55 m-0">Building runs the WebGPU engine + editing tools — a desktop-sized job. Open cartridge.cafe on a computer to build. On your phone, PLAY is where it's at.</p>
            <button onClick={() => setBlocked(false)} className="mt-3 w-full font-mono text-[11px] tracking-[0.15em] py-2 rounded-lg border border-white/15 text-white/60">GOT IT</button>
          </div>
        </>
      )}
    </div>
  )
}
