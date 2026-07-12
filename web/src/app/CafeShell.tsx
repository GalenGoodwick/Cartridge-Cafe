'use client'

import { useEffect, useRef, useState } from 'react'
import FieldEngine from '@/app/engine/FieldEngine'

const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME || 'cartridge.cafe'
const GAMES = ['FABRIC', 'ORRERY', 'GARNET', 'ONE DAY', 'SAIL', 'SOLSTICE', 'TIDERUNNER']

/** One world, many scenes. Portal travel swaps the scene in place and keeps the
 *  URL honest via pushState. In a game, the world owns the whole screen — the
 *  only chrome is a hint that fades. ESC walks home. */
export default function CafeShell({ initialScene = 'CAFE' }: { initialScene?: string }) {
  const [scene, setScene] = useState(initialScene)
  const [hint, setHint] = useState(false)
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const go = (name: string, push = true) => {
    setScene(name)
    if (push && typeof window !== 'undefined') {
      window.history.pushState({ scene: name }, '', name === 'CAFE' ? '/' : `/play/${encodeURIComponent(name)}`)
    }
    if (name !== 'CAFE') {
      setHint(true)
      if (hintTimer.current) clearTimeout(hintTimer.current)
      hintTimer.current = setTimeout(() => setHint(false), 4000)
    }
  }

  useEffect(() => {
    const onLaunch = (e: Event) => {
      const name = (e as CustomEvent).detail
      if (typeof name === 'string' && name) go(name)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') go('CAFE') }
    const onPop = () => {
      const m = window.location.pathname.match(/^\/play\/(.+)$/)
      go(m ? decodeURIComponent(m[1]) : 'CAFE', false)
    }
    window.addEventListener('cafe:launch', onLaunch)
    window.addEventListener('keydown', onKey)
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('cafe:launch', onLaunch)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('popstate', onPop)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const inGame = scene !== 'CAFE'

  return (
    <>
      <FieldEngine playScene={scene} />

      {/* in a game: nothing over the world but a hint that leaves */}
      {inGame && hint && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 font-mono text-[11px] text-white/40 pointer-events-none select-none transition-opacity">
          esc → cafe
        </div>
      )}

      {/* the cafe wears its sign; games wear nothing */}
      {!inGame && (
        <>
          <div className="fixed top-4 left-5 z-50 font-mono pointer-events-none select-none">
            <div className="font-serif text-2xl text-amber-50/90">{BRAND}</div>
            <div className="text-[10px] tracking-[0.35em] text-amber-200/40 uppercase mt-0.5">
              little worlds · hover a window · step through
            </div>
          </div>
          <div className="fixed top-4 right-5 z-50 flex gap-2 font-mono">
            <a href="/worlds" className="rounded-lg bg-black/50 backdrop-blur border border-white/10 px-3 py-1.5 text-xs text-amber-200/80 hover:text-amber-100 transition-colors">
              the shelf
            </a>
            <a href="/auth/signin" className="rounded-lg bg-amber-400/90 hover:bg-amber-300 px-3 py-1.5 text-xs font-semibold text-[#1a1206] transition-colors">
              brew yours
            </a>
          </div>
          <div className="fixed bottom-5 left-0 right-0 z-50 flex justify-center gap-1 font-mono px-4 flex-wrap">
            {GAMES.map(g => (
              <button
                key={g}
                onClick={() => go(g)}
                className="px-2.5 py-1 rounded text-[11px] text-amber-100/60 hover:text-amber-50 hover:bg-white/5 transition-colors tracking-wider"
              >
                {g}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}
