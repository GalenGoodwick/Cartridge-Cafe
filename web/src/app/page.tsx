'use client'

import { useEffect, useRef, useState } from 'react'

const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME || 'cartridge.cafe'

interface WorldCard {
  id: string
  slug: string
  name: string
  description: string | null
  owner?: { name: string | null }
  _count?: { versions: number; forks: number }
}

/** The house cartridges — worlds shipped as single text files, always on the menu. */
const HOUSE_MENU = [
  { name: 'FABRIC', blurb: 'drag a gravity lens across a nebula — real Einstein rings', tag: 'today’s special' },
  { name: 'ORRERY', blurb: 'compose a solar system, hand it to gravity, count the years', tag: 'game' },
  { name: 'GARNET', blurb: 'weld a starship from crystal cells; fly your mistakes', tag: 'game' },
  { name: 'ONE DAY', blurb: 'a lighthouse sea living through dawn, noon, stars and beam', tag: 'vista' },
  { name: 'SAIL', blurb: 'one boat and the water, coupled both ways', tag: 'vista' },
  { name: 'SOLSTICE', blurb: 'you are the sun; the valley grows where you linger', tag: 'game' },
  { name: 'TIDERUNNER', blurb: 'true sailing physics — you cannot sail into the wind', tag: 'game' },
]

/** A quiet star-and-lens canvas — the window seat. */
function WindowSeat() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const W = (cv.width = cv.offsetWidth * 2)
    const H = (cv.height = cv.offsetHeight * 2)
    const stars = Array.from({ length: 140 }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 1.6 + 0.4, p: Math.random() * Math.PI * 2,
    }))
    let raf = 0
    let mx = W * 0.5, my = H * 0.5
    const onMove = (e: PointerEvent) => {
      const b = cv.getBoundingClientRect()
      mx = ((e.clientX - b.left) / b.width) * W
      my = ((e.clientY - b.top) / b.height) * H
    }
    cv.addEventListener('pointermove', onMove)
    const draw = (t: number) => {
      ctx.fillStyle = '#0a0a10'
      ctx.fillRect(0, 0, W, H)
      for (const s of stars) {
        // a soft lens rides the cursor — stars slide away from it, cheaply
        const dx = s.x - mx, dy = s.y - my
        const d2 = dx * dx + dy * dy + 4000
        const k = 26000 / d2
        const x = s.x + dx * k, y = s.y + dy * k
        const tw = 0.5 + 0.5 * Math.sin(t / 900 + s.p)
        ctx.fillStyle = `rgba(235, 220, 190, ${0.25 + 0.55 * tw})`
        ctx.beginPath()
        ctx.arc(x, y, s.r * (1 + k * 2), 0, Math.PI * 2)
        ctx.fill()
      }
      // the lens ring
      ctx.strokeStyle = 'rgba(240, 180, 90, 0.35)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(mx, my, 46, 0, Math.PI * 2)
      ctx.stroke()
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); cv.removeEventListener('pointermove', onMove) }
  }, [])
  return <canvas ref={ref} className="w-full h-56 sm:h-72 rounded-xl border border-amber-100/10 cursor-crosshair" />
}

export default function CafePage() {
  const [worlds, setWorlds] = useState<WorldCard[]>([])
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    fetch('/api/spaces/browse').then(r => r.ok ? r.json() : null)
      .then(d => d && setWorlds(d.spaces || [])).catch(() => {})
    fetch('/api/spaces').then(r => setSignedIn(r.ok)).catch(() => {})
  }, [])

  return (
    <div className="min-h-screen bg-[#0c0a09] text-[#e7dcc8] font-mono">
      <div className="mx-auto max-w-3xl px-5 py-12">

        {/* sign over the door */}
        <header className="text-center mb-10">
          <div className="text-[11px] tracking-[0.5em] text-amber-200/40 uppercase">est. 2026 · open all night</div>
          <h1 className="font-serif text-5xl sm:text-6xl mt-3 text-amber-50">
            {BRAND}
          </h1>
          <p className="mt-4 text-sm text-[#c9b896]">
            little worlds, served as single files. brewed by people and their AIs.
            <br />visit any table. remix any recipe. leave yours on the shelf.
          </p>
        </header>

        {/* the window seat */}
        <WindowSeat />
        <div className="text-center text-[11px] text-amber-200/30 mt-2 mb-12">
          the window seat — your cursor is a gravity lens. the real one is inside.
        </div>

        {/* menu board */}
        <section className="mb-12">
          <div className="flex items-baseline justify-between border-b border-amber-100/15 pb-2 mb-4">
            <h2 className="text-amber-100/90 tracking-widest text-sm">HOUSE CARTRIDGES</h2>
            <a href="/engine" className="text-[11px] text-amber-300/70 hover:text-amber-200 transition-colors">
              take a seat →
            </a>
          </div>
          <ul className="space-y-2.5">
            {HOUSE_MENU.map(item => (
              <li key={item.name} className="group">
                <a href="/engine" className="flex items-baseline gap-2 hover:bg-amber-100/[0.04] rounded px-2 py-1 -mx-2 transition-colors">
                  <span className="text-amber-50 font-semibold text-sm shrink-0">{item.name}</span>
                  <span className="flex-1 border-b border-dotted border-amber-100/15 translate-y-[-3px]" />
                  <span className="text-xs text-[#b3a284] text-right">{item.blurb}</span>
                  <span className="text-[10px] text-amber-400/60 shrink-0 w-20 text-right">{item.tag}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        {/* the shelf — worlds people left */}
        <section className="mb-12">
          <div className="flex items-baseline justify-between border-b border-amber-100/15 pb-2 mb-4">
            <h2 className="text-amber-100/90 tracking-widest text-sm">THE SHELF</h2>
            <a href="/worlds" className="text-[11px] text-amber-300/70 hover:text-amber-200 transition-colors">
              browse all →
            </a>
          </div>
          {worlds.length === 0 ? (
            <div className="text-xs text-[#8a7c66] py-4 text-center border border-dashed border-amber-100/10 rounded-lg">
              the shelf is waiting for its first world. it could be yours.
            </div>
          ) : (
            <ul className="space-y-2.5">
              {worlds.slice(0, 6).map(w => (
                <li key={w.id}>
                  <a href={`/space/${w.slug}`} className="flex items-baseline gap-2 hover:bg-amber-100/[0.04] rounded px-2 py-1 -mx-2 transition-colors">
                    <span className="text-amber-50 text-sm shrink-0">{w.name}</span>
                    <span className="flex-1 border-b border-dotted border-amber-100/15 translate-y-[-3px]" />
                    <span className="text-xs text-[#b3a284]">{w.owner?.name || 'anonymous'}</span>
                    {w._count && (
                      <span className="text-[10px] text-amber-400/60 shrink-0 w-24 text-right">
                        {w._count.versions} saves · {w._count.forks} remixes
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* the counter */}
        <section className="text-center py-6 border-t border-amber-100/10">
          <a
            href={signedIn ? '/worlds' : '/auth/signin'}
            className="inline-block rounded-lg bg-amber-400/90 hover:bg-amber-300 text-[#1a1206] font-semibold text-sm px-6 py-3 transition-colors"
          >
            brew your own world
          </a>
          <div className="text-[11px] text-[#8a7c66] mt-3">
            describe it to your AI, or build it by hand. either way it&apos;s one file, and it&apos;s yours.
          </div>
        </section>

        <footer className="text-center text-[10px] text-amber-100/20 mt-10 tracking-widest">
          POWERED BY THE FIELD ENGINE · A UNITY CHANT KITCHEN
        </footer>
      </div>
    </div>
  )
}
