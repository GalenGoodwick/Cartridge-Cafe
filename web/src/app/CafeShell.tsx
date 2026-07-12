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
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 font-mono text-[10px] tracking-[0.3em] text-glow/40 pointer-events-none select-none">
          ESC → CAFE
        </div>
      )}

      {/* the cafe wears its sign; games wear nothing */}
      {!inGame && (
        <>
          <div className="fixed top-5 left-6 z-50 pointer-events-none select-none">
            <div className="cafe-sign text-3xl">
              cartridge<span className="not-italic font-mono text-lg text-brass">.cafe</span>
            </div>
            <div className="font-mono text-[9px] tracking-[0.42em] text-crema/40 uppercase mt-1.5 arrive" style={{ animationDelay: '1.6s' }}>
              hover a window · step through
            </div>
          </div>
          <div className="fixed top-5 right-6 z-50 flex gap-2 arrive" style={{ animationDelay: '0.8s' }}>
            <a href="/worlds" className="brass-tab px-3 py-1.5 text-[10px]">THE SHELF</a>
            <a href="/auth/signin" className="rounded-lg bg-flame/90 hover:bg-glow px-3 py-1.5 font-mono text-[10px] tracking-[0.15em] text-void transition-colors">
              BREW YOURS
            </a>
          </div>
          <div className="fixed bottom-5 left-0 right-0 z-50 flex justify-center gap-1 px-4 flex-wrap arrive" style={{ animationDelay: '1.1s' }}>
            {GAMES.map(g => (
              <button key={g} onClick={() => go(g)} className="brass-tab px-2.5 py-1 text-[10px]">
                {g}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}
