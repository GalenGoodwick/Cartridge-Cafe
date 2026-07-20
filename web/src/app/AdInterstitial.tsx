'use client'
import { useEffect, useRef, useState } from 'react'

type Ad = { id: string; title: string; body: string; emoji: string; advertiser: string }

const track = (adId: string, event: 'impression' | 'interaction') =>
  fetch('/api/engine/ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adId, event }) }).catch(() => {})

/** The contained ad unit shown at world-start. No external links — the ad earns
 *  an impression on show and an interaction if the viewer engages; everything
 *  stays in the cafe. A short countdown gates CONTINUE so the ad isn't a blink. */
export default function AdInterstitial({ ad, onClose }: { ad: Ad; onClose: () => void }) {
  const [left, setLeft] = useState(4)
  const [engaged, setEngaged] = useState(false)
  const logged = useRef(false)

  useEffect(() => {
    if (!logged.current) { logged.current = true; track(ad.id, 'impression') }
    const iv = setInterval(() => setLeft(n => Math.max(0, n - 1)), 1000)
    return () => clearInterval(iv)
  }, [ad.id])

  const interact = () => { if (!engaged) { setEngaged(true); track(ad.id, 'interaction') } }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[440px] max-w-[92vw] rounded-2xl bg-[#171009]/95 border border-[#b97a2a]/30 p-6 font-mono text-white/85 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[14px] tracking-[0.3em] text-white/35">ADVERTISEMENT</span>
          <span className="text-[14px] tracking-[0.2em] text-[#c9b370]">{ad.advertiser.toLowerCase()}</span>
        </div>
        <button onClick={interact} className="block w-full text-left">
          <div className="text-5xl mb-3 text-center">{ad.emoji}</div>
          <div className="text-lg tracking-[0.15em] text-center text-[#e8c98a] mb-3">{ad.title}</div>
          <div className="text-[17px] leading-relaxed text-white/70 text-center" style={engaged ? undefined : { maxHeight: '3.6em', overflow: 'hidden' }}>{ad.body}</div>
        </button>
        <div className="mt-5 flex items-center justify-between gap-3">
          <button onClick={interact} className="text-[14px] tracking-[0.2em] text-[#c9b370]/80 hover:text-[#c9b370]">
            {engaged ? '✓ NOTED' : '◇ TELL ME MORE'}
          </button>
          <button
            onClick={onClose}
            disabled={left > 0}
            className="px-4 py-1.5 rounded-lg text-[14px] tracking-[0.2em] bg-[#b97a2a]/20 border border-[#b97a2a]/40 text-[#e8c98a] disabled:opacity-40 hover:bg-[#b97a2a]/30 transition-colors"
          >
            {left > 0 ? `CONTINUE IN ${left}` : 'CONTINUE ▸'}
          </button>
        </div>
        <div className="mt-3 text-center text-[13px] tracking-[0.25em] text-white/25">
          no links · stays in the cafe · <span className="text-white/45">protect a world to go ad-free</span>
        </div>
      </div>
    </div>
  )
}
