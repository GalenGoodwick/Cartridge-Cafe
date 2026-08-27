'use client'

// THE GAME LIST — /mine's client half. Every world you own: open it, see its
// declared fit + access at a glance, and DELETE from here (the one place
// deletion lives). Open/co-built worlds are locked: the server refuses their
// deletion (multiple-editor work is protected) and the row says why. Deleting
// asks you to type the world's name — deliberate, not a reflex click.
import { useState } from 'react'
import Link from 'next/link'

type W = { slug: string; name: string; isPublic: boolean; updatedAt: string; open: boolean; fit: string; forks: number }

export default function MyWorldsList({ worlds, handle }: { worlds: W[]; handle: string }) {
  const [confirm, setConfirm] = useState<W | null>(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [gone, setGone] = useState<Set<string>>(new Set())

  const doDelete = async (w: W) => {
    setBusy(true); setErr('')
    try {
      const r = await fetch(`/api/spaces/${encodeURIComponent(w.slug)}`, { method: 'DELETE' })
      if (r.ok) { setGone(g => new Set(g).add(w.slug)); setConfirm(null); setTyped('') }
      else setErr((await r.json().catch(() => null))?.error || 'could not delete')
    } finally { setBusy(false) }
  }

  const live = worlds.filter(w => !gone.has(w.slug))
  return (
    <div className="min-h-screen px-4 py-8 font-mono" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #0c0b14, #050509)', color: '#e7dcc8' }}>
      <div className="max-w-[720px] mx-auto">
        <div className="flex items-baseline gap-3 mb-1">
          <Link href="/" className="text-white/40 hover:text-white text-[14px]">◂</Link>
          <h1 className="text-[22px] tracking-[0.2em] text-[#ffdba8]">MY WORLDS</h1>
          <span className="text-white/35 text-[13px]">{live.length}</span>
          <Link href={`/u/${handle}`} className="ml-auto text-[12px] tracking-[0.15em] text-cyan-200/70 hover:text-cyan-200">MY PUBLIC SHELF ↗</Link>
        </div>
        <p className="text-white/40 text-[13px] mb-6">the workbench — open, inspect, delete. co-built (open) worlds are protected.</p>

        {live.length === 0 && <div className="text-white/40 text-[14px] py-12 text-center">no worlds yet — brew one from the main page.</div>}

        <div className="space-y-1.5">
          {live.map(w => (
            <div key={w.slug} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/10 bg-black/40">
              <Link href={`/space/${w.slug}`} className="min-w-0 flex-1 group">
                <span className="text-[15px] text-white/85 group-hover:text-white truncate">{w.name}</span>
                <span className="ml-2 text-[12px] text-white/30">/{w.slug}</span>
              </Link>
              <span className="text-[11px] tracking-[0.1em] text-white/35">{w.fit === 'universal' ? '◇ universal' : w.fit === 'mobile' ? '▯ mobile' : '🖥 desktop'}</span>
              {w.forks > 0 && <span className="text-[11px] text-emerald-200/60">⑂{w.forks}</span>}
              <span className={`text-[11px] tracking-[0.1em] ${w.isPublic ? 'text-amber-200/70' : 'text-white/30'}`}>{w.isPublic ? '● playable' : '○ private'}</span>
              {w.open ? (
                <span className="text-[11px] tracking-[0.1em] text-cyan-200/60" title="OPEN world — members may have built here; co-built work is protected. Close it (make solo) to unlock deletion.">🔒 open · protected</span>
              ) : (
                <button onClick={() => { setConfirm(w); setTyped(''); setErr('') }}
                  className="text-[12px] px-2 py-1 rounded-lg border border-red-400/25 text-red-300/60 hover:text-red-300 hover:bg-red-500/10">✕</button>
              )}
            </div>
          ))}
        </div>
      </div>

      {confirm && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-6" onClick={() => setConfirm(null)}>
          <div className="max-w-sm w-full rounded-xl border border-red-400/30 bg-black/95 p-5" onClick={e => e.stopPropagation()}>
            <div className="text-red-300/90 tracking-[0.2em] text-[15px] mb-2">✕ DELETE WORLD</div>
            <p className="text-white/60 text-[14px] mb-3">
              This removes <span className="text-white/90">{confirm.name}</span> for good. There is no undo.
              {confirm.forks > 0 && <span className="text-amber-200/70"> Its {confirm.forks} fork{confirm.forks > 1 ? 's' : ''} may block this — their roots live here.</span>}
            </p>
            <p className="text-white/45 text-[12px] mb-1">type the world&apos;s name to confirm:</p>
            <input autoFocus value={typed} onChange={e => setTyped(e.target.value)} placeholder={confirm.name}
              className="w-full mb-3 px-2 py-1.5 rounded bg-black/60 border border-white/15 text-[14px] text-white/85 outline-none focus:border-red-300/50" />
            {err && <p className="text-red-400 text-[13px] mb-2">{err}</p>}
            <div className="flex justify-end gap-2">
              <button className="px-3 py-1.5 rounded-lg border border-white/20 text-white/70 hover:bg-white/10 text-[13px]" onClick={() => setConfirm(null)}>KEEP IT</button>
              <button disabled={typed.trim() !== confirm.name || busy} onClick={() => doDelete(confirm)}
                className="px-3 py-1.5 rounded-lg border border-red-400/50 bg-red-500/20 text-red-200 hover:bg-red-500/30 text-[13px] disabled:opacity-35">
                {busy ? '…' : 'DELETE'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
