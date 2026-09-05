'use client'

// THE GENERATE FLOW (Galen, Aug 27): making a world asks THREE questions, each
// a facet of the unified WorldDoc set at birth through the ONE pipeline:
//   1 · BASE       blank, or fork any forkable world (fork-from-here moves OUT
//                  of the in-game dock INTO creation; lineage recorded)
//   2 · DIMENSIONS the targets facet — DESKTOP is the honest default (most
//                  worlds are desktop-authored; phones get the door notice).
//                  UNIVERSAL is a CLAIM — pick it only if the world truly
//                  recomposes (verified on phone AND desktop).
//   3 · PEOPLE     solo | invite-only | open world (open = live member editing)
// TWO ways out: ✦ BIRTH (free — connect your own AI) or ✦ GENERATE ($5 credit —
// the paid path, same three facets, same one pipeline). The main page's
// ✦ GENERATE door lands here; Stripe checkout returns here (?paid=worldgen).
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'

const STASH = 'cc-gen-brief'   // brief survives the checkout round-trip (same key as the old sheet)
const card = 'rounded-xl border px-4 py-3 text-left transition-colors cursor-pointer'
const on = 'border-amber-300/60 bg-amber-400/10 text-[#ffdba8]'
const off = 'border-white/12 bg-black/40 text-white/70 hover:border-white/25 hover:text-white/80'

export default function CreateWorld() {
  const [name, setName] = useState('')
  const [brief, setBrief] = useState('')
  const [base, setBase] = useState('')
  const [targets, setTargets] = useState<'universal' | 'desktop' | 'mobile'>('desktop')
  const [access, setAccess] = useState<'solo' | 'invite' | 'open'>('solo')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [gen, setGen] = useState<{ buyable: boolean; credits: number; priceUsd: number; free: boolean; signedIn: boolean } | null>(null)
  // 3 · THE DEAL (Galen, Sep 5): open source (the cafe deal) vs ◆ proprietary.
  // Proprietary rides the ◆ IP-control membership — choosing it without one
  // opens the $100/mo checkout; an existing $10 editing seat is SWAPPED out by
  // the webhook (IP control includes the seat).
  const [deal, setDeal] = useState<'open' | 'ip'>('open')
  const [ipCtl, setIpCtl] = useState<boolean | null>(null)
  const [ipBusy, setIpBusy] = useState(false)
  useEffect(() => {
    fetch('/api/company/claim', { cache: 'no-store' }).then(r => r.ok ? r.json() : null)
      .then(d => setIpCtl(!!d?.ipControl)).catch(() => setIpCtl(false))
  }, [])
  const buyIp = async () => {
    if (ipBusy) return
    setIpBusy(true)
    try {
      localStorage.setItem(STASH, brief)   // survive the checkout round-trip
      const r = await fetch('/api/pay/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product: 'ip' }) })
      const d = await r.json().catch(() => null)
      if (d?.url) { window.location.assign(d.url); return }
      setNote(d?.error || 'checkout unavailable — sign in first?')
    } catch { setNote('checkout unavailable') }
    finally { setIpBusy(false) }
  }
  const [bases, setBases] = useState<Array<{ slug: string; name: string }>>([])   // THE FORMATS — public base worlds
  const paidReturn = useRef(false)

  const refreshGen = useCallback(() => {
    fetch('/api/generate').then(r => r.json())
      .then((d: { buyable?: boolean; credits?: number; priceUsd?: number; free?: boolean; signedIn?: boolean; bases?: Array<{ slug: string; name: string }> }) => {
        setGen({ buyable: !!d.buyable, credits: d.credits ?? 0, priceUsd: d.priceUsd ?? 5, free: !!d.free, signedIn: !!d.signedIn })
        if (Array.isArray(d.bases)) setBases(d.bases)
      })
      .catch(() => setGen({ buyable: false, credits: 0, priceUsd: 5, free: false, signedIn: false }))
  }, [])
  useEffect(() => { refreshGen() }, [refreshGen])

  // arrivals: ?base=<slug> (the shelf's fork door) · ?paid=worldgen (checkout
  // return — restore the stashed brief, poll for the webhook's credits)
  useEffect(() => {
    try {
      const u = new URL(window.location.href)
      const b = u.searchParams.get('base'); if (b) setBase(b)
      if (u.searchParams.get('paid') === 'worldgen') {
        paidReturn.current = true
        const stashed = localStorage.getItem(STASH); if (stashed) setBrief(stashed)
        setNote('payment received — your credit is landing…')
        u.searchParams.delete('paid'); window.history.replaceState(null, '', u.toString())
      }
    } catch { /* ssr */ }
  }, [])
  useEffect(() => {
    if (!paidReturn.current) return
    if (gen && (gen.credits > 0 || gen.free)) { setNote(`✓ ${gen.free ? 'keeper — generation is free' : `${gen.credits} generation${gen.credits === 1 ? '' : 's'} ready`}`); return }
    const t = setInterval(refreshGen, 2000)
    return () => clearInterval(t)
  }, [gen, refreshGen])

  const facets = () => ({
    targets: targets === 'universal' ? undefined : targets,
    access: access === 'solo' ? undefined : access,
  })

  // ONE CREATION, ONE PRICE (Galen, Aug 27: "birth and generate are the same
  // process — $5 per world created, to prevent clutter/attacks"). No free side
  // door: every world costs a generation credit (the keeper demos free).
  // EMBEDDED IN THE GRID: the frame mirrors the world's declared shape live,
  // and a birth is the PARENT's navigation (the iframe must never nest a grid).
  const embedded = typeof window !== 'undefined' && window.self !== window.top
  useEffect(() => {
    if (!embedded) return
    try { window.parent.postMessage({ cc: 'create-facets', targets }, window.location.origin) } catch { /* fine */ }
  }, [embedded, targets])

  const generate = async () => {
    if (busy) return
    setBusy(true); setErr(''); setNote('')
    try {
      const r = await fetch('/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: brief.trim(), name: name.trim() || undefined, ...facets() }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.status === 402 && d.needPayment) {
        if (!d.buyable) { setNote('payments aren’t switched on yet — BIRTH it and connect your AI instead'); return }
        localStorage.setItem(STASH, brief)
        const c = await fetch('/api/generate/buy', { method: 'POST', headers: { 'Content-Type': 'application/json' } }).then(x => x.json()).catch(() => ({}))
        if (c.url) { window.location.href = c.url; return }
        setNote(c.error || 'checkout failed — try again')
        return
      }
      if (!r.ok) { setErr(d.error || 'generation failed'); return }
      localStorage.removeItem(STASH)
      if (embedded) { try { window.parent.postMessage({ cc: 'create-born', slug: d.slug }, window.location.origin) } catch { /* fine */ }; return }
      window.location.href = `/space/${d.slug}?connect=1`
    } finally { setBusy(false) }
  }

  const briefOk = brief.trim().length >= 20
  const genLabel = !gen ? '…' : gen.free ? '✦ CREATE THE WORLD (keeper — free)' : gen.credits > 0 ? `✦ CREATE THE WORLD · ${gen.credits} ready` : `✦ CREATE THE WORLD · $${gen.priceUsd}`
  return (
    <div className="min-h-screen px-4 py-8 font-mono" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #0c0b14, #050509)', color: '#e7dcc8' }}>
      <div className="max-w-[560px] mx-auto">
        <div className="flex items-baseline gap-3 mb-1">
          <Link href="/" className="text-white/50 hover:text-white text-[14px]">◂</Link>
          <h1 className="text-[22px] tracking-[0.2em] text-[#ffdba8]">NEW WORLD</h1>
        </div>
        <p className="text-white/50 text-[14px] mb-6">three questions — then your AI builds it, or a generation credit does.</p>

        <input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="name your world…"
          className="w-full mb-2 px-3 py-2.5 rounded-xl bg-black/50 border border-white/15 text-[16px] text-white/90 placeholder:text-white/35 outline-none focus:border-amber-300/50" />
        <textarea value={brief} onChange={e => setBrief(e.target.value)} maxLength={2000} rows={2}
          placeholder="what should it become? (your AI reads this first — 20+ chars to GENERATE)"
          className="w-full mb-5 px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-[14px] text-white/85 placeholder:text-white/35 outline-none focus:border-amber-300/50 resize-none" />

        {/* (1 · BASE removed — Galen, Aug 29: "from a format has no functionality
            and would basically be forking anyways." Forking lives in the grid's
            ✧ CREATE set; brew here is always FROM NOTHING.) */}
        <div className="text-[13px] tracking-[0.25em] text-white/55 mb-2">1 · DIMENSIONS</div>
        <div className="grid grid-cols-3 gap-2 mb-2">
          {([['desktop', '🖥 DESKTOP', 'wide screen + mouse; phones get an honest door notice'], ['mobile', '▯ MOBILE', 'portrait phone; desktop shows it in a phone frame'], ['universal', '◇ UNIVERSAL', 'recomposes to ANY screen — a claim, not a default']] as const).map(([k, t, d]) => (
            <button key={k} className={`${card} ${targets === k ? on : off}`} onClick={() => setTargets(k)}>
              <div className="text-[14px] mb-0.5">{t}</div>
              <div className="text-[12px] opacity-70 leading-snug">{d}</div>
            </button>
          ))}
        </div>
        <p className="text-[12px] text-white/40 mb-5">{targets === 'universal'
          ? '⚠ universal means NO warnings on any device — declare it only once the world is verified on phone AND desktop.'
          : 'honest defaults protect players: the declaration drives the catalog badge + the door notice.'}</p>

        <div className="text-[13px] tracking-[0.25em] text-white/55 mb-2">2 · PEOPLE</div>
        <div className="grid grid-cols-3 gap-2 mb-6">
          {([['solo', '● SOLO', 'you and your AI only'], ['invite', '◐ INVITE-ONLY', 'people you invite may build'], ['open', '○ OPEN WORLD', 'any member may build here (live editing) — co-built work becomes protected']] as const).map(([k, t, d]) => (
            <button key={k} className={`${card} ${access === k ? on : off}`} onClick={() => setAccess(k)}>
              <div className="text-[14px] mb-0.5">{t}</div>
              <div className="text-[12px] opacity-70 leading-snug">{d}</div>
            </button>
          ))}
        </div>

        <div className="text-[13px] tracking-[0.25em] text-white/55 mb-2">3 · THE DEAL</div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <button className={`${card} ${deal === 'open' ? on : off}`} onClick={() => setDeal('open')}>
            <div className="text-[14px] mb-0.5">⚘ OPEN SOURCE</div>
            <div className="text-[12px] opacity-70 leading-snug">the cafe deal — source readable + forkable within the cafe; lineage carries your credit</div>
          </button>
          <button className={`${card} ${deal === 'ip' ? on : off}`} onClick={() => setDeal('ip')}>
            <div className="text-[14px] mb-0.5">◆ PROPRIETARY</div>
            <div className="text-[12px] opacity-70 leading-snug">closed source · born private · shielded for life — rides ◆ IP control</div>
          </button>
        </div>
        {deal === 'ip' ? (
          <div className="mb-5">
            {ipCtl ? (
              <p className="text-[12px] text-amber-200/80">◆ IP control active — this world is born private and shielded for life.</p>
            ) : (
              <div>
                <button onClick={() => void buyIp()} disabled={ipBusy || ipCtl === null}
                  className="w-full px-4 py-2.5 rounded-xl border border-amber-300/50 bg-amber-400/15 text-amber-100 text-[13px] tracking-[0.18em] hover:bg-amber-400/25 disabled:opacity-40 transition-colors">
                  {ipBusy ? 'OPENING…' : '◆ GET IP CONTROL — $100/MO'}
                </button>
                <p className="text-[12px] text-white/40 mt-1.5">already an editing member? the $10 seat is swapped out automatically — IP control includes it.</p>
              </div>
            )}
          </div>
        ) : <div className="mb-4" />}

        {err && <p className="text-red-400 text-[14px] mb-3">{err}</p>}
        {note && <p className="text-amber-200/80 text-[14px] mb-3">{note}</p>}
        <button disabled={!briefOk || busy || !gen || (!gen.buyable && gen.credits === 0 && !gen.free)} onClick={generate}
          className="w-full px-4 py-3 rounded-xl border border-amber-300/50 bg-amber-400/10 text-amber-200 text-[15px] tracking-[0.2em] hover:bg-amber-400/20 disabled:opacity-35 transition-colors"
          title="one price per world — born with your facets + its first AI build key; connect your AI to build">
          {busy ? '…' : genLabel}
        </button>
        <p className="text-[12px] text-white/40 mt-2 text-center">${gen?.priceUsd ?? 5} per world keeps the shelf real. born with these facets + its first AI build key — no house AI, your AI builds it.</p>
      </div>
    </div>
  )
}
