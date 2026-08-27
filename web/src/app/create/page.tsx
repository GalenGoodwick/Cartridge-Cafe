'use client'

// THE GENERATE FLOW (Galen, Aug 27): making a world asks THREE questions, each
// a facet of the unified WorldDoc set at birth through the ONE pipeline:
//   1 · BASE       blank, or fork any forkable world (fork-from-here moves OUT
//                  of the in-game dock INTO creation; lineage recorded)
//   2 · DIMENSIONS the targets facet — desktop | mobile | universal. Drives the
//                  catalog badge, the door notice, and every solve verdict from
//                  the world's first second.
//   3 · PEOPLE     solo | invite-only | open world (open = live member editing)
// One form → POST /api/spaces → birthWorld() → into your world with the AI key.
// Arrive with ?base=<slug> and the base is prefilled (the shelf's fork door).
import { useEffect, useState } from 'react'
import Link from 'next/link'

const card = 'rounded-xl border px-4 py-3 text-left transition-colors cursor-pointer'
const on = 'border-amber-300/60 bg-amber-400/10 text-[#ffdba8]'
const off = 'border-white/12 bg-black/40 text-white/60 hover:border-white/25 hover:text-white/80'

export default function CreateWorld() {
  const [name, setName] = useState('')
  const [brief, setBrief] = useState('')
  const [base, setBase] = useState('')
  const [targets, setTargets] = useState<'universal' | 'desktop' | 'mobile'>('universal')
  const [access, setAccess] = useState<'solo' | 'invite' | 'open'>('solo')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // the shelf's FORK-FROM-HERE door lands with ?base=<slug>
  useEffect(() => {
    try { const b = new URLSearchParams(window.location.search).get('base'); if (b) setBase(b) } catch { /* ssr */ }
  }, [])

  const create = async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/spaces', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), brief: brief.trim() || undefined,
          base: base.trim() || undefined,
          targets: targets === 'universal' ? undefined : targets,
          access: access === 'solo' ? undefined : access,
        }),
      })
      const d = await r.json()
      if (r.ok) window.location.href = `/space/${d.space.slug}?connect=1`
      else setErr(d.error || 'could not create')
    } finally { setBusy(false) }
  }

  const nameOk = name.trim().length >= 2
  return (
    <div className="min-h-screen px-4 py-8 font-mono" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #0c0b14, #050509)', color: '#e7dcc8' }}>
      <div className="max-w-[560px] mx-auto">
        <div className="flex items-baseline gap-3 mb-1">
          <Link href="/" className="text-white/40 hover:text-white text-[14px]">◂</Link>
          <h1 className="text-[22px] tracking-[0.2em] text-[#ffdba8]">NEW WORLD</h1>
        </div>
        <p className="text-white/40 text-[13px] mb-6">three questions — then connect your AI and build.</p>

        {/* NAME + BRIEF */}
        <input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="name your world…"
          className="w-full mb-2 px-3 py-2.5 rounded-xl bg-black/50 border border-white/15 text-[16px] text-white/90 placeholder:text-white/25 outline-none focus:border-amber-300/50" />
        <textarea value={brief} onChange={e => setBrief(e.target.value)} maxLength={500} rows={2}
          placeholder="what should it become? (your AI reads this first — optional here, needed to build)"
          className="w-full mb-5 px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-[14px] text-white/85 placeholder:text-white/25 outline-none focus:border-amber-300/50 resize-none" />

        {/* 1 · BASE */}
        <div className="text-[12px] tracking-[0.25em] text-white/45 mb-2">1 · BASE</div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <button className={`${card} ${!base.trim() ? on : off}`} onClick={() => setBase('')}>
            <div className="text-[14px] mb-0.5">✦ BLANK</div>
            <div className="text-[12px] opacity-70">born empty — the AI builds from your brief</div>
          </button>
          <div className={`${card} ${base.trim() ? on : off}`}>
            <div className="text-[14px] mb-0.5">⑂ FORK A WORLD</div>
            <input value={base} onChange={e => setBase(e.target.value)} placeholder="world slug, e.g. cinderfell"
              className="w-full bg-transparent border-b border-white/20 text-[13px] text-white/85 placeholder:text-white/25 outline-none focus:border-amber-300/50" />
          </div>
        </div>
        <p className="text-[11px] text-white/30 mb-5">forkable worlds only — you start from its live snapshot, lineage recorded.</p>

        {/* 2 · DIMENSIONS */}
        <div className="text-[12px] tracking-[0.25em] text-white/45 mb-2">2 · DIMENSIONS</div>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {([['universal', '◇ UNIVERSAL', 'recomposes to any screen'], ['desktop', '🖥 DESKTOP', 'wide screen + mouse; phones get an honest door notice'], ['mobile', '▯ MOBILE', 'portrait phone; desktop shows it in a phone frame']] as const).map(([k, t, d]) => (
            <button key={k} className={`${card} ${targets === k ? on : off}`} onClick={() => setTargets(k)}>
              <div className="text-[13px] mb-0.5">{t}</div>
              <div className="text-[11px] opacity-70 leading-snug">{d}</div>
            </button>
          ))}
        </div>

        {/* 3 · PEOPLE */}
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
        <button disabled={!nameOk || busy} onClick={create}
          className="w-full px-4 py-3 rounded-xl border border-emerald-300/50 bg-emerald-400/15 text-emerald-200 text-[15px] tracking-[0.2em] hover:bg-emerald-400/25 disabled:opacity-35 transition-colors">
          {busy ? '…' : '✦ BIRTH THE WORLD'}
        </button>
        <p className="text-[11px] text-white/30 mt-2 text-center">one pipeline: the world is born with these facets + its first AI build key.</p>
      </div>
    </div>
  )
}
