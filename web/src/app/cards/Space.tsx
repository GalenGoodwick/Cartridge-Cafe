'use client'

// cards-space — the VOID (MAP.cards: cards-space). The catalog is not a page,
// it is a place: ember motes drift up through depth fog behind the grid, and
// the cards hang in the space (slow individual bob; the hovered card tilts
// toward the cursor). One background canvas + CSS transforms — no per-card
// WebGL, and prefers-reduced-motion stills everything.

import { useEffect, useRef } from 'react'

type Mote = { x: number; y: number; z: number; r: number; vy: number; vx: number; tw: number }

export function CatalogSpace({ children }: { children: React.ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    let w = 0, h = 0, raf = 0
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const size = () => {
      w = window.innerWidth; h = window.innerHeight
      cv.width = w * dpr; cv.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    size()
    window.addEventListener('resize', size)

    // three depth layers of embers — far ones small/slow/dim, near ones warm
    const motes: Mote[] = Array.from({ length: 90 }, (_, i) => {
      const z = i < 45 ? 0.35 : i < 75 ? 0.65 : 1
      return {
        x: Math.random() * 2000, y: Math.random() * 1400, z,
        r: 0.6 + z * 1.6, vy: (6 + z * 14), vx: (Math.random() - 0.5) * 4 * z,
        tw: Math.random() * Math.PI * 2,
      }
    })
    let scrollY = 0
    const onScroll = () => { scrollY = window.scrollY }
    window.addEventListener('scroll', onScroll, { passive: true })

    let last = performance.now()
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now
      ctx.clearRect(0, 0, w, h)
      for (const m of motes) {
        m.y -= m.vy * dt; m.x += m.vx * dt; m.tw += dt * 2
        if (m.y < -10) { m.y = h + 10 + Math.random() * 40; m.x = Math.random() * w }
        const px = ((m.x % (w + 40)) + (w + 40)) % (w + 40) - 20
        const py = m.y - scrollY * (m.z * 0.25)          // depth parallax vs scroll
        const yy = ((py % (h + 40)) + (h + 40)) % (h + 40) - 20
        const a = (0.10 + 0.22 * m.z) * (0.7 + 0.3 * Math.sin(m.tw))
        ctx.beginPath()
        ctx.arc(px, yy, m.r, 0, Math.PI * 2)
        ctx.fillStyle = `hsla(${26 + m.z * 10}, 90%, ${55 + m.z * 10}%, ${a})`
        ctx.fill()
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', size); window.removeEventListener('scroll', onScroll) }
  }, [])

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
    <div className="relative min-h-screen"
      style={{ background: 'radial-gradient(1100px 500px at 70% -10%, rgba(255,138,61,0.08), transparent 60%), radial-gradient(900px 600px at 10% 110%, rgba(120,60,20,0.06), transparent 55%), #0a0705' }}>
      <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none" aria-hidden />
      {/* depth fog over the void, under the cards */}
      <div className="fixed inset-0 pointer-events-none" aria-hidden
        style={{ background: 'linear-gradient(180deg, rgba(10,7,5,0) 55%, rgba(10,7,5,0.55) 100%)' }} />
      <div className="relative">{children}</div>
    </div>
  )
}
