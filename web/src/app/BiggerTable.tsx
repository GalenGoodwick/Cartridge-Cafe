'use client'

import { useState, useEffect } from 'react'

/** BIGGER TABLE (Galen, Aug 20): the cafe wants the whole desk. A DESKTOP
 *  visitor in a shrunken window is asked to maximize it — the notice watches
 *  resize and clears ITSELF the moment the window is big enough (no dismiss
 *  needed for the honest fix). (A Safari Hide-IP ask shipped here for ~an hour
 *  and was removed same day — Galen: hidden IP is welcome; don't re-add it.)
 *  Never on touch devices (phones are already fullscreen; there is nothing to
 *  maximize). Hides during ⛶ gameplay mode like the rest of the chrome.
 *  Dismiss is per-tab (sessionStorage) — a returning visitor gets one quiet
 *  reminder per session, never a nag loop. */
export default function BiggerTable() {
  const [small, setSmall] = useState(false)
  const [dismissed, setDismissed] = useState(true)   // stay hidden until the client checks run
  const [playMode, setPlayMode] = useState(false)

  useEffect(() => {
    // desktop = fine pointer; a coarse-pointer (touch) device can't "maximize"
    const desktop = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches
    if (!desktop) return
    setDismissed(sessionStorage.getItem('cafe:bigger-table') === '1')
    const onR = () => {
      // "smaller than the desk": meaningfully under the screen the window sits on
      const s = window.screen
      const aw = s?.availWidth || 0, ah = s?.availHeight || 0
      setSmall(aw >= 1024 && (window.innerWidth < aw * 0.72 || window.innerHeight < ah * 0.72))
    }
    onR()
    window.addEventListener('resize', onR)
    return () => window.removeEventListener('resize', onR)
  }, [])

  useEffect(() => {
    const on = (e: Event) => setPlayMode(!!(e as CustomEvent).detail)
    window.addEventListener('cafe:playmode', on)
    return () => window.removeEventListener('cafe:playmode', on)
  }, [])

  const dismiss = () => { setDismissed(true); try { sessionStorage.setItem('cafe:bigger-table', '1') } catch { /* private mode */ } }

  if (dismissed || playMode || !small) return null

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[65] max-w-[92vw] rounded-lg border border-[#b97a2a]/30 bg-[#171009]/90 backdrop-blur px-4 py-2.5 font-mono text-[13px] tracking-wider text-[#ffdba8]/90 shadow-lg">
      <div className="flex items-start gap-3">
        <div className="space-y-1">
          <div>▢ the cafe needs a bigger table — <span className="text-[#ffdba8]">maximize this window</span></div>
        </div>
        <button aria-label="dismiss" onClick={dismiss} className="text-[#ffdba8]/50 hover:text-[#ffdba8] transition-colors leading-none pt-0.5">✕</button>
      </div>
    </div>
  )
}
