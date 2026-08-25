'use client'

// LIVE EDITING banner (Galen, Aug 24) — the storefront for the EDITING
// MEMBERSHIP ($10/mo, platform-wide): pay monthly to dock into any live game
// and edit it. Sits atop the LIVE EDITING tab. Shows member state; a non-member
// gets the subscribe CTA (→ Stripe subscription), a member gets a quiet ✓.
// The ?paid=editor return polls until the webhook activates the seat.

import { useCallback, useEffect, useRef, useState } from 'react'

type Mem = {
  tier: 'pro' | 'basic' | null; member: boolean; dockstars: { used: number; allowance: number }
  basicUsd: number; proUsd: number; buyable: boolean; signedIn: boolean
}

export function MembershipBanner() {
  const [m, setM] = useState<Mem | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const paidReturn = useRef(false)

  const refresh = useCallback(() => {
    fetch('/api/membership').then(r => r.json())
      .then(setM).catch(() => setM({ tier: null, member: false, dockstars: { used: 0, allowance: 3 }, basicUsd: 10, proUsd: 100, buyable: false, signedIn: false }))
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

  const subscribe = useCallback(async (tier: 'basic' | 'pro') => {
    if (busy) return
    setBusy(true); setNote(null)
    try {
      const r = await fetch('/api/membership', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tier }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.status === 401) { window.location.href = `/auth/signin?callbackUrl=${encodeURIComponent('/cards?tab=live')}`; return }
      if (d.url) { window.location.href = d.url; return }
      setNote(d.error || 'could not start the subscription — try again')
    } finally { setBusy(false) }
  }, [busy])

  if (!m) return null

  const btn = 'shrink-0 font-mono text-[12px] tracking-[0.12em] px-3.5 py-1.5 rounded border transition-colors disabled:opacity-40'

  return (
    <div className="mb-3 rounded-lg border border-cyan-300/25 bg-cyan-400/[0.04] px-3.5 py-2.5 flex items-center gap-3 flex-wrap">
      <span className="w-2 h-2 rounded-full bg-cyan-300 animate-pulse shrink-0" />
      {m.tier ? (
        <p className="font-mono text-[11.5px] tracking-[0.04em] text-cyan-100/85 min-w-0">
          ✓ {m.tier === 'pro' ? 'PREMIUM' : 'EDITING'} MEMBER — spend a dockstar to join a game's edit flow (play is free) · ★ {m.dockstars.used}/{m.dockstars.allowance} dockstars in use · your lineage is kept forever.
          {m.tier === 'basic' && (
            <button onClick={() => subscribe('pro')} disabled={busy || !m.buyable}
              className="ml-3 font-mono text-[11px] tracking-[0.1em] text-amber-200/90 hover:text-amber-100 underline underline-offset-2 disabled:opacity-40">
              upgrade to premium · 100 worlds · ${m.proUsd}/mo
            </button>
          )}
        </p>
      ) : (
        <>
          <p className="font-mono text-[11.5px] leading-relaxed text-cyan-100/70 min-w-0">
            play any game <span className="text-cyan-200">free</span> — an editing membership gives you <span className="text-cyan-200">★ dockstars</span> to join a game's edit flow and co-program it. cancel anytime · your lineage stays forever.
          </p>
          {note && <span className="font-mono text-[11px] text-cyan-200/80">{note}</span>}
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <button onClick={() => subscribe('basic')} disabled={busy || !m.buyable}
              className={`${btn} border-cyan-300/50 text-cyan-100 hover:bg-cyan-400/15`}
              title="edit live games + 10 worlds">
              {busy ? '…' : `${m.signedIn ? 'EDIT LIVE' : 'JOIN'} · $${m.basicUsd}/mo · 10 worlds`}
            </button>
            <button onClick={() => subscribe('pro')} disabled={busy || !m.buyable}
              className={`${btn} border-amber-300/50 text-amber-100 hover:bg-amber-400/15`}
              title="edit live games + 100 worlds">
              {busy ? '…' : `PREMIUM · $${m.proUsd}/mo · 100 worlds`}
            </button>
          </div>
          {!m.buyable && <span className="font-mono text-[10px] text-white/30 w-full text-right">subscriptions open soon</span>}
        </>
      )}
    </div>
  )
}
