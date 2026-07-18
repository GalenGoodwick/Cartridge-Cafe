'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import FieldEngine from '@/app/engine/FieldEngine'
import TournamentBar from '@/app/TournamentBar'

/** The space page = the SAME engine dock a world uses (one unified chrome), plus
 *  the space-only PLUMBING that lives invisibly here: the version arena and the
 *  delete / remix / call-a-vote flows. The dock's buttons dispatch window events
 *  (cafe:delete-world / cafe:remix-world / cafe:call-vote); this wrapper owns the
 *  modals + fetches. SpaceToolbar is gone — /space and /play render one chrome. */
export default function SpaceStage({ spaceId, spaceSlug, engineOwner, isOwner, versionView, name, ownerName, ownerId }: {
  spaceId: string
  spaceSlug: string
  engineOwner: boolean
  isOwner: boolean
  versionView?: number
  name: string
  ownerName: string | null
  ownerId?: string | null
}) {
  const router = useRouter()
  const [dockBottom, setDockBottom] = useState(0)
  const [versions, setVersions] = useState<{ version: number }[]>([])
  const [confirmDel, setConfirmDel] = useState(false)
  const [delErr, setDelErr] = useState('')
  const [flagOpen, setFlagOpen] = useState(false)
  const [flagReason, setFlagReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3500) }

  // worlds speak through cafe:caption — a space page must listen too, or every
  // AI-built world is mute on its own page (this was SpaceToolbar's; restored).
  const [caption, setCaption] = useState<{ text: string; kind: string } | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onCaption = (e: Event) => {
      const d = (e as CustomEvent).detail as { text: string; kind: string } | null
      if (timer) clearTimeout(timer)
      if (!d || (!d.text && d.kind !== 'typing')) { setCaption(null); return }
      setCaption(d)
      if (d.kind !== 'typing') timer = setTimeout(() => setCaption(null), d.kind === 'hint' ? 6000 : 3200)
    }
    window.addEventListener('cafe:caption', onCaption)
    return () => { window.removeEventListener('cafe:caption', onCaption); if (timer) clearTimeout(timer) }
  }, [])

  const loadVersions = useCallback(async () => {
    try {
      const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/versions`)
      const d = await r.json()
      if (Array.isArray(d?.versions)) setVersions(d.versions)
    } catch { /* offline — no arena */ }
  }, [spaceSlug])
  useEffect(() => { loadVersions() }, [loadVersions])

  const deleteWorld = useCallback(async () => {
    setDelErr('')
    const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}`, { method: 'DELETE' })
    if (r.ok) { window.location.href = '/'; return }
    setDelErr((await r.json().catch(() => null))?.error || 'could not delete')
  }, [spaceSlug])

  const remix = useCallback(async () => {
    setBusy(true)
    try {
      const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/fork`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const d = await r.json()
      if (r.ok) { window.location.href = `/space/${d.space.slug}` }
      else flash(d.error || 'Remix failed (sign in?)')
    } finally { setBusy(false) }
  }, [spaceSlug])

  const callVote = useCallback(async () => {
    if (!flagReason.trim()) { flash('Say what the conflict is'); return }
    setBusy(true)
    try {
      const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/flag`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: flagReason.trim() }),
      })
      const d = await r.json()
      if (r.ok) { setFlagOpen(false); router.push(`/chants/${d.deliberationId}`) }
      else flash(d.error || 'Could not open a resolution')
    } finally { setBusy(false) }
  }, [spaceSlug, flagReason, router])

  // the dock's buttons reach these flows through window events
  useEffect(() => {
    const onDel = () => { setDelErr(''); setConfirmDel(true) }
    const onRemix = () => { remix() }
    const onVote = () => { setFlagReason(''); setFlagOpen(true) }
    window.addEventListener('cafe:delete-world', onDel)
    window.addEventListener('cafe:remix-world', onRemix)
    window.addEventListener('cafe:call-vote', onVote)
    return () => {
      window.removeEventListener('cafe:delete-world', onDel)
      window.removeEventListener('cafe:remix-world', onRemix)
      window.removeEventListener('cafe:call-vote', onVote)
    }
  }, [remix])

  const btn = 'text-[10px] tracking-[0.15em] border rounded px-3 py-1.5 transition-colors'

  return (
    <>
      <FieldEngine
        spaceId={spaceId}
        spaceSlug={spaceSlug}
        spaceName={name}
        spaceOwnerName={ownerName}
        spaceOwnerId={ownerId}
        isOwner={engineOwner}
        versionView={versionView}
        onDockRect={setDockBottom}
      />

      {/* the version arena: LIVE vs this world's save points — every page votes.
          Was mounted by SpaceToolbar; now lives here so the engine dock is the
          only visible chrome. */}
      <TournamentBar
        slot={`tournament:space:${spaceSlug}`}
        worlds={versions.length > 0 ? ['LIVE', ...versions.slice(0, 9).map(v => `v${v.version}`)] : []}
        visible
        rail
        railTop={dockBottom ? dockBottom + 8 : undefined}
      />

      {/* a world's OSD — captions/hints, restored from SpaceToolbar */}
      {caption && (caption.text || caption.kind === 'typing') && (
        <div className="fixed top-8 left-10 z-50 pointer-events-none select-none font-mono uppercase tracking-[0.3em]"
          style={{
            color: caption.kind === 'hint' ? 'rgba(140,255,170,0.45)' : 'rgb(140,255,170)',
            fontSize: caption.kind === 'hint' ? 11 : 22,
            textShadow: '0 0 8px rgba(80,255,140,0.8), 0 0 28px rgba(80,255,140,0.35)',
          }}>
          {caption.text}{caption.kind === 'typing' ? '▮' : ''}
        </div>
      )}

      {msg && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] rounded bg-[#171009]/90 text-[#ffdba8] font-mono text-[10px] tracking-wider px-3 py-1.5 border border-[#b97a2a]/30">{msg}</div>}

      {/* delete confirm — reached by the dock's ✕ delete (cafe:delete-world) */}
      {confirmDel && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60" onClick={() => setConfirmDel(false)}>
          <div className="max-w-sm w-[90%] rounded-xl border border-red-400/30 bg-black/90 backdrop-blur p-5 font-mono text-[12px] text-white/85" onClick={e => e.stopPropagation()}>
            <div className="text-red-300/90 tracking-[0.2em] text-[11px] mb-2">✕ DELETE THIS WORLD</div>
            <p className="text-white/60 text-[11px] mb-3">This removes <span className="text-white/85">{name}</span> for good. There is no undo.</p>
            {delErr && <p className="text-red-400 text-[11px] mb-2">{delErr}</p>}
            <div className="flex justify-end gap-2">
              <button className={`${btn} border-white/20 text-white/70 hover:bg-white/10`} onClick={() => setConfirmDel(false)}>KEEP IT</button>
              <button className={`${btn} border-red-400/50 bg-red-500/20 text-red-200 hover:bg-red-500/30`} onClick={deleteWorld}>DELETE</button>
            </div>
          </div>
        </div>
      )}

      {/* call a vote → opens a /chants deliberation. Reached by the dock's ⚖ button. */}
      {flagOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60" onClick={() => setFlagOpen(false)}>
          <div className="max-w-sm w-[90%] rounded-xl border border-[#b97a2a]/30 bg-black/90 backdrop-blur p-5 font-mono text-[12px] text-white/85" onClick={e => e.stopPropagation()}>
            <div className="text-amber-300/90 tracking-[0.2em] text-[11px] mb-2">⚖ CALL A VOTE</div>
            <p className="text-white/55 text-[11px] mb-2">Open a resolution the commons can weigh in on.</p>
            <textarea value={flagReason} onChange={e => setFlagReason(e.target.value)} placeholder="What's the conflict?"
              className="w-full h-20 bg-black/50 border border-white/15 rounded px-2 py-1.5 text-[11px] text-white/85 outline-none focus:border-amber-300/50 mb-3" />
            <div className="flex justify-end gap-2">
              <button className={`${btn} border-white/20 text-white/70 hover:bg-white/10`} onClick={() => setFlagOpen(false)}>Cancel</button>
              <button className={`${btn} border-amber-400/50 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25`} disabled={busy} onClick={callVote}>Open resolution</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
