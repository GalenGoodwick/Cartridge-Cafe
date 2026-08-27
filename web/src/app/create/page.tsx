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
const off = 'border-white/12 bg-black/40 text-white/60 hover:border-white/25 hover:text-white/80'

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
  const paidReturn = useRef(false)

  const refreshGen = useCallback(() => {
    fetch('/api/generate').then(r => r.json())
      .then((d: { buyable?: boolean; credits?: number; priceUsd?: number; free?: boolean; signedIn?: boolean }) =>
        setGen({ buyable: !!d.buyable, credits: d.credits ?? 0, priceUsd: d.priceUsd ?? 5, free: !!d.free, signedIn: !!d.signedIn }))
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
    base: base.trim() || undefined,
    targets: targets === 'universal' ? undefined : targets,
    access: access === 'solo' ? undefined : access,
  })

  // ✦ BIRTH — free; connect your own AI on the world page
  const birth = async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/spaces', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), brief: brief.trim() || undefined, ...facets() }),
      })
      const d = await r.json()
      if (r.ok) { localStorage.removeItem(STASH); window.location.href = `/space/${d.space.slug}?connect=1` }
      else setErr(d.error || 'could not create')
    } finally { setBusy(false) }
  }

  // ✦ GENERATE — the paid path (credit or checkout), same facets
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
      window.location.href = `/space/${d.slug}`
    } finally { setBusy(false) }
  }

  const nameOk = name.trim().length >= 2
  const briefOk = brief.trim().length >= 20
  const genLabel = !gen ? '…' : gen.free ? '✦ GENERATE (keeper — free)' : gen.credits > 0 ? `✦ GENERATE · ${gen.credits} ready` : `✦ GENERATE · $${gen.priceUsd}`
  return (
    <div className="min-h-screen px-4 py-8 font-mono" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #0c0b14, #050509)', color: '#e7dcc8' }}>
      <div className="max-w-[560px] mx-auto">
        <div className="flex items-baseline gap-3 mb-1">
          <Link href="/" className="text-white/40 hover:text-white text-[14px]">◂</Link>
          <h1 className="text-[22px] tracking-[0.2em] text-[#ffdba8]">NEW WORLD</h1>
        </div>
        <p className="text-white/40 text-[13px] mb-6">three questions — then your AI builds it, or a generation credit does.</p>

        <input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="name your world…"
          className="w-full mb-2 px-3 py-2.5 rounded-xl bg-black/50 border border-white/15 text-[16px] text-white/90 placeholder:text-white/25 outline-none focus:border-amber-300/50" />
        <textarea value={brief} onChange={e => setBrief(e.target.value)} maxLength={2000} rows={2}
          placeholder="what should it become? (your AI reads this first — 20+ chars to GENERATE)"
          className="w-full mb-5 px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-[14px] text-white/85 placeholder:text-white/25 outline-none focus:border-amber-300/50 resize-none" />

        <div className="text-[12px] tracking-[0.25em] text-white/45 mb-2">1 · BASE</div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <button className={`${card} ${!base.trim() ? on : off}`} onClick={() => setBase('')}>
            <div className="text-[14px] mb-0.5">✦ BLANK</div>
            <div className="text-[12px] opacity-70">born empty — built from your brief</div>
          </button>
          <div className={`${card} ${base.trim() ? on : off}`}>
            <div className="text-[14px] mb-0.5">⑂ FORK A WORLD</div>
            <input value={base} onChange={e => setBase(e.target.value)} placeholder="world slug, e.g. cinderfell"
              className="w-full bg-transparent border-b border-white/20 text-[13px] text-white/85 placeholder:text-white/25 outline-none focus:border-amber-300/50" />
          </div>
        </div>
        <p className="text-[11px] text-white/30 mb-5">forkable worlds only — you start from its live snapshot, lineage recorded.</p>

        <div className="text-[12px] tracking-[0.25em] text-white/45 mb-2">2 · DIMENSIONS</div>
        <div className="grid grid-cols-3 gap-2 mb-2">
          {([['desktop', '🖥 DESKTOP', 'wide screen + mouse; phones get an honest door notice'], ['mobile', '▯ MOBILE', 'portrait phone; desktop shows it in a phone frame'], ['universal', '◇ UNIVERSAL', 'recomposes to ANY screen — a claim, not a default']] as const).map(([k, t, d]) => (
            <button key={k} className={`${card} ${targets === k ? on : off}`} onClick={() => setTargets(k)}>
              <div className="text-[13px] mb-0.5">{t}</div>
              <div className="text-[11px] opacity-70 leading-snug">{d}</div>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-white/30 mb-5">{targets === 'universal'
          ? '⚠ universal means NO warnings on any device — declare it only once the world is verified on phone AND desktop.'
          : 'honest defaults protect players: the declaration drives the catalog badge + the door notice.'}</p>

        <div className="text-[12px] tracking-[0.25em] text-white/45 mb-2">3 · PEOPLE</div>
        <div className="grid grid-cols-3 gap-2 mb-6">
          {([['solo', '● SOLO', 'you and your AI only'], ['invite', '◐ INVITE-ONLY', 'people you invite may build'], ['open', '○ OPEN WORLD', 'any member may build here (live editing) — co-built work becomes protected']] as const).map(([k, t, d]) => (
            <button key={k} className={`${card} ${access === k ? on : off}`} onClick={() => setAccess(k)}>
              <div className="text-[13px] mb-0.5">{t}</div>
              <div className="text-[11px] opacity-70 leading-snug">{d}</div>
            </button>
          ))}
        </div>

        {err && <p className="text-red-400 text-[13px] mb-3">{err}</p>}
        {note && <p className="text-amber-200/80 text-[13px] mb-3">{note}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button disabled={!nameOk || busy} onClick={birth}
            className="px-4 py-3 rounded-xl border border-emerald-300/50 bg-emerald-400/15 text-emerald-200 text-[14px] tracking-[0.15em] hover:bg-emerald-400/25 disabled:opacity-35 transition-colors"
            title="free — the world is born with your facets + its first AI build key; you connect your AI">
            {busy ? '…' : '✦ BIRTH — CONNECT MY AI'}
          </button>
          <button disabled={!briefOk || busy || !gen || (!gen.buyable && gen.credits === 0 && !gen.free)} onClick={generate}
            className="px-4 py-3 rounded-xl border border-amber-300/50 bg-amber-400/10 text-amber-200 text-[14px] tracking-[0.15em] hover:bg-amber-400/20 disabled:opacity-35 transition-colors"
            title="a generation credit births it from your brief — then connect your AI to build">
            {busy ? '…' : genLabel}
          </button>
        </div>
        <p className="text-[11px] text-white/30 mt-2 text-center">one pipeline either way: born with these facets + its first AI build key. no house AI — your AI builds it.</p>
      </div>
    </div>
  )
}
