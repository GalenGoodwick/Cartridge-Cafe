'use client'

// THE GENERATE DOOR — paid world generation (task #22, Galen's ruling: "enable
// paid tokens to generate world"). The phone's native creation route: no
// connected AI needed — describe a world, spend a credit, the HOUSE AI builds
// the brief while you watch at /space/<slug>.
//
// Flow: ✦ GENERATE → brief sheet → POST /api/generate.
//   402 (broke)  → stash the brief in localStorage, send them through Stripe
//                  checkout; the ?paid=worldgen return re-opens the sheet with
//                  the brief intact and polls until the webhook lands credits.
//   201          → land on the newborn world, build in progress.
// The button renders only when the product is buyable OR credits exist —
// stripe-unconfigured deploys show nothing (the PRODUCTS law).

import { useCallback, useEffect, useRef, useState } from 'react'

const STASH = 'cc-gen-brief'

export function GenerateDoor({ signedIn }: { signedIn: boolean }) {
  const [gen, setGen] = useState<{ buyable: boolean; credits: number; priceUsd: number } | null>(null)
  const [open, setOpen] = useState(false)
  const [brief, setBrief] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const paidReturn = useRef(false)

  const refresh = useCallback(() => {
    fetch('/api/generate').then(r => r.json())
      .then((d: { buyable?: boolean; credits?: number; priceUsd?: number }) => setGen({ buyable: !!d.buyable, credits: d.credits ?? 0, priceUsd: d.priceUsd ?? 5 }))
      .catch(() => setGen({ buyable: false, credits: 0, priceUsd: 5 }))
  }, [])
  useEffect(() => { refresh() }, [refresh])

  // /story's CTA lands here with ?gen=1 — open the sheet ready to type
  useEffect(() => {
    const u = new URL(window.location.href)
    if (u.searchParams.get('gen') !== '1') return
    setOpen(true)
    u.searchParams.delete('gen')
    window.history.replaceState(null, '', u.toString())
  }, [])

  // the checkout return: re-open the sheet with the stashed brief, wait for the
  // webhook's credits (Stripe redirects before the webhook fires — poll, don't fail)
  useEffect(() => {
    const u = new URL(window.location.href)
    if (u.searchParams.get('paid') !== 'worldgen') return
    paidReturn.current = true
    const stashed = localStorage.getItem(STASH)
    if (stashed) setBrief(stashed)
    setOpen(true)
    setNote('payment received — your credits are landing…')
    u.searchParams.delete('paid')
    window.history.replaceState(null, '', u.toString())
  }, [])
  useEffect(() => {
    if (!open || !paidReturn.current) return
    if (gen && gen.credits > 0) { setNote(`✓ ${gen.credits} generation${gen.credits === 1 ? '' : 's'} ready`); return }
    const t = setInterval(refresh, 2000)
    return () => clearInterval(t)
  }, [open, gen, refresh])

  const submit = useCallback(async () => {
    if (busy) return
    setBusy(true); setNote(null)
    try {
      const r = await fetch('/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.status === 402 && d.needPayment) {
        if (!d.buyable) { setNote('payments aren’t switched on yet — ask your AI to build it instead'); return }
        localStorage.setItem(STASH, brief)
        const c = await fetch('/api/generate/buy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
        }).then(x => x.json()).catch(() => ({}))
        if (c.url) { window.location.href = c.url; return }
        setNote(c.error || 'checkout failed — try again')
        return
      }
      if (!r.ok) { setNote(d.error || 'generation failed'); return }
      localStorage.removeItem(STASH)
      window.location.href = `/space/${d.slug}`
    } finally { setBusy(false) }
  }, [brief, busy])

  if (!gen || (!gen.buyable && gen.credits === 0)) return null

  return (
    <>
      <button onClick={() => {
        if (!signedIn) { window.location.href = `/auth/signin?callbackUrl=${encodeURIComponent('/cards')}`; return }
        setOpen(true)
      }}
        className="shrink-0 font-mono text-[12px] tracking-[0.15em] px-3 py-1.5 rounded border border-amber-300/40 text-amber-200 hover:bg-amber-400/15 transition-colors"
        title="describe a world — the house AI builds it for you">
        ✦ GENERATE{gen.credits > 0 ? ` ·${gen.credits}` : ''}
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-[#171009]/95 border border-[#b97a2a]/30 p-5" onClick={e => e.stopPropagation()}>
            <h2 className="font-mono text-[13px] tracking-[0.25em] text-amber-200 mb-1">✦ GENERATE A WORLD</h2>
            <p className="font-mono text-[11px] leading-relaxed text-white/45 mb-3">
              describe it — the house AI builds your brief while you watch.
              {gen.credits > 0
                ? ` you have ${gen.credits} generation${gen.credits === 1 ? '' : 's'}.`
                : ` $${gen.priceUsd} per world.`}
            </p>
            <textarea
              value={brief} onChange={e => setBrief(e.target.value)} rows={4} autoFocus
              placeholder="a tidepool at night — anemones that sing when touched, a crab that hoards the notes…"
              className="w-full bg-black/50 border border-white/15 rounded px-2.5 py-2 font-mono text-[12.5px] text-white/85 placeholder:text-white/25 outline-none focus:border-amber-300/50 resize-none"
            />
            {note && <p className="mt-2 font-mono text-[11px] text-amber-200/80">{note}</p>}
            <div className="mt-3 flex items-center justify-end gap-2 font-mono text-[12px]">
              <button onClick={() => setOpen(false)} className="px-3 py-1.5 rounded text-white/45 hover:text-white transition-colors">not now</button>
              <button onClick={submit} disabled={busy || brief.trim().length < 20}
                className="px-4 py-1.5 rounded border border-amber-300/50 text-amber-200 hover:bg-amber-400/15 disabled:opacity-40 transition-colors">
                {busy ? '…' : gen.credits > 0 ? 'GENERATE' : `GENERATE · $${gen.priceUsd}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
