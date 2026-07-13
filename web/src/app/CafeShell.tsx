'use client'

import { useEffect, useRef, useState } from 'react'
import FieldEngine from '@/app/engine/FieldEngine'
import { startCafeAudio, setScene as setAudioScene, sfx, isMuted, setMuted } from '@/app/engine/cafe-audio'

const BLURBS: Record<string, string> = {
  'FABRIC': 'bend starlight',
  'ORRERY': 'grow a solar system',
  'GARNET': 'build a ship of crystals',
  'ONE DAY': 'a lighthouse keeps its whole day',
  'SAIL': 'one boat, real water',
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
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [mute, setMute] = useState(false)
  const [portals, setPortals] = useState<{ name: string; x: number; y: number; r: number }[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [vp, setVp] = useState({ w: 0, h: 0 })
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const captionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sceneRef = useRef(scene)
  sceneRef.current = scene
  const confirmRef = useRef(confirmLeave)
  confirmRef.current = confirmLeave
  const pause = (on: boolean) => window.dispatchEvent(new CustomEvent('cafe:pause', { detail: on }))
  const openConfirm = () => { setConfirmLeave(true); pause(true) }
  const stay = () => { setConfirmLeave(false); pause(false) }

  const go = (name: string, push = true) => {
    if (name !== sceneRef.current) { if (name === 'CAFE') sfx.leave(); else sfx.launch(name) }
    setAudioScene(name)
    setScene(name)
    setHover(null)
    setCaption(null)
    setConfirmLeave(false)
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
    startCafeAudio(initialScene)
    setMute(isMuted())
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || sceneRef.current === 'CAFE') return
      // leaving pauses the world and asks — a mid-game ESC costs nothing
      if (confirmRef.current) { setConfirmLeave(false); pause(false) }
      else { setConfirmLeave(true); pause(true) }
    }
    const onPop = () => {
      const m = window.location.pathname.match(/^\/play\/(.+)$/)
      go(m ? decodeURIComponent(m[1]) : 'CAFE', false)
    }
    const onMove = (e: PointerEvent) => setMouse({ x: e.clientX, y: e.clientY })
    const onPortals = (e: Event) => setPortals((e as CustomEvent).detail || [])
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    onResize()
    window.addEventListener('cafe:launch', onLaunch)
    window.addEventListener('cafe:hover', onHover)
    window.addEventListener('cafe:caption', onCaption)
    window.addEventListener('keydown', onKey)
    window.addEventListener('popstate', onPop)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('cafe:portals', onPortals)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('cafe:launch', onLaunch)
      window.removeEventListener('cafe:hover', onHover)
      window.removeEventListener('cafe:caption', onCaption)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('cafe:portals', onPortals)
      window.removeEventListener('resize', onResize)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // presence: one heartbeat per person, one poll for the door counts
  useEffect(() => {
    let pid = ''
    try {
      pid = localStorage.getItem('cc-pid') || Math.random().toString(36).slice(2, 12)
      localStorage.setItem('cc-pid', pid)
    } catch { pid = Math.random().toString(36).slice(2, 12) }
    const beat = () => {
      fetch('/api/presence', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene, id: pid }),
      }).catch(() => {})
    }
    const poll = () => {
      if (sceneRef.current !== 'CAFE') return
      fetch('/api/presence').then(r => r.ok ? r.json() : null)
        .then(d => d && setCounts(d.counts || {})).catch(() => {})
    }
    // the door count is a live thing: beat fast, and say goodbye on the way out
    const bye = () => {
      try { navigator.sendBeacon('/api/presence', JSON.stringify({ id: pid, leave: true })) } catch { /* gone anyway */ }
    }
    beat()
    poll()
    const bi = setInterval(beat, 12000)
    const ci = setInterval(poll, 6000)
    window.addEventListener('pagehide', bye)
    return () => { clearInterval(bi); clearInterval(ci); window.removeEventListener('pagehide', bye) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  const inGame = scene !== 'CAFE'
  // uv → screen for the contain-fit square (span = min(w,h), centered)
  const span = Math.min(vp.w, vp.h)

  return (
    <>
      <FieldEngine playScene={scene} />

      {/* a name surfaces where you're looking, then gets out of the way */}
      {!inGame && hover && (mouse.x !== 0 || mouse.y !== 0) && (
        <div
          className="fixed z-50 pointer-events-none select-none rounded-xl bg-black/60 backdrop-blur-sm border border-brass/20 px-3.5 py-2.5"
          style={{ left: mouse.x + 18, top: mouse.y - 8 }}
        >
          <div className="cafe-sign text-xl leading-none">{hover.toLowerCase()}</div>
          <div className="font-mono text-[9px] tracking-[0.25em] text-crema/60 uppercase mt-1.5">
            {BLURBS[hover] || ''} · click to enter
          </div>
        </div>
      )}

      {/* who's inside: a head-count on every door */}
      {!inGame && vp.w > 0 && portals.map(pt => {
        const n = counts[pt.name] || 0
        const px = vp.w / 2 + (pt.x + pt.r * 0.75) * span / 2
        const py = vp.h / 2 + (pt.y + pt.r * 0.75) * span / 2
        return (
          <div key={pt.name}
            className={`fixed z-40 pointer-events-none select-none font-mono text-[10px] rounded-full border px-1.5 py-0.5 backdrop-blur-sm ${n > 0 ? 'border-brass/60 bg-void/70 text-glow' : 'border-brass/20 bg-void/50 text-crema/30'}`}
            style={{ left: px, top: py, transform: 'translate(-50%, -50%)' }}>
            ◉ {n}
          </div>
        )
      })}

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

      {/* the cafe's ears — one small switch, bottom-right */}
      <button
        onClick={() => { setMuted(!mute); setMute(!mute) }}
        aria-label={mute ? 'Unmute' : 'Mute'}
        className="fixed bottom-4 right-4 z-50 w-8 h-8 rounded-full border border-brass/40 bg-void/60 backdrop-blur-sm text-glow/60 hover:text-glow font-mono text-[11px] transition-colors"
      >
        {mute ? '∅' : '♪'}
      </button>

      {/* every level: a way back, top-left. It pauses and asks. */}
      {inGame && (
        <button
          onClick={() => (confirmLeave ? stay() : openConfirm())}
          aria-label="Back to the cafe"
          className="fixed top-4 left-4 z-50 w-9 h-9 rounded-full border border-brass/50 bg-void/70 backdrop-blur-sm text-glow/80 hover:text-glow hover:border-brass font-mono text-sm transition-colors"
        >
          ◂
        </button>
      )}
      {inGame && confirmLeave && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-void/60 backdrop-blur-[2px]"
          onClick={stay}>
          <div className="border border-brass/40 rounded-xl px-8 py-6 text-center bg-void/95 shadow-[0_0_60px_rgba(245,176,76,0.15)]"
            onClick={e => e.stopPropagation()}>
            <div className="cafe-sign text-2xl mb-1">leave this world?</div>
            <div className="font-mono text-[10px] tracking-[0.2em] text-crema/50 uppercase mb-5">
              the world is paused · your save keeps
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={stay}
                className="rounded-lg bg-flame/90 hover:bg-glow px-5 py-2 font-mono text-[11px] tracking-[0.15em] text-void transition-colors">
                STAY
              </button>
              <button onClick={() => { pause(false); go('CAFE') }}
                className="brass-tab px-5 py-2 text-[11px]">
                LEAVE
              </button>
            </div>
          </div>
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
