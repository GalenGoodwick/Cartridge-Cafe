'use client'

// LIVE EDITING banner (Galen, Aug 24) — the storefront for the EDITING
// MEMBERSHIP ($10/mo, platform-wide): pay monthly to dock into any live game
// and edit it. Sits atop the LIVE EDITING tab. Shows member state; a non-member
// gets the subscribe CTA (→ Stripe subscription), a member gets a quiet ✓.
// The ?paid=editor return polls until the webhook activates the seat.

import { useCallback, useEffect, useRef, useState } from 'react'

export function MembershipBanner() {
  const [m, setM] = useState<{ member: boolean; priceUsd: number; buyable: boolean; signedIn: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const paidReturn = useRef(false)

  const refresh = useCallback(() => {
    fetch('/api/membership').then(r => r.json())
      .then(setM).catch(() => setM({ member: false, priceUsd: 10, buyable: false, signedIn: false }))
  }, [])
  useEffect(() => { refresh() }, [refresh])

  // checkout return: the subscription may activate a beat after redirect — poll
  useEffect(() => {
    const u = new URL(window.location.href)
    if (u.searchParams.get('paid') !== 'editor') return
    paidReturn.current = true
    setNote('payment received — activating your seat…')
    u.searchParams.delete('paid')
    window.history.replaceState(null, '', u.toString())
  }, [])
  useEffect(() => {
    if (!paidReturn.current || !m || m.member) return
    const t = setInterval(refresh, 2000)
    return () => clearInterval(t)
  }, [m, refresh])

  const subscribe = useCallback(async () => {
    if (busy) return
    setBusy(true); setNote(null)
    try {
      const r = await fetch('/api/membership', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      const d = await r.json().catch(() => ({}))
      if (r.status === 401) { window.location.href = `/auth/signin?callbackUrl=${encodeURIComponent('/cards?tab=live')}`; return }
      if (d.url) { window.location.href = d.url; return }
      setNote(d.error || 'could not start the subscription — try again')
    } finally { setBusy(false) }
  }, [busy])

  if (!m) return null

  return (
    <div className="mb-3 rounded-lg border border-cyan-300/25 bg-cyan-400/[0.04] px-3.5 py-2.5 flex items-center gap-3 flex-wrap">
      <span className="w-2 h-2 rounded-full bg-cyan-300 animate-pulse shrink-0" />
      {m.member ? (
        <p className="font-mono text-[11.5px] tracking-[0.06em] text-cyan-100/85">
          ✓ EDITING MEMBER — dock into any live game and build it. your lineage is kept forever.
        </p>
      ) : (
        <>
          <p className="font-mono text-[11.5px] leading-relaxed text-cyan-100/70 min-w-0">
            these games are being built <span className="text-cyan-200">live</span> — an editing membership lets you dock in and co-program them. ${m.priceUsd}/mo · cancel anytime · your contributions stay forever.
          </p>
          {note && <span className="font-mono text-[11px] text-cyan-200/80">{note}</span>}
          <button onClick={subscribe} disabled={busy || !m.buyable}
            className="ml-auto shrink-0 font-mono text-[12px] tracking-[0.12em] px-3.5 py-1.5 rounded border border-cyan-300/50 text-cyan-100 hover:bg-cyan-400/15 disabled:opacity-40 transition-colors"
            title="pay monthly to edit live games">
            {busy ? '…' : m.signedIn ? `EDIT LIVE · $${m.priceUsd}/mo` : `SIGN IN & JOIN · $${m.priceUsd}/mo`}
          </button>
          {!m.buyable && <span className="font-mono text-[10px] text-white/30">subscriptions open soon</span>}
        </>
      )}
    </div>
  )
}
