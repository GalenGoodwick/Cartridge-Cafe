'use client'

// DOCK BUTTON (Galen, Aug 24) — in a LIVE-EDITABLE world (proper node
// foundations), a player can dock into the edit flow. The chain:
//   click → not signed in?      → sign in
//         → no membership?      → offer membership ($10 / $100)
//         → out of dockstars?   → offer upgrade
//         → else                → spend a dockstar, BIND to the world, then
//                                 offer the FLOW-IN prompt (which requests
//                                 Fable for quality) to bring your AI.
// Play/test never touches this — only joining the edit flow does. Owners never
// see it (they already build their own world).

import { useCallback, useEffect, useRef, useState } from 'react'

type Status = {
  dockable: boolean; docked: boolean; isOwner: boolean; member: boolean; signedIn: boolean
  dockstars: { used: number; allowance: number }
  prices: { basicUsd: number; proUsd: number }
}

export default function DockButton({ slug, name }: { slug: string; name: string }) {
  const [st, setSt] = useState<Status | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [flow, setFlow] = useState<string | null>(null)   // the flow-in prompt once bound
  const [copied, setCopied] = useState(false)
  const [needs, setNeeds] = useState<'membership' | 'dockstar' | null>(null)
  const pollRef = useRef(false)

  const refresh = useCallback(() => {
    fetch(`/api/spaces/${encodeURIComponent(slug)}/dock`).then(r => r.json())
      .then((d: Status) => setSt(d)).catch(() => {})
  }, [slug])
  useEffect(() => { refresh() }, [refresh])

  // returning from a membership checkout (?paid=editor) — poll until active, then
  // the dock can proceed
  useEffect(() => {
    const u = new URL(window.location.href)
    if (u.searchParams.get('paid') !== 'editor') return
    pollRef.current = true
    setOpen(true); setNote('membership active — dock in to bind this world')
    u.searchParams.delete('paid'); window.history.replaceState(null, '', u.toString())
    const t = setInterval(() => { refresh() }, 2000)
    setTimeout(() => clearInterval(t), 30000)
    return () => clearInterval(t)
  }, [refresh])

  const subscribe = useCallback(async (tier: 'basic' | 'pro') => {
    setBusy(true)
    try {
      const r = await fetch('/api/membership', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tier }) })
      const d = await r.json().catch(() => ({}))
      if (r.status === 401) { window.location.href = `/auth/signin?callbackUrl=${encodeURIComponent(`/space/${slug}`)}`; return }
      if (d.url) { window.location.href = d.url; return }
      setNote(d.error || 'could not start the subscription')
    } finally { setBusy(false) }
  }, [slug])

  const dock = useCallback(async () => {
    if (busy) return
    setBusy(true); setNote(null); setNeeds(null)
    try {
      const r = await fetch(`/api/spaces/${encodeURIComponent(slug)}/dock`, { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (r.status === 401) { window.location.href = `/auth/signin?callbackUrl=${encodeURIComponent(`/space/${slug}`)}`; return }
      if (r.status === 402 && d.needMembership) { setNeeds('membership'); return }
      if (r.status === 402 && d.needDockstar) { setNeeds('dockstar'); setNote(`no dockstars left (${d.dockstars?.used}/${d.dockstars?.allowance})`); return }
      if (!r.ok) { setNote(d.error || 'could not dock'); return }
      // bound — offer the flow-in prompt
      setFlow(d.flowPrompt || null)
      refresh()
    } finally { setBusy(false) }
  }, [slug, busy, refresh])

  const copyFlow = useCallback(async () => {
    if (!flow) return
    try { await navigator.clipboard.writeText(flow); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch { /* fine */ }
  }, [flow])

  if (!st || !st.dockable) return null   // owners, non-node worlds, play-only viewers see nothing

  const label = st.docked ? '⚓ DOCKED · FLOW IN' : '⚓ DOCK IN'

  return (
    <>
      <button
        onClick={() => { setOpen(true); if (st.docked) dock() }}
        className="fixed top-4 left-1/2 -translate-x-1/2 z-[62] font-mono text-[12px] tracking-[0.15em] px-3.5 py-1.5 rounded-full border border-cyan-300/50 text-cyan-100 bg-black/70 hover:bg-cyan-400/15 transition-colors"
        title="join this world's live edit flow">
        {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-[86] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-[#0d1214]/97 border border-cyan-300/25 p-5 font-mono" onClick={e => e.stopPropagation()}>
            <div className="text-[13px] tracking-[0.22em] text-cyan-200 mb-1">⚓ DOCK INTO {name.toUpperCase()}</div>

            {/* BOUND → the flow-in prompt */}
            {flow ? (
              <>
                <p className="text-[12px] leading-relaxed text-cyan-100/70 mb-3">
                  you're bound to this world — a co-builder seat is yours. bring your AI in to build alongside everyone else (it requests <span className="text-amber-200">Fable</span> for quality):
                </p>
                <button onClick={copyFlow}
                  className="w-full px-4 py-2.5 rounded-lg border border-amber-300/50 text-amber-100 hover:bg-amber-400/15 text-[13px] tracking-[0.12em]">
                  {copied ? '✓ COPIED — paste into your AI' : '🌊 FLOW IN — copy the prompt'}
                </button>
                <button onClick={() => setOpen(false)} className="w-full mt-2 py-2 text-white/40 hover:text-white/70 text-[12px] text-center">done</button>
              </>
            ) : needs === 'membership' ? (
              <>
                <p className="text-[12px] leading-relaxed text-cyan-100/70 mb-3">
                  playing is free — <span className="text-cyan-200">building is a membership</span>. it gives you dockstars to bind into any live game and co-program it. cancel anytime; your work stays credited forever.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => subscribe('basic')} disabled={busy}
                    className="flex-1 px-3 py-2.5 rounded-lg border border-cyan-300/50 text-cyan-100 hover:bg-cyan-400/15 text-[12.5px] tracking-[0.1em] disabled:opacity-40">
                    JOIN · ${st.prices.basicUsd}/mo · 10
                  </button>
                  <button onClick={() => subscribe('pro')} disabled={busy}
                    className="flex-1 px-3 py-2.5 rounded-lg border border-amber-300/50 text-amber-100 hover:bg-amber-400/15 text-[12.5px] tracking-[0.1em] disabled:opacity-40">
                    PREMIUM · ${st.prices.proUsd}/mo · 100
                  </button>
                </div>
              </>
            ) : needs === 'dockstar' ? (
              <>
                <p className="text-[12px] leading-relaxed text-cyan-100/70 mb-3">
                  {note || 'no dockstars left'} — every world you build occupies one. undock a world, or upgrade to premium for 100.
                </p>
                <button onClick={() => subscribe('pro')} disabled={busy}
                  className="w-full px-4 py-2.5 rounded-lg border border-amber-300/50 text-amber-100 hover:bg-amber-400/15 text-[13px] tracking-[0.12em]">
                  UPGRADE TO PREMIUM · ${st.prices.proUsd}/mo · 100 worlds
                </button>
              </>
            ) : (
              <>
                <p className="text-[12px] leading-relaxed text-cyan-100/70 mb-1">
                  this game has real node foundations — you can dock in and co-build it live.
                  {st.member
                    ? <> spending <span className="text-cyan-200">one dockstar</span> ({st.dockstars.used}/{st.dockstars.allowance} used) binds you to it.</>
                    : <> building is a membership; playing stays free.</>}
                </p>
                {note && <p className="text-[11px] text-amber-200/80 my-2">{note}</p>}
                <button onClick={dock} disabled={busy}
                  className="w-full mt-3 px-4 py-2.5 rounded-lg border border-cyan-300/60 text-cyan-100 hover:bg-cyan-400/15 text-[13px] tracking-[0.14em] disabled:opacity-40">
                  {busy ? '…' : st.member ? '⚓ SPEND A DOCKSTAR · BIND ME IN' : '⚓ DOCK IN'}
                </button>
                <button onClick={() => setOpen(false)} className="w-full mt-2 py-2 text-white/40 hover:text-white/70 text-[12px] text-center">not now</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
