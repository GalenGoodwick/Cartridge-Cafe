'use client'

// THE CONVERSION — the rung-1 proof page, FULLY FUNCTIONAL (Galen: "stop
// skipping effort"). Mounts the REAL FieldEngine on the REAL cinderfell world
// (its live snapshot exported to public/cartridges/CINDERFELL.json — the same
// data /space/cinderfell serves) with shellWorldUi injected: the world's
// chrome drawn BY THE ENGINE inside the world's own solve, and DRIVEN by the
// SAME shell host SpaceStage uses (useShellHost — one pipeline, no copies).
//   · pills are engine pixels; clicks hit-test on the solved rects
//   · # PLAY strips to gameplay · ? INSTRUCTIONS opens the panel · / EDIT
//     opens the owner fold · = BUILDERBOX opens the chat · < goes home
//   · ?phone=1 forces the phone instance (real: it changes the composed doc)
//   · externalTopbar suppresses the engine's DOM title row — the pills ARE it
import { useEffect, useMemo, useState } from 'react'
import FieldEngine from '@/app/engine/FieldEngine'
import { worldChromeUi } from '@/app/engine/ui-blocks'
import { useShellHost } from '@/app/engine/useShellHost'

export default function ConversionProof() {
  const [scene, setScene] = useState('CINDERFELL')
  const [winDim, setWinDim] = useState<{ w: number; h: number }>({ w: 9999, h: 800 })
  const [forcePhone, setForcePhone] = useState(false)
  useEffect(() => {
    try {
      const u = new URL(window.location.href)
      const s = u.searchParams.get('scene'); if (s) setScene(s.toUpperCase())
      if (u.searchParams.get('phone') === '1') setForcePhone(true)
    } catch { /* ssr */ }
    const m = () => setWinDim({ w: window.innerWidth, h: window.innerHeight })
    m(); window.addEventListener('resize', m)
    return () => window.removeEventListener('resize', m)
  }, [])
  // THE SAME HOST SPACESTAGE USES — back goes home, engine cmds route by name
  const lastAction = useShellHost()

  // ?debug=1 — HIT-RECT TRUTH OVERLAY: DOM outlines at each solved hit's
  // inverse-mapped client position. If an outline doesn't sit exactly on its
  // drawn pill, the draw/hit mapping has drifted — visible instantly, no guess.
  const [debug, setDebug] = useState(false)
  const [hitBoxes, setHitBoxes] = useState<Array<{ id: string; x: number; y: number; w: number; h: number }>>([])
  useEffect(() => {
    try { if (new URL(window.location.href).searchParams.get('debug') === '1') setDebug(true) } catch { /* ssr */ }
  }, [])
  useEffect(() => {
    if (!debug) return
    const t = setInterval(() => {
      type DevSim = { worldData?: { __uiRects?: { hits: Array<{ id: string; action?: string; x: number; y: number; w: number; h: number }> } } }
      const sim = (globalThis as unknown as { __ccDevSim?: DevSim }).__ccDevSim
      const hits = sim?.worldData?.__uiRects?.hits
      const cv = document.querySelector('canvas')
      if (!hits || !cv) return
      const r = cv.getBoundingClientRect()
      const side = Math.min(r.width, r.height)
      setHitBoxes(hits.filter(h => h.action?.startsWith('shell:')).map(h => ({
        id: h.id,
        x: r.left + (r.width - side) / 2 + h.x * side / 512,
        y: r.top + (r.height - side) / 2 + h.y * side / 512,
        w: h.w * side / 512, h: h.h * side / 512,
      })))
    }, 500)
    return () => clearInterval(t)
  }, [debug])
  const shell = useMemo(() => worldChromeUi({
    title: scene, sub: 'MAIN - LIVE',
    instance: forcePhone || winDim.w < 700 ? 'phone' : 'desktop',
    isOwner: false,
    window: forcePhone ? { w: Math.min(winDim.w, 412), h: winDim.h } : winDim,
  }), [scene, winDim, forcePhone])
  return (
    <div className="fixed inset-0">
      <FieldEngine playScene={scene} shellUi={shell} hooksTrusted externalTopbar />
      {/* eye marker — proves the click seam fired (dev proof page only) */}
      {lastAction && (
        <div data-shell-action={lastAction}
          className="fixed bottom-1 right-2 z-[999] font-mono text-[10px] text-emerald-300/70 pointer-events-none">
          {lastAction}
        </div>
      )}
      {/* ?debug=1 — hit rects outlined at their true client positions */}
      {debug && hitBoxes.map(b => (
        <div key={b.id} className="fixed z-[998] pointer-events-none border border-emerald-400/80"
          style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
          <span className="absolute -top-4 left-0 font-mono text-[9px] text-emerald-300">{b.id}</span>
        </div>
      ))}
    </div>
  )
}
