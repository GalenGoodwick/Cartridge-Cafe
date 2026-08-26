'use client'

import { usePresenceBeat } from '@/lib/usePresenceBeat'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import FieldEngine from '@/app/engine/FieldEngine'
import ShareWorld from './ShareWorld'
import FollowButton from './FollowButton'
import PremiumGate from './PremiumGate'
import DockButton from './DockButton'

/** The space page = the SAME engine dock a world uses (one unified chrome), plus
 *  the space-only PLUMBING that lives invisibly here: the delete / remix / flag
 *  flows. The dock's buttons dispatch window events (cafe:delete-world /
 *  cafe:remix-world / cafe:call-vote); this wrapper owns the modals + fetches.
 *  BRANCH PARADIGM RETIRED (Galen, Aug 2026): the in-world branch arena — the
 *  vote that competed MAIN vs a world's public branches — is gone. Remixing a
 *  world FORKS it (an owned playerSpace with forkOf lineage), never enters a
 *  challenger for a vote. SpaceToolbar is gone — /space and /play render one chrome. */
export default function SpaceStage({ spaceId, spaceSlug, gridSize, engineOwner, isOwner, versionView, name, ownerName, ownerId, ownerHandle }: {
  spaceId: string
  spaceSlug: string
  gridSize?: number
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
      const r = await fetch(`/api/spaces/${encodeURIComponent(spaceSlug)}/fork`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      const d = await r.json()
      if (r.ok) { window.location.href = `/space/${d.space.slug}?connect=1` }
      else flash(d.error || 'Fork failed (sign in?)')
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
    // INSTANT FORK (Galen: the prompt box was in the way) — the copy lands in
    // your inventory and opens with the AI terminal; the contract is declared
    // once, later, from the terminal (first-set immutability).
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

  // ── THE EXIT GATE (Galen, Aug 20): ESC or back — the engine's ◂ AND the
  //    browser's own back button — asks before leaving ANY world. The hub has
  //    paused-and-asked since forever (CafeShell's confirmLeave); this brings
  //    the same dialog to standalone /space pages. cafe:pause freezes the
  //    world under the dialog, so a mid-game ESC costs nothing.
  const [confirmLeave, setConfirmLeave] = useState(false)
  const confirmLeaveRef = useRef(confirmLeave); confirmLeaveRef.current = confirmLeave
  const pauseWorld = (on: boolean) => window.dispatchEvent(new CustomEvent('cafe:pause', { detail: on }))
  const openLeave = useCallback(() => { setConfirmLeave(true); pauseWorld(true) }, [])
  const stayHere = useCallback(() => { setConfirmLeave(false); pauseWorld(false) }, [])
  const leaveWorld = useCallback(() => {
    pauseWorld(false)
    // same up-never-back rule as the engine's ◂: a branch goes to its base
    // world's room, a world without lineage goes to the cafe (history.back()
    // would walk ?version=N entries — the direct-join trap)
    const base = (name || '').split(' ⑂ ')[0].trim()
    window.location.href = base && base !== (name || '').trim() ? `/hub/${encodeURIComponent(base)}` : '/'
  }, [name])

  // ESC → the gate. Bubble phase on purpose: the engine's capture-phase handler
  // closes its own open panels first and stops propagation, so ESC only reaches
  // here when no panel is up. An open reckoning closes first (one layer at a
  // time — exactly the hub's ◂ law).
  useEffect(() => {
    if (versionView) return                       // version views are read-only visits
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return   // ESC in a field just blurs it
      if (confirmLeaveRef.current) stayHere()
      else openLeave()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [versionView, openLeave, stayHere])

  // the engine's ◂ asks us first (cancelable cafe:back); preventDefault = we own it
  useEffect(() => {
    if (versionView) return
    const onBack = (e: Event) => {
      e.preventDefault()
      if (confirmLeaveRef.current) stayHere(); else openLeave()
    }
    window.addEventListener('cafe:back', onBack)
    return () => window.removeEventListener('cafe:back', onBack)
  }, [versionView, openLeave, stayHere])

  // BROWSER BACK → the gate. Mark the entry we arrived on as the gate floor and
  // stand on a pushed twin; popping INTO the floor opens the dialog and re-arms.
  // Version-stepping pushes its own ?version=N entries ABOVE the twin, so backing
  // through those never trips the gate (their popstate state isn't the floor's).
  // States are MERGED over history.state so Next's router keys survive.
  useEffect(() => {
    if (versionView) return
    try {
      const s = window.history.state || {}
      window.history.replaceState({ ...s, cafeWorldGate: 1 }, '')
      window.history.pushState({ ...s, cafeWorldTop: 1 }, '')
    } catch { /* sandboxed iframe etc. — gate just won't arm */ }
    const onPop = (e: PopStateEvent) => {
      if (!(e.state && (e.state as { cafeWorldGate?: number }).cafeWorldGate)) return
      // we landed on the floor — re-arm the twin and ask
      try { window.history.pushState({ ...(e.state || {}), cafeWorldGate: undefined, cafeWorldTop: 1 }, '') } catch { /* ignore */ }
      openLeave()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [versionView, openLeave])

  return (
    <>
      {/* nothing to share on a world that isn't real yet — hide SHARE while it's
          still blank-and-building */}
      {!building && !playMode && <ShareWorld slug={spaceSlug} name={name} />}
      {/* PREMIUM GAMES: the demo meter + paywall — renders nothing on free
          worlds and for owners/buyers (server truth: /api/premium) */}
      {!versionView && <PremiumGate slug={spaceSlug} name={name} />}
      {/* DOCK: join a node-founded world's live edit flow (membership + a
          dockstar). Renders nothing for owners / non-node worlds / play-only. */}
      {!versionView && !playMode && !isOwner && <DockButton slug={spaceSlug} name={name} />}
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
        gridSize={gridSize}
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

      {/* the exit gate's ask — same sign the hub shows, one dialog per site */}
      {confirmLeave && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-[2px]" onClick={stayHere}>
          <div className="border border-[#b97a2a]/40 rounded-xl px-8 py-6 text-center bg-black/95 shadow-[0_0_60px_rgba(245,176,76,0.15)]" onClick={e => e.stopPropagation()}>
            <div className="cafe-sign text-2xl mb-1">leave this world?</div>
            <div className="font-mono text-[14px] tracking-[0.2em] text-white/50 uppercase mb-5">the world is paused · your save keeps</div>
            <div className="flex gap-3 justify-center">
              <button onClick={stayHere} className="rounded-lg bg-amber-500/90 hover:bg-amber-400 px-5 py-2 font-mono text-[16px] tracking-[0.15em] text-black transition-colors">STAY</button>
              <button onClick={leaveWorld} className="rounded-lg border border-white/25 hover:bg-white/10 px-5 py-2 font-mono text-[16px] tracking-[0.15em] text-white/80 transition-colors">EXIT WORLD</button>
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
