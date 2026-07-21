'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import FieldEngine from '@/app/engine/FieldEngine'
import TournamentBar from '@/app/TournamentBar'
import ShareWorld from './ShareWorld'
import FollowButton from './FollowButton'
import SummonConsole from './SummonConsole'

/** The space page = the SAME engine dock a world uses (one unified chrome), plus
 *  the space-only PLUMBING that lives invisibly here: the version arena and the
 *  delete / remix / call-a-vote flows. The dock's buttons dispatch window events
 *  (cafe:delete-world / cafe:remix-world / cafe:call-vote); this wrapper owns the
 *  modals + fetches. SpaceToolbar is gone — /space and /play render one chrome. */
export default function SpaceStage({ spaceId, spaceSlug, engineOwner, isOwner, versionView, name, ownerName, ownerId, ownerHandle }: {
  spaceId: string
  spaceSlug: string
  engineOwner: boolean
  isOwner: boolean
  versionView?: number
  name: string
  ownerName: string | null
  ownerId?: string | null
  ownerHandle?: string | null
}) {
  const router = useRouter()
  const [dockBottom, setDockBottom] = useState(0)
  const [building, setBuilding] = useState(false)   // world is still blank-and-building → hide SHARE
  const [versions, setVersions] = useState<{ version: number }[]>([])
  // THE RECKONING on a space page: same contract main's shell has — the arena
  // reports its stage rect, the engine fits the grid into it, and hovering a
  // candidate hot-loads that save point. Without this wiring the vote overlay
  // sat ON TOP of the world (grid unfitted) and candidates never loaded.
  const [voting, setVoting] = useState(false)
  const [stageRect, setStageRect] = useState<{ top: number; right: number; bottom: number; left: number } | null>(null)
  const [previewVersion, setPreviewVersion] = useState<number | null>(null)
  const [vp, setVp] = useState({ w: 1200, h: 800 })
  useEffect(() => {
    const onR = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    onR()
    window.addEventListener('resize', onR)
    return () => window.removeEventListener('resize', onR)
  }, [])
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

  // LIVE HEAD-COUNT: report presence while inside this world. The hub (CafeShell)
  // heartbeats /api/presence, but the /space page never did — so a world's own
  // bubble always read 0. Key it to the door's bubble id: (name || slug) upper-
  // cased, exactly how cafe-cartridge.mjs keys a space bubble (disp). Reuses the
  // same cc-pid so one person is one place, and never counts a version snapshot.
  useEffect(() => {
    if (versionView) return
    let pid = ''
    try {
      pid = localStorage.getItem('cc-pid') || Math.random().toString(36).slice(2, 12)
      localStorage.setItem('cc-pid', pid)
    } catch { pid = Math.random().toString(36).slice(2, 12) }
    // STEP 3 nesting: report the world's canonical location PATH so its viewers
    // roll up onto the PLAYER WORLDS bubble on main AND onto this world's own
    // bubble in the directory (web/docs/presence-nesting-spec.md).
    const key = 'main/players/space:' + spaceSlug
    const beat = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      fetch('/api/presence', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene: key, id: pid }),
      }).catch(() => {})
    }
    beat()
    const iv = setInterval(beat, 10_000)
    const bye = () => { try { navigator.sendBeacon('/api/presence', JSON.stringify({ id: pid, leave: true })) } catch { /* gone anyway */ } }
    window.addEventListener('pagehide', bye)
    return () => { clearInterval(iv); window.removeEventListener('pagehide', bye); bye() }
  }, [name, spaceSlug, versionView])

  const loadVersions = useCallback(async () => {
    try {
      const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/versions`)
      const d = await r.json()
      // versions are 1-based — drop any v0/negative so the arena never stages a
      // "v0" candidate (previewing which would pin the engine to a nonexistent version)
      if (Array.isArray(d?.versions)) setVersions(d.versions.filter((v: { version: number }) => v.version >= 1))
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

  const btn = 'text-[14px] tracking-[0.15em] border rounded px-3 py-1.5 transition-colors'

  return (
    <>
      {/* nothing to share on a world that isn't real yet — hide SHARE while it's
          still blank-and-building */}
      {!building && <ShareWorld slug={spaceSlug} name={name} />}
      {/* sits clearly ABOVE the SHARE button (bottom-4, ~34px tall) — the old
          bottom-[52px] left them touching, so FOLLOW painted over SHARE */}
      <div className="fixed bottom-[64px] right-4 z-[60]"><FollowButton handle={ownerHandle} isOwner={isOwner} /></div>
      {!building && <SummonConsole slug={spaceSlug} name={name} isOwner={isOwner} />}
      <FieldEngine
        spaceId={spaceId}
        spaceSlug={spaceSlug}
        spaceName={name}
        spaceOwnerName={ownerName}
        spaceOwnerHandle={ownerHandle}
        spaceOwnerId={ownerId}
        isOwner={engineOwner}
        versionView={previewVersion || versionView}
        onDockRect={setDockBottom}
        onBuilding={setBuilding}
        viewport={voting && stageRect
          ? { top: stageRect.top, right: Math.max(0, vp.w - stageRect.right), bottom: Math.max(0, vp.h - stageRect.bottom), left: stageRect.left }
          : null}
      />

      {/* the version arena: LIVE vs this world's save points — every page votes.
          Was mounted by SpaceToolbar; now lives here so the engine dock is the
          only visible chrome. Hidden while the world is still building — an
          unfinished world (or one wiped for a rebuild) is not up for a vote,
          even if it carries stale save points from a previous life. */}
      <TournamentBar
        slot={`tournament:space:${spaceSlug}`}
        worlds={!building && versions.length > 0 ? ['LIVE', ...versions.slice(0, 9).map(v => `v${v.version}`)] : []}
        visible
        rail
        railTop={dockBottom ? dockBottom + 8 : undefined}
        onReckoning={(on) => { setVoting(on); if (!on) { setPreviewVersion(null); setStageRect(null) } }}
        onPreview={(w) => {
          if (!w || w === 'LIVE') { setPreviewVersion(null); return }
          const n = parseInt(String(w).replace(/^v/, ''), 10)
          setPreviewVersion(Number.isFinite(n) && n >= 1 ? n : null)
        }}
        onStageRect={setStageRect}
      />

      {/* a world's OSD — captions/hints, restored from SpaceToolbar */}
      {caption && (caption.text || caption.kind === 'typing') && (
        <div className="fixed top-8 left-10 z-50 pointer-events-none select-none font-mono uppercase tracking-[0.3em]"
          style={{
            color: caption.kind === 'hint' ? 'rgba(140,255,170,0.45)' : 'rgb(140,255,170)',
            fontSize: caption.kind === 'hint' ? 13 : 26,
            textShadow: '0 0 8px rgba(80,255,140,0.8), 0 0 28px rgba(80,255,140,0.35)',
          }}>
          {caption.text}{caption.kind === 'typing' ? '▮' : ''}
        </div>
      )}

      {msg && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] rounded bg-[#171009]/90 text-[#ffdba8] font-mono text-[14px] tracking-wider px-3 py-1.5 border border-[#b97a2a]/30">{msg}</div>}

      {/* delete confirm — reached by the dock's ✕ delete (cafe:delete-world) */}
      {confirmDel && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60" onClick={() => setConfirmDel(false)}>
          <div className="max-w-sm w-[90%] rounded-xl border border-red-400/30 bg-black/90 backdrop-blur p-5 font-mono text-[17px] text-white/85" onClick={e => e.stopPropagation()}>
            <div className="text-red-300/90 tracking-[0.2em] text-[16px] mb-2">✕ DELETE THIS WORLD</div>
            <p className="text-white/60 text-[16px] mb-3">This removes <span className="text-white/85">{name}</span> for good. There is no undo.</p>
            {delErr && <p className="text-red-400 text-[16px] mb-2">{delErr}</p>}
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
          <div className="max-w-sm w-[90%] rounded-xl border border-[#b97a2a]/30 bg-black/90 backdrop-blur p-5 font-mono text-[17px] text-white/85" onClick={e => e.stopPropagation()}>
            <div className="text-amber-300/90 tracking-[0.2em] text-[16px] mb-2">⚖ CALL A VOTE</div>
            <p className="text-white/55 text-[16px] mb-2">Open a resolution the commons can weigh in on.</p>
            <textarea value={flagReason} onChange={e => setFlagReason(e.target.value)} placeholder="What's the conflict?"
              className="w-full h-20 bg-black/50 border border-white/15 rounded px-2 py-1.5 text-[16px] text-white/85 outline-none focus:border-amber-300/50 mb-3" />
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
