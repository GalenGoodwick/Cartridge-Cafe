'use client'

// ✦ GENERATE — the masthead door to THE GENERATE FLOW (Galen, Aug 27: "on main
// generate world opens up this UI"). The old in-place brief sheet moved to
// /create, which asks the three creation questions (BASE / DIMENSIONS / PEOPLE)
// and offers both the free BIRTH and the paid GENERATE out of one form. This
// stays a thin door: credits chip + navigation. /story's CTA (?gen=1) lands
// here and forwards. Checkout returns land on /create directly (stripe.ts).
import { useEffect, useState } from 'react'

export function GenerateDoor({ signedIn }: { signedIn: boolean }) {
  const [credits, setCredits] = useState(0)
  const [show, setShow] = useState(false)

  useEffect(() => {
    fetch('/api/generate').then(r => r.json())
      .then((d: { buyable?: boolean; credits?: number; free?: boolean }) => {
        setCredits(d.credits ?? 0)
        setShow(!!d.buyable || (d.credits ?? 0) > 0 || !!d.free)
      })
      .catch(() => setShow(false))
  }, [])

  // /story's CTA lands with ?gen=1 — forward into the flow
  useEffect(() => {
    try {
      const u = new URL(window.location.href)
      if (u.searchParams.get('gen') === '1') window.location.href = '/create'
    } catch { /* ssr */ }
  }, [])

  if (!show) return null
  return (
    <button
      onClick={() => { window.location.href = signedIn ? '/create' : `/auth/signin?callbackUrl=${encodeURIComponent('/create')}` }}
      className="shrink-0 font-mono text-[13px] tracking-[0.15em] px-3 py-1.5 rounded border border-amber-300/40 text-amber-200 hover:bg-amber-400/15 transition-colors"
      title="make a world — three questions, then your AI builds it (or a generation credit does)">
      ✦ GENERATE{credits > 0 ? ` ·${credits}` : ''}
    </button>
  )
}
