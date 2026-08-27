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
import { shellWorldUi } from '@/app/engine/ui-blocks'
import { useShellHost } from '@/app/engine/useShellHost'

export default function ConversionProof() {
  const [scene, setScene] = useState('CINDERFELL')
  const [instanceW, setInstanceW] = useState<number>(9999)
  const [forcePhone, setForcePhone] = useState(false)
  useEffect(() => {
    try {
      const u = new URL(window.location.href)
      const s = u.searchParams.get('scene'); if (s) setScene(s.toUpperCase())
      if (u.searchParams.get('phone') === '1') setForcePhone(true)
    } catch { /* ssr */ }
    const m = () => setInstanceW(window.innerWidth)
    m(); window.addEventListener('resize', m)
    return () => window.removeEventListener('resize', m)
  }, [])
  // THE SAME HOST SPACESTAGE USES — back goes home, engine cmds route by name
  const lastAction = useShellHost()
  const shell = useMemo(() => shellWorldUi({
    title: scene, sub: 'MAIN - LIVE',
    instance: forcePhone || instanceW < 700 ? 'phone' : 'desktop',
    isOwner: false,
  }), [scene, instanceW, forcePhone])
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
    </div>
  )
}
