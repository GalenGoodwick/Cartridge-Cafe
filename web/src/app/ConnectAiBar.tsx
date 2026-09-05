'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import ConnectPanel from '@/app/ConnectPanel'

/** ⚿ CONNECT AI — THE STANDING INVITATION (Galen, Sep 5: "big green, on the
 *  bottom bar, always accessible on any page"). One fixed pill on every page
 *  of the site, opening the ONE connect door (ConnectPanel). It rides the
 *  bottom-right corner; on world pages it lifts above the world's own bottom
 *  chrome instead of colliding with it. Responsive: full wordmark on desktop,
 *  compact on phones, never overlapping the dockstar cup (which keeps the
 *  bottom-center) or a world's SHARE cluster (we sit above it).  */
export default function ConnectAiBar() {
  const [open, setOpen] = useState(false)
  const path = usePathname() || '/'
  // world pages draw their own bottom chrome bar — ride above it
  // the grid (the games front door) carries its OWN green door in the bottom
  // bar — the floating pill would double it there
  if (path === '/grid' || path === '/') return null
  const lifted = path.startsWith('/space/') || path.startsWith('/play/')
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="connect your AI"
        className={`fixed z-[70] font-mono font-bold tracking-[0.14em] select-none
          right-3 sm:right-5 ${lifted ? 'bottom-[86px]' : 'bottom-3 sm:bottom-4'}
          text-[13px] sm:text-[15px] px-4 sm:px-6 py-2.5 sm:py-3 rounded-full
          border-2 border-emerald-300/80 bg-emerald-500 text-black
          shadow-[0_0_22px_rgba(16,185,129,0.55)]
          hover:bg-emerald-400 hover:shadow-[0_0_34px_rgba(16,185,129,0.85)]
          active:scale-95 transition-all`}
      >
        ⚿ CONNECT AI
      </button>
      {open && <ConnectPanel onClose={() => setOpen(false)} />}
    </>
  )
}
