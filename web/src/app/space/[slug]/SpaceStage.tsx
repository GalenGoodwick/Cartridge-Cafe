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

  // FORK-WITH-PARAMETERS (DESIGN-multiplayer-worldbuilding §2): forking opens
  // the contract dialog — name + the social presets (+ grid dims once the
  // engine honors them). The chosen contract is IMMUTABLE after this moment.
  const [forkOpen, setForkOpen] = useState(false)
  const [forkName, setForkName] = useState('')
  const [forkPreset, setForkPreset] = useState('solo')
  const PRESETS: Array<{ id: string; label: string; line: string }> = [
    { id: 'solo', label: 'SOLO', line: 'I build · everyone plays' },
    { id: 'open-ground', label: 'OPEN GROUND', line: 'everyone builds · everyone plays' },
    { id: 'crew-world', label: 'CREW WORLD', line: 'my crew builds · everyone plays' },
    { id: 'private-table', label: 'PRIVATE TABLE', line: 'invite-only · build and play' },
  ]
  const remix = useCallback(async () => {
    setBusy(true)
    try {
      const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/fork`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: forkName.trim() || undefined, policy: forkPreset }),
      })
      const d = await r.json()
      if (r.ok) { window.location.href = `/space/${d.space.slug}` }
      else flash(d.error || 'Fork failed (sign in?)')
    } finally { setBusy(false) }
  }, [spaceSlug, forkName, forkPreset])

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
    const onRemix = () => { setForkName(''); setForkPreset('solo'); setForkOpen(true) }
    const onVote = () => { setFlagReason(''); setFlagOpen(true) }
    window.addEventListener('cafe:delete-world', onDel)
    window.addEventListener('cafe:remix-world', onRemix)
    window.addEventListener('cafe:call-vote', onVote)
    return () => {
      window.removeEventListener('cafe:delete-world', onDel)
      window.removeEventListener('cafe:remix-world', onRemix)
      window.removeEventListener('cafe:call-vote', onVote)
    }
  }, [])

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

      {/* THE FORK DIALOG — name + the social contract, chosen once, immutable */}
      {forkOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={() => setForkOpen(false)}>
          <div className="max-w-md w-full rounded-xl border border-emerald-300/30 bg-black/90 backdrop-blur p-5 font-mono text-white/85" onClick={e => e.stopPropagation()}>
            <div className="text-emerald-200/90 tracking-[0.2em] text-[15px] mb-1">⑄ FORK THIS WORLD</div>
            <p className="text-white/45 text-[13px] mb-3">A fork is a new world you own. Its terms are set NOW and never change.</p>
            <div className="text-[11px] tracking-[0.2em] text-white/40 mb-1">1 · NAME IT</div>
            <input autoFocus value={forkName} onChange={e => setForkName(e.target.value)} maxLength={60}
              onKeyDown={e => { if (e.key === 'Escape') setForkOpen(false) }}
              placeholder={`${name} (remix)`}
              className="w-full mb-3 px-2.5 py-2 rounded bg-black/50 border border-white/15 text-[14px] text-white/85 placeholder:text-white/25 outline-none focus:border-emerald-300/50" />
            <div className="text-[11px] tracking-[0.2em] text-white/40 mb-1.5">2 · THE SOCIAL CONTRACT <span className="text-amber-300/60">· immutable</span></div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {PRESETS.map(p => (
                <button key={p.id} onClick={() => setForkPreset(p.id)}
                  className={`text-left rounded-lg border px-3 py-2.5 transition-colors ${forkPreset === p.id
                    ? 'border-emerald-300/70 bg-emerald-400/15 text-emerald-100'
                    : 'border-white/15 text-white/60 hover:border-emerald-300/40'}`}>
                  <div className="text-[12px] tracking-[0.15em]">{p.label}</div>
                  <div className="text-[10.5px] text-white/40 mt-0.5">{p.line}</div>
                </button>
              ))}
            </div>
            <div className="text-[11px] tracking-[0.2em] text-white/40 mb-1.5">3 · GRID</div>
            <div className="mb-4 px-3 py-2 rounded-lg border border-white/10 text-[12px] text-white/35">
              512 × 512 <span className="text-white/25">· more dimensions arrive with the engine work</span>
            </div>
            <div className="flex justify-end gap-2">
              <button className={`${btn} border-white/20 text-white/70 hover:bg-white/10`} onClick={() => setForkOpen(false)}>Cancel</button>
              <button className={`${btn} border-emerald-400/50 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30`} disabled={busy}
                onClick={remix}>FORK IT — IT BECOMES YOURS</button>
            </div>
          </div>
        </div>
      )}

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
