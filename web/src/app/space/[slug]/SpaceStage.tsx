'use client'

import { usePresenceBeat } from '@/lib/usePresenceBeat'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import FieldEngine from '@/app/engine/FieldEngine'
import ShareWorld from './ShareWorld'
import FollowButton from './FollowButton'

/** The space page = the SAME engine dock a world uses (one unified chrome), plus
 *  the space-only PLUMBING that lives invisibly here: the delete / remix / flag
 *  flows. The dock's buttons dispatch window events (cafe:delete-world /
 *  cafe:remix-world / cafe:call-vote); this wrapper owns the modals + fetches.
 *  BRANCH PARADIGM RETIRED (Galen, Aug 2026): the in-world branch arena — the
 *  vote that competed MAIN vs a world's public branches — is gone. Remixing a
 *  world FORKS it (an owned playerSpace with forkOf lineage), never enters a
 *  challenger for a vote. SpaceToolbar is gone — /space and /play render one chrome. */
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
  // STEP 3 nesting: report the world's canonical location PATH so its viewers
  // roll up onto the PLAYER WORLDS bubble on main AND onto this world's own
  // bubble in the directory (web/docs/presence-nesting-spec.md). Never counts
  // a version snapshot; hidden tabs skip the beat.
  usePresenceBeat(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return null
    return 'main/players/space:' + spaceSlug
  }, { intervalMs: 10_000, byeOnCleanup: true, enabled: !versionView, deps: [name, spaceSlug, versionView] })

  // DEVELOPER LIVE — the world's OWNER being present IS the developer at work, so
  // flag it (alongside the AI builder's ai:<slug> dock) with a separate dev:<slug>
  // presence in a non-counted scene. The bridge/hub read `ai:` OR `dev:` as live,
  // so the world shows "developer live" when its maker — human or AI — is on it.
  usePresenceBeat(
    () => (isOwner && (typeof document === 'undefined' || document.visibilityState !== 'hidden')) ? 'builders' : null,
    { id: 'dev:' + spaceSlug, intervalMs: 10_000, byeOnCleanup: true, enabled: isOwner && !versionView, deps: [spaceSlug, isOwner, versionView] },
  )

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

  // GAMEPLAY MODE (Galen): the engine's ⛶ PLAY strips its own chrome; this
  // wrapper's corner controls (share / follow / swarm / version arena) must
  // vanish too, so the world truly plays uncovered. Restored on ▣ reopen.
  const [playMode, setPlayMode] = useState(false)
  useEffect(() => {
    const on = (e: Event) => setPlayMode(!!(e as CustomEvent).detail)
    window.addEventListener('cafe:playmode', on)
    return () => window.removeEventListener('cafe:playmode', on)
  }, [])

  return (
    <>
      {/* nothing to share on a world that isn't real yet — hide SHARE while it's
          still blank-and-building */}
      {!building && !playMode && <ShareWorld slug={spaceSlug} name={name} />}
      {/* sits clearly ABOVE the SHARE button (bottom-4, ~34px tall) — the old
          bottom-[52px] left them touching, so FOLLOW painted over SHARE */}
      {!playMode && <div className="fixed bottom-[64px] right-4 z-[60]"><FollowButton handle={ownerHandle} isOwner={isOwner} /></div>}
      {/* ⚙ MANAGE moved off individual world pages → it now lives on your own
          shelf, /u/<you> (the MANAGE button in CafeShell's top bar). */}
      {/* ⚑ SWARM (SummonConsole) unmounted — Galen: the map button doesn't
          belong in every world. The summon/region APIs are untouched; the
          AIs still carve. Re-mount here if a human-facing map returns. */}
      <FieldEngine
        spaceId={spaceId}
        spaceSlug={spaceSlug}
        spaceName={name}
        spaceOwnerName={ownerName}
        spaceOwnerHandle={ownerHandle}
        spaceOwnerId={ownerId}
        isOwner={engineOwner}
        versionView={versionView}
        onDockRect={setDockBottom}
        onBuilding={setBuilding}
        viewport={null}
      />

      {/* BRANCH ARENA REMOVED (branch→fork transition): a world no longer hosts a
          vote between MAIN and its public branches. Remixing forks the world into
          the remixer's own owned playerSpace; there is no in-world challenger vote. */}

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
