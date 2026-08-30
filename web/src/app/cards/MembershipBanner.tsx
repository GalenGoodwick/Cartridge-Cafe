'use client'

// LIVE EDITING banner — the storefront for the EDITING MEMBERSHIP (Galen,
// Aug 26: ONE tier, $10/mo, platform-wide — no dockstars, no premium): pay
// monthly to build on open building worlds. Play is always free. Shows member
// state; a non-member gets the subscribe CTA (→ Stripe subscription), a member
// gets a quiet ✓. The ?paid=editor return polls until the webhook activates.

import { useCallback, useEffect, useRef, useState } from 'react'

type Mem = { member: boolean; usd: number; buyable: boolean; signedIn: boolean }

export function MembershipBanner() {
  const [m, setM] = useState<Mem | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const paidReturn = useRef(false)

  const refresh = useCallback(() => {
    fetch('/api/membership').then(r => r.json())
      .then(setM).catch(() => setM({ member: false, usd: 10, buyable: false, signedIn: false }))
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
      const r = await fetch('/api/membership', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
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
        <p className="font-mono text-[12.5px] tracking-[0.04em] text-cyan-100/85 min-w-0">
          ✓ EDITING MEMBER — build on any open building world (play is free) · your lineage is kept forever.
        </p>
      ) : (
        <>
          <p className="font-mono text-[12.5px] leading-relaxed text-cyan-100/70 min-w-0">
            play any game <span className="text-cyan-200">free</span> — the editing membership lets you build on open building worlds and co-program them. cancel anytime · your lineage stays forever.
          </p>
          {note && <span className="font-mono text-[12px] text-cyan-200/80">{note}</span>}
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <button onClick={subscribe} disabled={busy || !m.buyable}
              className="shrink-0 font-mono text-[13px] tracking-[0.12em] px-3.5 py-1.5 rounded border transition-colors disabled:opacity-40 border-cyan-300/50 text-cyan-100 hover:bg-cyan-400/15"
              title="build on open building worlds">
              {busy ? '…' : `${m.signedIn ? 'EDIT LIVE' : 'JOIN'} · $${m.usd}/mo`}
            </button>
          </div>
          {!m.buyable && <span className="font-mono text-[11px] text-white/40 w-full text-right">subscriptions open soon</span>}
        </>
      )}
    </div>
  )
}
