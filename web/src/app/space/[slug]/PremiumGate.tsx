'use client'

// PREMIUM GATE (Galen, Aug 24: "Tideglass gets 1 minute playtime as demo.
// Tideglass ACT 1 is premium for $5"). Mounted on every /space page; renders
// NOTHING unless the world declares worldData.premium and the viewer doesn't
// own it. Then: a quiet DEMO countdown chip while the free minute runs, and
// when it's spent, the paywall — world paused underneath (cafe:pause), buy
// through Stripe, land back here (?paid=premium5) and the gate polls the
// entitlement open. Demo time is playtime (hidden tabs don't burn it) and
// persists per-world in localStorage — a refresh doesn't reset the meter.
// The owner never sees any of this.

import { useCallback, useEffect, useRef, useState } from 'react'

type Status = {
  premium: { usd: number; demoSeconds: number } | null
  owned: boolean
  signedIn?: boolean
  buyable?: boolean
}

const usedKey = (slug: string) => `cc-demo-${slug}`

export default function PremiumGate({ slug, name }: { slug: string; name: string }) {
  const [st, setSt] = useState<Status | null>(null)
  const [left, setLeft] = useState<number | null>(null)
  const [walled, setWalled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const paidReturn = useRef(false)

  const refresh = useCallback(() => {
    fetch(`/api/premium?slug=${encodeURIComponent(slug)}`).then(r => r.json())
      .then((d: Status) => setSt(d)).catch(() => {})
  }, [slug])
  useEffect(() => { refresh() }, [refresh])

  // the checkout return: hold the wall up (world stays paused) until the
  // webhook's entitlement lands, then let the world go
  useEffect(() => {
    const u = new URL(window.location.href)
    if (u.searchParams.get('paid') !== 'premium5') return
    paidReturn.current = true
    setNote('payment received — unlocking…')
    u.searchParams.delete('paid')
    window.history.replaceState(null, '', u.toString())
  }, [])
  useEffect(() => {
    if (!paidReturn.current || !st || st.owned) return
    const t = setInterval(refresh, 2000)
    return () => clearInterval(t)
  }, [st, refresh])

  // the demo meter: burn visible playtime; at zero, the wall drops
  useEffect(() => {
    if (!st?.premium || st.owned) { setLeft(null); return }
    const total = st.premium.demoSeconds
    let used = 0
    try { used = Number(localStorage.getItem(usedKey(slug))) || 0 } catch { /* private mode */ }
    if (used >= total) { setWalled(true); setLeft(0); return }
    setLeft(Math.ceil(total - used))
    const t = setInterval(() => {
      if (document.visibilityState === 'hidden') return   // hidden tabs don't burn demo
      used += 1
      try { localStorage.setItem(usedKey(slug), String(used)) } catch { /* ignore */ }
      const remain = Math.ceil(total - used)
      setLeft(Math.max(0, remain))
      if (remain <= 0) { setWalled(true); clearInterval(t) }
    }, 1000)
    return () => clearInterval(t)
  }, [st, slug])

  // the wall pauses the world underneath (the exit gate's own mechanic)
  useEffect(() => {
    if (!st?.premium || st.owned) return
    window.dispatchEvent(new CustomEvent('cafe:pause', { detail: walled }))
    return () => { window.dispatchEvent(new CustomEvent('cafe:pause', { detail: false })) }
  }, [walled, st])

  const buy = useCallback(async () => {
    if (busy) return
    setBusy(true); setNote(null)
    try {
      const r = await fetch('/api/pay/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: 'premium5', slug }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.status === 401) { window.location.href = `/auth/signin?callbackUrl=${encodeURIComponent(`/space/${slug}`)}`; return }
      if (d.url) { window.location.href = d.url; return }
      setNote(d.error || 'checkout failed — try again')
    } finally { setBusy(false) }
  }, [busy, slug])

  if (!st?.premium || st.owned) return null

  return (
    <>
      {/* the demo meter — quiet, top center, out of the caption's corner */}
      {!walled && left !== null && (
        <div className="fixed top-[86px] left-1/2 -translate-x-1/2 z-[62] pointer-events-none select-none font-mono text-[12px] tracking-[0.25em] px-3 py-1.5 rounded-full bg-black/60 border border-amber-300/30 text-amber-200/90">
          DEMO · {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
        </div>
      )}
      {/* the paywall — same dialog language as the exit gate */}
      {walled && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/70 backdrop-blur-[3px]">
          <div className="max-w-sm w-[92%] border border-[#b97a2a]/40 rounded-xl px-8 py-6 text-center bg-black/95 shadow-[0_0_60px_rgba(245,176,76,0.15)]">
            <div className="cafe-sign text-2xl mb-1">{name}</div>
            <div className="font-mono text-[13px] tracking-[0.2em] text-white/50 uppercase mb-1">your demo minute is spent</div>
            <div className="font-mono text-[14px] text-amber-200/90 mb-5">${st.premium.usd} · pay once, yours forever</div>
            {note && <p className="font-mono text-[12px] text-amber-200/80 mb-3">{note}</p>}
            <div className="flex gap-3 justify-center">
              <button onClick={buy} disabled={busy || !st.buyable}
                className="rounded-lg bg-amber-500/90 hover:bg-amber-400 px-5 py-2 font-mono text-[15px] tracking-[0.15em] text-black transition-colors disabled:opacity-40">
                {busy ? '…' : st.signedIn ? `BUY · $${st.premium.usd}` : `SIGN IN & BUY · $${st.premium.usd}`}
              </button>
              <button onClick={() => { window.location.href = '/' }}
                className="rounded-lg border border-white/25 hover:bg-white/10 px-5 py-2 font-mono text-[15px] tracking-[0.15em] text-white/80 transition-colors">
                LEAVE
              </button>
            </div>
            {!st.buyable && <p className="mt-3 font-mono text-[11px] text-white/35">purchases open soon</p>}
          </div>
        </div>
      )}
    </>
  )
}
