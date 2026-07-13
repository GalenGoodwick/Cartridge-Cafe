'use client'

import { useEffect, useRef, useState } from 'react'
import FieldEngine from '@/app/engine/FieldEngine'

const BLURBS: Record<string, string> = {
  'FABRIC': 'bend starlight',
  'ORRERY': 'grow a solar system',
  'GARNET': 'build a ship of crystals',
  'ONE DAY': 'a lighthouse keeps its whole day',
  'SAIL': 'one boat, real water',
  'SOLSTICE': 'you are the sun',
  'TIDERUNNER': 'sail against the wind',
  'SIGNAL': 'speak a world into being',
  'NOCTURNE': 'a night drive, neon and rain',
  'NOCTURNE DISTRICT': 'the city as a pinball table',
  'ESPER': 'stealth on the hex lattice',
  'TV': 'channels that compute themselves',
  'PROOF': 'a world that accumulates law',
  'HELIOS': 'carry the sun, hold for the moon',
  'LIGHTHOUSE': 'your cursor is the hour',
}

/** The world IS the interface. The only HTML: the sign, two small doors,
 *  and a name that appears at your cursor when a window notices you. */
export default function CafeShell({ initialScene = 'CAFE' }: { initialScene?: string }) {
  const [scene, setScene] = useState(initialScene)
  const [hint, setHint] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  const [mouse, setMouse] = useState({ x: 0, y: 0 })
  const [caption, setCaption] = useState<{ text: string; kind: string } | null>(null)
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const captionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const go = (name: string, push = true) => {
    setScene(name)
    setHover(null)
    setCaption(null)
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
    const onHover = (e: Event) => setHover((e as CustomEvent).detail)
    // worlds can put a line of phosphor text on the glass — SIGNAL shows the word you type
    const onCaption = (e: Event) => {
      const d = (e as CustomEvent).detail as { text: string; kind: string } | null
      if (captionTimer.current) clearTimeout(captionTimer.current)
      if (!d || (!d.text && d.kind !== 'typing')) { setCaption(null); return }
      setCaption(d)
      if (d.kind !== 'typing') captionTimer.current = setTimeout(() => setCaption(null), d.kind === 'hint' ? 6000 : 3200)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') go('CAFE') }
    const onPop = () => {
      const m = window.location.pathname.match(/^\/play\/(.+)$/)
      go(m ? decodeURIComponent(m[1]) : 'CAFE', false)
    }
    const onMove = (e: PointerEvent) => setMouse({ x: e.clientX, y: e.clientY })
    window.addEventListener('cafe:launch', onLaunch)
    window.addEventListener('cafe:hover', onHover)
    window.addEventListener('cafe:caption', onCaption)
    window.addEventListener('keydown', onKey)
    window.addEventListener('popstate', onPop)
    window.addEventListener('pointermove', onMove)
    return () => {
      window.removeEventListener('cafe:launch', onLaunch)
      window.removeEventListener('cafe:hover', onHover)
      window.removeEventListener('cafe:caption', onCaption)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('pointermove', onMove)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const inGame = scene !== 'CAFE'

  return (
    <>
      <FieldEngine playScene={scene} />

      {/* a name surfaces where you're looking, then gets out of the way */}
      {!inGame && hover && (mouse.x !== 0 || mouse.y !== 0) && (
        <div
          className="fixed z-50 pointer-events-none select-none"
          style={{ left: mouse.x + 18, top: mouse.y - 8 }}
        >
          <div className="cafe-sign text-xl leading-none">{hover.toLowerCase()}</div>
          <div className="font-mono text-[9px] tracking-[0.25em] text-crema/50 uppercase mt-1">
            {BLURBS[hover] || ''} · click to enter
          </div>
        </div>
      )}

      {/* a world's OSD — old TV set lettering, top-left of the glass */}
      {caption && (caption.text || caption.kind === 'typing') && (
        <div className="fixed top-8 left-10 z-50 pointer-events-none select-none font-mono uppercase tracking-[0.3em]"
          style={{
            color: caption.kind === 'hint' ? 'rgba(140,255,170,0.45)' : 'rgb(140,255,170)',
            fontSize: caption.kind === 'hint' ? 11 : 22,
            textShadow: '0 0 8px rgba(80,255,140,0.8), 0 0 28px rgba(80,255,140,0.35)',
          }}>
          {caption.text}{caption.kind === 'typing' ? '▮' : ''}
        </div>
      )}

      {/* in a game: nothing but a hint that leaves */}
      {inGame && hint && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 font-mono text-[10px] tracking-[0.3em] text-glow/40 pointer-events-none select-none">
          ESC → CAFE
        </div>
      )}

      {/* the sign and two small doors — the only permanent chrome */}
      {!inGame && (
        <>
          <div className="fixed top-5 left-6 z-50 pointer-events-none select-none">
            <div className="cafe-sign text-2xl">
              cartridge<span className="not-italic font-mono text-base text-brass">.cafe</span>
            </div>
            <div className="font-mono text-[9px] tracking-[0.18em] text-glow/50 mt-1">
              Instant natural language to game world framework.
            </div>
          </div>
          <div className="fixed top-5 right-6 z-50 flex gap-2">
            <a href="/worlds" className="brass-tab px-3 py-1.5 text-[10px]">THE SHELF</a>
            <a href="/auth/signin" className="rounded-lg bg-flame/90 hover:bg-glow px-3 py-1.5 font-mono text-[10px] tracking-[0.15em] text-void transition-colors">
              BREW YOURS
            </a>
          </div>
        </>
      )}
    </>
  )
}
