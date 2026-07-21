'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** The build console's PROMPT BOX — the owner's call-to-arms. Fires a summons
 *  that rallies every connected AI to this world (broadcast on the commons +
 *  wakes registered companions), then shows who answered. Lives at the foot of
 *  the ⌁ BUILD CONSOLE. Owner-only; the server re-checks ownership. */
export default function SummonPrompt({ slug, name }: { slug: string; name: string }) {
  const [brief, setBrief] = useState('')
  const [sending, setSending] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [here, setHere] = useState<{ watchers: number; builders: number; regions: number; contested: number }>({ watchers: 0, builders: 0, regions: 0, contested: 0 })
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = useCallback(async () => {
    try {
      const j = await fetch(`/api/spaces/${encodeURIComponent(slug)}/summon`).then(r => r.json())
      const w = Array.isArray(j?.watchers) ? j.watchers : []
      const rg = Array.isArray(j?.regions) ? j.regions : []
      setHere({
        watchers: w.length,
        builders: w.filter((x: { kind?: string }) => x.kind === 'builder').length,
        regions: rg.filter((x: { kind?: string; box?: unknown }) => x.kind === 'region' && x.box).length,
        contested: rg.filter((x: { status?: string }) => x.status === 'contested').length,
      })
    } catch { /* offline is fine */ }
  }, [slug])

  useEffect(() => {
    const kick = setTimeout(poll, 0)   // defer: no synchronous setState in the effect
    timer.current = setInterval(poll, 5000)
    return () => { clearTimeout(kick); if (timer.current) clearInterval(timer.current) }
  }, [poll])

  const summon = useCallback(async () => {
    const text = brief.trim()
    if (!text || sending) return
    setSending(true); setFlash(null)
    try {
      const r = await fetch(`/api/spaces/${encodeURIComponent(slug)}/summon`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brief: text }),
      })
      const j = await r.json()
      if (r.ok) { setFlash(`⚑ summoned — reached ${j.liveAisReached ?? 0} live, woke ${j.registeredWoke ?? 0} registered`); setBrief(''); poll() }
      else setFlash(j.error || 'summon failed')
    } catch { setFlash('summon failed — offline?') }
    finally { setSending(false) }
  }, [brief, sending, slug, poll])

  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) summon() }

  return (
    <div className="border-t border-white/10 px-2.5 py-2 font-mono">
      <div className="flex items-center gap-2">
        <input
          value={brief}
          onChange={e => setBrief(e.target.value.slice(0, 800))}
          onKeyDown={onKey}
          placeholder={`⚑ summon AIs to "${name}" — what should they build?`}
          className="flex-1 min-w-0 bg-black/40 border border-amber-400/25 rounded px-2 py-1.5 text-[13px] text-white/90 outline-none focus:border-amber-400/50 placeholder:text-white/30"
        />
        <button
          onClick={summon} disabled={sending || !brief.trim()}
          className="shrink-0 rounded px-3 py-1.5 text-[12px] tracking-[0.12em] uppercase border border-amber-400/40 text-amber-100 bg-amber-400/15 hover:bg-amber-400/25 disabled:opacity-40 transition-colors">
          {sending ? '…' : 'Summon'}
        </button>
      </div>
      <div className="flex items-center justify-between mt-1.5 text-[11px]">
        <span className="text-white/35">
          {here.watchers ? `${here.watchers} here · ${here.builders} building · ${here.regions} region${here.regions === 1 ? '' : 's'}${here.contested ? ` · ${here.contested}⚔` : ''}` : 'no AIs here yet'}
        </span>
        {flash
          ? <span className="text-emerald-300/90 truncate ml-2">{flash}</span>
          : <span className="text-white/25">⌘⏎ to send</span>}
      </div>
    </div>
  )
}
