'use client'

// cards-space — the VOID (MAP.cards: cards-space). The catalog is not a page,
// it is a place: ember motes drift up through depth fog behind the grid, and
// the cards hang in the space (slow individual bob; the hovered card tilts
// toward the cursor). One background canvas + CSS transforms — no per-card
// WebGL, and prefers-reduced-motion stills everything.

import { useEffect } from 'react'

export function CatalogSpace({ children }: { children: React.ReactNode }) {
  // the mote canvas RETIRED — the GPU void (GpuGrid pass 1) draws the space

  // the hovered card leans toward the cursor — one delegated listener, only
  // the card under the pointer transforms (cheap at any card count)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let cur: HTMLElement | null = null
    const onMove = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-floatcard]') as HTMLElement | null
      if (cur && cur !== el) { cur.style.transform = ''; cur = null }
      if (!el) return
      cur = el
      const b = el.getBoundingClientRect()
      const rx = ((e.clientY - b.top) / b.height - 0.5) * -5
      const ry = ((e.clientX - b.left) / b.width - 0.5) * 6
      el.style.transform = `perspective(700px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-4px)`
    }
    const onLeave = () => { if (cur) { cur.style.transform = ''; cur = null } }
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerleave', onLeave)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerleave', onLeave) }
  }, [])

  return (
    <div className="relative min-h-screen">
      {/* depth fog over the void, under the cards */}
      <div className="fixed inset-0 z-0 pointer-events-none" aria-hidden
        style={{ background: 'linear-gradient(180deg, rgba(10,7,5,0) 55%, rgba(10,7,5,0.55) 100%)' }} />
      <div className="relative z-10">{children}</div>
    </div>
  )
}
