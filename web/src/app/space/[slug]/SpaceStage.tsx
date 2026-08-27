'use client'

import { usePresenceBeat } from '@/lib/usePresenceBeat'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import FieldEngine from '@/app/engine/FieldEngine'
import { WorldTopbar } from '@/app/engine/ui-topbar'
import ShareWorld from './ShareWorld'
import { useSolvedGrid, GridSlot } from '@/app/engine/GridChrome'
import { worldChromeUi } from '@/app/engine/ui-blocks'   // THE KEYSTONE: bands + perchers, engine-drawn
import { useShellHost } from '@/app/engine/useShellHost'
import FollowButton from './FollowButton'
import PremiumGate from './PremiumGate'
// (DockButton REMOVED — Galen, Aug 27: membership automatically allows editing
// open worlds; no dock ritual, no docking limit. The membership ask lives at
// the edit action itself, not a chrome button.)

/** The space page = the SAME engine dock a world uses (one unified chrome), plus
 *  the space-only PLUMBING that lives invisibly here: the delete / remix / flag
 *  flows. The dock's buttons dispatch window events (cafe:delete-world /
 *  cafe:remix-world / cafe:call-vote); this wrapper owns the modals + fetches.
 *  BRANCH PARADIGM RETIRED (Galen, Aug 2026): the in-world branch arena — the
 *  vote that competed MAIN vs a world's public branches — is gone. Remixing a
 *  world FORKS it (an owned playerSpace with forkOf lineage), never enters a
 *  challenger for a vote. SpaceToolbar is gone — /space and /play render one chrome. */
export default function SpaceStage({ spaceId, spaceSlug, gridSize, fit, engineOwner, isOwner, versionView, name, ownerName, ownerId, ownerHandle }: {
  spaceId: string
  spaceSlug: string
  gridSize?: number
  fit?: 'mobile' | 'desktop'
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

  // ─── THE CONVERSION (Galen, Aug 27: every world shows through the one new
  // UI). The world's chrome — back, title, PLAY/INSTRUCTIONS/FORK/EDIT rail,
  // BUILDERBOX — is composed here as ui-solver nodes (shellWorldUi) and drawn
  // BY THE ENGINE inside the world's own solve: real GPU pixels, one pass, the
  // eye sees everything. shell:* clicks come back on 'cafe:shell-ui'; engine
  // internals are commanded by name over 'cafe:shell-cmd' (the two-way seam).
  // Version views keep the old DOM row (read-only browsing).
  const [winDim, setWinDim] = useState<{ w: number; h: number }>({ w: 9999, h: 800 })
  useEffect(() => {
    const m = () => setWinDim({ w: window.innerWidth, h: window.innerHeight })
    m(); window.addEventListener('resize', m)
    return () => window.removeEventListener('resize', m)
  }, [])
  const engineShell = useMemo(() => {
    if (versionView != null) return null
    return worldChromeUi({
      title: name, sub: 'MAIN - LIVE',
      instance: winDim.w < 700 ? 'phone' : 'desktop',
      isOwner, window: winDim,
    })
  }, [name, winDim, isOwner, versionView])
  // THE ONE SHELL HOST (shared with the conversion proof — never a copy)
  useShellHost({ onBack: () => router.push('/') })

  // THE DESKTOP DOOR (targets matrix, other half of the phone frame): a world
  // declaring worldData.fit='desktop' is built for a wide screen + fine pointer.
  // A phone visitor gets an honest notice AT THIS WORLD'S DOOR (per Galen's
  // ruling: the wall lives at the door, per-world — never at the site gate) with
  // copy-link + step-in-anyway. Absorbed later by the unified system as a plan
  // verdict (worldSolve.supported); this is the same declaration, DOM-served.
  const [desktopDoor, setDesktopDoor] = useState(false)
  const [doorCopied, setDoorCopied] = useState(false)
  useEffect(() => {
    if (fit !== 'desktop') return
    try {
      if (sessionStorage.getItem('cc-door-' + spaceSlug) === '1') return
      const phone = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 700
      if (phone) setDesktopDoor(true)
    } catch { /* private mode: no notice */ }
  }, [fit, spaceSlug])
  const stepIn = () => { setDesktopDoor(false); try { sessionStorage.setItem('cc-door-' + spaceSlug, '1') } catch { /* fine */ } }

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

  // (deleteWorld REMOVED — deletion lives on /mine with the game list; Galen Aug 27)

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
    // INSTANT FORK (Galen: the prompt box was in the way) — the copy lands in
    // your inventory and opens with the AI terminal; the contract is declared
    // once, later, from the terminal (first-set immutability).
    const onRemix = () => { remix() }
    const onVote = () => { setFlagReason(''); setFlagOpen(true) }
    window.addEventListener('cafe:remix-world', onRemix)
    window.addEventListener('cafe:call-vote', onVote)
    return () => {
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

  // THE PHONE FRAME (Galen, Aug 26: "mobile on desktop needs to be in a mobile
  // bound window"). A world declaring worldData.fit=mobile is built for a
  // portrait phone; on a wide desktop viewport it would sprawl landscape and its
  // UI collide with the site's own toolbar. So we LETTERBOX the engine into a
  // centered portrait column (the FieldEngine `viewport` inset prop already
  // shrinks its root) and let the dark margins hold the site chrome. On an
  // actual phone (already-narrow / portrait) the frame is a no-op — full screen.
  const [phoneInset, setPhoneInset] = useState<{ top: number; right: number; bottom: number; left: number } | null>(null)
  // the solver's window = THE CHROME COLUMN (the wrapper below is a containing
  // block at this rect, so slot fixed-positioning is column-relative)
  const [colDims, setColDims] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const m = () => setColDims({
      w: window.innerWidth - (phoneInset ? phoneInset.left + phoneInset.right : 0),
      h: window.innerHeight - (phoneInset ? phoneInset.top + phoneInset.bottom : 0),
    })
    m(); window.addEventListener('resize', m)
    return () => window.removeEventListener('resize', m)
  }, [phoneInset])
  const gridSolved = useSolvedGrid(colDims)
  useEffect(() => {
    if (fit !== 'mobile' || versionView != null) { setPhoneInset(null); return }
    const measure = () => {
      const W = window.innerWidth, H = window.innerHeight
      // portrait phone target: 9:19.5. Only frame when the screen is WIDER than a
      // phone would be — i.e. there's real margin to reclaim. Narrow screens run full-bleed.
      const frameW = Math.min(W, Math.round(H * 9 / 19.5), 480)
      if (W - frameW < 80) { setPhoneInset(null); return }   // already ~phone-width — no frame
      const side = Math.round((W - frameW) / 2)
      setPhoneInset({ top: 0, bottom: 0, left: side, right: side })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [fit, versionView])

  // CHROME.TOPBAR (DESIGN-ui-grid rung 3, universalized): the top band is ONE
  // bar (◂ · FocusChip · ⚓ DOCK) at every width — a tenant of chrome.topbar,
  // placed by the solver against the column. Version views keep the engine's
  // own read-only title row (the bar's mutations don't apply there).
  const barOn = versionView == null

  return (
    <>
      {/* THE DESKTOP DOOR — a phone at a desktop-built world's door. Honest,
          per-world, dismissible; the world loads behind it either way. */}
      {desktopDoor && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6"
          style={{ background: 'radial-gradient(120% 90% at 50% 40%, rgba(23,16,11,0.96) 0%, rgba(11,9,8,0.97) 70%)', fontFamily: 'var(--font-mono, monospace)' }}>
          <div className="max-w-[360px] w-full text-center rounded-2xl px-7 py-9"
            style={{ border: '1px solid rgba(185,122,42,0.35)', background: 'rgba(11,9,8,0.85)', boxShadow: '0 0 80px rgba(245,176,76,0.12)', color: '#e7dcc8' }}>
            <div className="text-[44px] mb-3">🖥️</div>
            <div className="text-[26px] mb-3" style={{ fontFamily: 'var(--font-display, serif)', fontStyle: 'italic', color: '#ffdba8' }}>
              this world wants a bigger table
            </div>
            <p className="text-[14px] leading-relaxed m-0" style={{ color: '#c9b896' }}>
              <b style={{ color: '#ffdba8' }}>{name}</b> was built for a desktop screen —
              its maker tagged it that way. It may sprawl or fight your thumbs here.
            </p>
            <button
              onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); setDoorCopied(true); setTimeout(() => setDoorCopied(false), 1600) } catch { /* fine */ } }}
              className="mt-5 w-full px-4 py-2.5 rounded-xl text-[13px] tracking-[0.12em]"
              style={{ border: '1px solid rgba(185,122,42,0.5)', background: 'rgba(185,122,42,0.14)', color: '#ffdba8' }}>
              {doorCopied ? 'LINK COPIED ✓' : '⧉ COPY LINK — OPEN ON YOUR COMPUTER'}
            </button>
            <button onClick={stepIn}
              className="mt-2.5 w-full px-4 py-2.5 rounded-xl text-[13px] tracking-[0.15em]"
              style={{ border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(201,184,150,0.75)' }}>
              STEP IN ANYWAY
            </button>
          </div>
        </div>
      )}
      {/* the phone-frame margins: dark bands + a hairline bezel so the letterboxed
          mobile world reads as a device window, not a broken half-screen */}
      {phoneInset && (
        <div aria-hidden className="fixed inset-0 z-[5] pointer-events-none">
          <div className="absolute inset-y-0 left-0 bg-[#07060a]" style={{ width: phoneInset.left }} />
          <div className="absolute inset-y-0 right-0 bg-[#07060a]" style={{ width: phoneInset.right }} />
          <div className="absolute inset-y-0 border-x border-[#b97a2a]/25"
            style={{ left: phoneInset.left, right: phoneInset.right }} />
        </div>
      )}
      {/* THE CHROME COLUMN (Galen, Aug 26 — the phone-frame seam completion).
          SpaceStage's chrome (SHARE/PREMIUM/DOCK/FOLLOW) is fixed-positioned to
          the SCREEN, but the world is letterboxed into the phone column — so
          without this the buttons float at the screen edges, colliding with the
          title and sprawling outside the frame (the "UI on the wrong layer" bug).
          A `transform` on this wrapper makes it the CONTAINING BLOCK for its
          fixed children, so their `fixed ... right-4` resolves against the PHONE
          COLUMN, not the viewport. No phone frame → full-screen passthrough. */}
      <div
        className="fixed z-[60] pointer-events-none"
        style={phoneInset
          ? { top: phoneInset.top, right: phoneInset.right, bottom: phoneInset.bottom, left: phoneInset.left, transform: 'translateZ(0)' }
          : { inset: 0 }}
      >
        {/* nothing to share on a world that isn't real yet — hide SHARE while it's
            still blank-and-building. RUNG 2 (ui-grid): SHARE is the FIRST
            PERCHER placed BY THE SOLVER — its rect comes from the platform
            doc's chrome.bottombar.right region, solved against this chrome
            column (the wrapper is the containing block, so fixed = column-
            relative). Placement edits happen in ui-grid-doc.ts, never here. */}
        {!playMode && (
          <GridSlot region="chrome.bottombar.right" gravity="right" solved={gridSolved}>
            {/* TENANTS #1+#2 — the slot owns the row; the grid owns the slot */}
            <span className="mr-2"><FollowButton handle={ownerHandle} isOwner={isOwner} /></span>
            {!building && <ShareWorld slug={spaceSlug} name={name} />}
          </GridSlot>
        )}
        {/* PREMIUM GAMES: the demo meter + paywall — renders nothing on free
            worlds and for owners/buyers (server truth: /api/premium) */}
        {!versionView && <PremiumGate slug={spaceSlug} name={name} />}
        {/* THE TOP BAR — THE CONVERSION: the ENGINE draws it now (shellWorldUi
            back+title pills through the world's own solve). The DOM bar remains
            ONLY for version views (read-only browsing keeps its own row). */}
        {barOn && !playMode && versionView != null && (
          <GridSlot region="chrome.topbar" gravity="left" solved={gridSolved}>
            <WorldTopbar slug={spaceSlug} name={name} ownerName={ownerName} ownerHandle={ownerHandle} ownerId={ownerId}
              isOwner={isOwner} versionView={versionView}
              dock={null} />
          </GridSlot>
        )}
        {/* (FOLLOW moved into the bottombar slot above — tenant #2; DOCK IN
            roosts in the top bar — no standalone pill mount remains) */}
      </div>
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
        frame={phoneInset}
        externalTopbar={barOn}
        shellUi={engineShell}
      />

      {/* BRANCH ARENA REMOVED (branch→fork transition): a world no longer hosts a
          vote between MAIN and its public branches. Remixing forks the world into
          the remixer's own owned playerSpace; there is no in-world challenger vote. */}

      {/* a world's OSD — captions/hints, restored from SpaceToolbar */}
      {caption && (caption.text || caption.kind === 'typing') && (
        <div className={`fixed ${barOn && !playMode ? 'top-[9vh] left-4' : 'top-8 left-10'} z-50 pointer-events-none select-none font-mono uppercase tracking-[0.3em]`}
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

      {/* (delete confirm modal REMOVED — deletion lives on /mine; Galen Aug 27) */}

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
