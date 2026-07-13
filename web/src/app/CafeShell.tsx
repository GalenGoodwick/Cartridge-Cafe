'use client'

import { useEffect, useRef, useState } from 'react'
import FieldEngine from '@/app/engine/FieldEngine'
import { startCafeAudio, setScene as setAudioScene, sfx, isMuted, setMuted } from '@/app/engine/cafe-audio'

const BLURBS: Record<string, string> = {
  'FABRIC': 'bend starlight',
  'ORRERY': 'grow a solar system',
  'GARNET': 'build a ship of crystals',
  'ONE DAY': 'a lighthouse keeps its whole day',
  'SAIL': 'one boat, real water',
  'SIGNAL': 'speak a world into being',
  'NOCTURNE': 'a night drive, neon and rain',
  'NOCTURNE DISTRICT': 'the city as a pinball table',
  'ESPER': 'stealth on the hex lattice',
  'TV': 'channels that compute themselves',
  'PROOF': 'a world that accumulates law',
  'HELIOS': 'carry the sun, hold for the moon',
  'LIGHTHOUSE': 'your cursor is the hour',
}

/** The world IS the interface. The only HTML: the sign, two small doors,
 *  and a name that appears at your cursor when a window notices you. */
export default function CafeShell({ initialScene = 'CAFE' }: { initialScene?: string }) {
  const [scene, setScene] = useState(initialScene)
  const [hint, setHint] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  const [mouse, setMouse] = useState({ x: 0, y: 0 })
  const [caption, setCaption] = useState<{ text: string; kind: string } | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [mute, setMute] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [brewStep, setBrewStep] = useState(0)          // 0 closed · 1 connect-AI · 2 name · 3 brief · 4 key
  const [brewName, setBrewName] = useState('')
  const [brewBrief, setBrewBrief] = useState('')
  const [brewToken, setBrewToken] = useState('')
  const [brewSlug, setBrewSlug] = useState('')
  const [brewErr, setBrewErr] = useState('')
  const [brewAi, setBrewAi] = useState(false)
  const [brewNamed, setBrewNamed] = useState(false)
  const [brewBriefed, setBrewBriefed] = useState(false)
  const brewSlugRef = useRef('')
  const activeTabRef = useRef(true)
  const claimRef = useRef<() => void>(() => {})
  const [portals, setPortals] = useState<{ name: string; x: number; y: number; r: number }[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [vp, setVp] = useState({ w: 0, h: 0 })
  const [mine, setMine] = useState<string | null>(null)   // display name while in your submain
  const [modalUp, setModalUp] = useState(false)           // an engine panel is open; overlays duck
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const captionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sceneRef = useRef(scene)
  sceneRef.current = scene
  const confirmRef = useRef(confirmLeave)
  confirmRef.current = confirmLeave
  const crumbRef = useRef<string[]>([])       // hubs we entered through, in order
  const skipCrumbRef = useRef(false)
  const portalsRef = useRef(portals)
  portalsRef.current = portals
  // scene changes drop in-flight portal events: the departing hub's hook can
  // tick a frame or two past go(), and its doors must not follow the player
  // into the next world. Hubs re-announce every 2s, so a dropped one returns.
  const portalsBlockRef = useRef(0)
  const pause = (on: boolean) => window.dispatchEvent(new CustomEvent('cafe:pause', { detail: on }))
  const openConfirm = () => { setConfirmLeave(true); pause(true) }
  const stay = () => { setConfirmLeave(false); pause(false) }

  /** MY WORLDS: the same universe, filtered to your own deeds — a personal submain.
   *  Sticky for the session: entering a world and coming back lands you here again. */
  const myWorlds = async () => {
    const sess = await fetch('/api/auth/session').then(r => r.json()).catch(() => null)
    if (!sess?.user) { window.location.href = '/auth/signin?callbackUrl=' + encodeURIComponent('/?mine=1'); return }
    ;(window as unknown as { __cafeMine?: unknown }).__cafeMine = { on: true, ownerId: sess.user.id, who: sess.user.name || '' }
    setMine(sess.user.name || 'your')
    try { sessionStorage.setItem('cafe-mine', '1') } catch { /* private mode */ }
  }
  const commons = () => {
    ;(window as unknown as { __cafeMine?: unknown }).__cafeMine = { on: false }
    setMine(null)
    try { sessionStorage.removeItem('cafe-mine') } catch { /* private mode */ }
  }

  /** BREW YOURS — in the order that matters: the world is born immediately
   *  (placeholder name), its first AI key is minted, and step 1 hands your AI
   *  the FULL connection prompt (key + guide + standby orders). Only after the
   *  AI has actually connected, the world is named, and the brief is delivered
   *  does ENTER WORLD unlock. */
  const connectPrompt = (token: string) => {
    const o = window.location.origin
    return `Connect to my cartridge.cafe world.
POST commands to ${o}/api/engine/bridge
Header: Authorization: Bearer ${token}

Before doing ANYTHING else:
1. GET ${o}/api/engine/guide and read it fully (markdown).
2. GET ${o}/api/engine/bridge (same auth header) to see the world state.
3. STAND BY. Do not build yet — I am writing your brief right now. It will
   appear in worldData.creation_brief. When it does: build exactly that,
   then set worldData.brief_done = true.
worldData.player_focus is what I have selected — always follow it.`
  }
  const brew = async () => {
    const sess = await fetch('/api/auth/session').then(r => r.json()).catch(() => null)
    if (!sess?.user) { window.location.href = '/auth/signin?callbackUrl=' + encodeURIComponent('/?brew=1'); return }
    setBrewErr(''); setBrewName(''); setBrewBrief('')
    setBrewAi(false); setBrewNamed(false); setBrewBriefed(false)
    // the world is born now, so its AI key can exist before anything else
    const r = await fetch('/api/spaces', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Untitled World', slug: 'w-' + Math.random().toString(36).slice(2, 8) }),
    })
    const d = await r.json()
    if (!r.ok || !d?.space?.slug) { window.alert(d?.error || 'could not brew'); return }
    brewSlugRef.current = d.space.slug
    setBrewSlug(d.space.slug)
    setBrewToken(d.token || '')
    setBrewStep(1)
  }
  // has the AI actually logged in? the token's lastUsedAt says so
  useEffect(() => {
    if (brewStep < 1 || brewAi) return
    const iv = setInterval(async () => {
      try {
        const d = await fetch('/api/spaces/' + brewSlugRef.current + '/token').then(r => r.json())
        if ((d.tokens || []).some((t: { lastUsedAt: string | null }) => t.lastUsedAt)) setBrewAi(true)
      } catch { /* keep waiting */ }
    }, 3000)
    return () => clearInterval(iv)
  }, [brewStep, brewAi])
  const brewSaveName = async () => {
    setBrewErr('')
    const r = await fetch('/api/spaces/' + brewSlugRef.current, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: brewName.trim(), slugFromName: true }),
    })
    const d = await r.json()
    if (!r.ok) { setBrewErr(d?.error || 'could not name it'); return }
    if (d?.space?.slug) { brewSlugRef.current = d.space.slug; setBrewSlug(d.space.slug) }
    setBrewNamed(true)
    setBrewStep(3)
  }
  const brewSaveBrief = async () => {
    setBrewErr('')
    const r = await fetch('/api/spaces/' + brewSlugRef.current, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: brewBrief.trim() }),
    })
    if (!r.ok) { setBrewErr('could not deliver the brief'); return }
    setBrewBriefed(true)
  }
  const brewCancel = async () => {
    // abandoning an unnamed world removes it — no junk on the shelf
    if (!brewNamed && brewSlugRef.current) {
      fetch('/api/spaces/' + brewSlugRef.current, { method: 'DELETE' }).catch(() => {})
    }
    setBrewStep(0)
  }

  const go = (name: string, push = true) => {
    // entering anywhere FROM a hub leaves a crumb — back climbs the trail
    if (!skipCrumbRef.current && portalsRef.current.length > 0 && name !== sceneRef.current) {
      crumbRef.current.push(sceneRef.current)
    }
    skipCrumbRef.current = false
    if (name !== sceneRef.current) { if (name === 'CAFE') sfx.leave(); else sfx.launch(name) }
    setAudioScene(name)
    setScene(name)
    setHover(null)
    setCaption(null)
    setConfirmLeave(false)
    setPortals([])
    portalsBlockRef.current = Date.now() + 600
    if (push && typeof window !== 'undefined') {
      window.history.pushState({ scene: name }, '', name === 'CAFE' ? '/' : `/play/${encodeURIComponent(name)}`)
    }
    if (name !== 'CAFE') {
      setHint(true)
      if (hintTimer.current) clearTimeout(hintTimer.current)
      hintTimer.current = setTimeout(() => setHint(false), 4000)
    }
  }

  useEffect(() => {
    startCafeAudio(initialScene)
    setMute(isMuted())
    const onLaunch = (e: Event) => {
      const name = (e as CustomEvent).detail
      if (typeof name !== 'string' || !name) return
      if (name.startsWith('space:')) { window.location.href = '/space/' + name.slice(6); return }
      go(name)
    }
    // returning from auth with brewing intent
    if (new URLSearchParams(window.location.search).get('brew')) {
      window.history.replaceState({}, '', '/')
      brew()
    }
    // returning from auth headed for your own submain
    if (new URLSearchParams(window.location.search).get('mine')) {
      window.history.replaceState({}, '', '/')
      myWorlds()
    } else {
      // still in your submain from earlier this session? re-enter it quietly —
      // no redirects here: a stale flag without a session just clears itself
      try {
        if (sessionStorage.getItem('cafe-mine')) {
          fetch('/api/auth/session').then(r => r.json()).then(sess => {
            if (sess?.user) {
              ;(window as unknown as { __cafeMine?: unknown }).__cafeMine = { on: true, ownerId: sess.user.id, who: sess.user.name || '' }
              setMine(sess.user.name || 'your')
            } else sessionStorage.removeItem('cafe-mine')
          }).catch(() => { /* offline is fine */ })
        }
      } catch { /* private mode */ }
    }
    const onHover = (e: Event) => setHover((e as CustomEvent).detail)
    // worlds can put a line of phosphor text on the glass — SIGNAL shows the word you type
    const onCaption = (e: Event) => {
      const d = (e as CustomEvent).detail as { text: string; kind: string } | null
      if (captionTimer.current) clearTimeout(captionTimer.current)
      if (!d || (!d.text && d.kind !== 'typing')) { setCaption(null); return }
      setCaption(d)
      if (d.kind !== 'typing') captionTimer.current = setTimeout(() => setCaption(null), d.kind === 'hint' ? 6000 : 3200)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || sceneRef.current === 'CAFE') return
      // leaving pauses the world and asks — a mid-game ESC costs nothing
      if (confirmRef.current) { setConfirmLeave(false); pause(false) }
      else { setConfirmLeave(true); pause(true) }
    }
    const onPop = () => {
      const m = window.location.pathname.match(/^\/play\/(.+)$/)
      go(m ? decodeURIComponent(m[1]) : 'CAFE', false)
    }
    const onMove = (e: PointerEvent) => setMouse({ x: e.clientX, y: e.clientY })
    const onPortals = (e: Event) => {
      if (Date.now() < portalsBlockRef.current) return   // a door slamming behind us
      setPortals((e as CustomEvent).detail || [])
    }
    const onModal = (e: Event) => setModalUp(!!(e as CustomEvent).detail)
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    onResize()
    window.addEventListener('cafe:launch', onLaunch)
    window.addEventListener('cafe:hover', onHover)
    window.addEventListener('cafe:caption', onCaption)
    window.addEventListener('keydown', onKey)
    window.addEventListener('popstate', onPop)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('cafe:portals', onPortals)
    window.addEventListener('cafe:modal', onModal)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('cafe:launch', onLaunch)
      window.removeEventListener('cafe:hover', onHover)
      window.removeEventListener('cafe:caption', onCaption)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('cafe:portals', onPortals)
      window.removeEventListener('cafe:modal', onModal)
      window.removeEventListener('resize', onResize)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // one table per player: the newest tab claims the seat; any other tab is
  // blocked (world paused, no heartbeats) until the player reclaims it there
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const tabId = Math.random().toString(36).slice(2)
    const bc = new BroadcastChannel('cc-tab')
    const claim = () => {
      activeTabRef.current = true
      setBlocked(false)
      pause(false)
      bc.postMessage({ type: 'claim', tabId })
    }
    claimRef.current = claim
    bc.onmessage = (e) => {
      if (e.data?.type === 'claim' && e.data.tabId !== tabId && activeTabRef.current) {
        activeTabRef.current = false
        setBlocked(true)
        pause(true)
      }
    }
    claim()
    return () => bc.close()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // presence: one heartbeat per person, one poll for the door counts
  useEffect(() => {
    let pid = ''
    try {
      // browser-level body: single-active-tab arbitration means only one tab
      // ever beats, so one id = one person = one place
      pid = localStorage.getItem('cc-pid') || Math.random().toString(36).slice(2, 12)
      localStorage.setItem('cc-pid', pid)
    } catch { pid = Math.random().toString(36).slice(2, 12) }
    const beat = () => {
      if (!activeTabRef.current) return   // blocked tabs are ghosts; they don't beat
      fetch('/api/presence', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene, id: pid }),
      }).catch(() => {})
    }
    const poll = () => {
      // chips live on any hub, not just the main cafe
      if (sceneRef.current !== 'CAFE' && portalsRef.current.length === 0) return
      fetch('/api/presence').then(r => r.ok ? r.json() : null)
        .then(d => d && setCounts(d.counts || {})).catch(() => {})
    }
    // the door count is a live thing: beat fast, and say goodbye on the way out
    const bye = () => {
      try { navigator.sendBeacon('/api/presence', JSON.stringify({ id: pid, leave: true })) } catch { /* gone anyway */ }
    }
    beat()
    poll()
    const pt = setTimeout(poll, 1500)   // chips refresh right after arriving
    const bi = setInterval(beat, 12000)
    const ci = setInterval(poll, 6000)
    window.addEventListener('pagehide', bye)
    return () => { clearInterval(bi); clearInterval(ci); clearTimeout(pt); window.removeEventListener('pagehide', bye) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  const inGame = scene !== 'CAFE'
  // uv → screen for the contain-fit square (span = min(w,h), centered)
  const span = Math.min(vp.w, vp.h)

  return (
    <>
      <FieldEngine playScene={scene} />

      {/* a name surfaces where you're looking, then gets out of the way */}
      {portals.length > 0 && hover && !modalUp && (mouse.x !== 0 || mouse.y !== 0) && (
        <div
          className="fixed z-50 pointer-events-none select-none rounded-xl bg-black/60 backdrop-blur-sm border border-brass/20 px-3.5 py-2.5"
          style={{ left: Math.min(mouse.x + 18, Math.max(0, vp.w - 250)), top: Math.max(8, mouse.y - 8) }}
        >
          <div className="cafe-sign text-xl leading-none">{hover.toLowerCase()}</div>
          <div className="font-mono text-[9px] tracking-[0.25em] text-crema/60 uppercase mt-1.5">
            {BLURBS[hover] || ''} · click to enter
          </div>
        </div>
      )}

      {/* who's inside: a head-count on every door */}
      {vp.w > 0 && !modalUp && portals.map(pt => {
        const n = counts[pt.name] || 0
        const px = vp.w / 2 + (pt.x + pt.r * 0.75) * span / 2
        const py = vp.h / 2 + (pt.y + pt.r * 0.75) * span / 2
        return (
          <div key={pt.name}
            className={`fixed z-40 pointer-events-none select-none font-mono text-[10px] rounded-full border px-1.5 py-0.5 backdrop-blur-sm ${n > 0 ? 'border-brass/60 bg-void/70 text-glow' : 'border-brass/20 bg-void/50 text-crema/30'}`}
            style={{ left: px, top: py, transform: 'translate(-50%, -50%)' }}>
            ◉ {n}
          </div>
        )
      })}

      {/* a world's OSD — old TV set lettering, top-left of the glass */}
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

      {/* the cafe's ears — one small switch, bottom-right */}
      <button
        onClick={() => { setMuted(!mute); setMute(!mute) }}
        aria-label={mute ? 'Unmute' : 'Mute'}
        className="fixed bottom-4 right-4 z-50 w-8 h-8 rounded-full border border-brass/40 bg-void/60 backdrop-blur-sm text-glow/60 hover:text-glow font-mono text-[11px] transition-colors"
      >
        {mute ? '∅' : '♪'}
      </button>

      {/* BREW: key first → name → brief → enter (all three gates) */}
      {brewStep > 0 && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-void/80 backdrop-blur-sm"
          onClick={brewCancel}>
          <div className="w-[480px] max-w-[94vw] border border-brass/40 rounded-xl px-7 py-6 bg-void/95 shadow-[0_0_60px_rgba(245,176,76,0.15)]"
            onClick={e => e.stopPropagation()}>
            <div className="flex gap-3 mb-4 font-mono text-[9px] tracking-[0.2em]">
              <span className={brewAi ? 'text-glow' : 'text-crema/40'}>{brewAi ? '✓' : '1'} AI CONNECTED</span>
              <span className={brewNamed ? 'text-glow' : 'text-crema/40'}>{brewNamed ? '✓' : '2'} NAMED</span>
              <span className={brewBriefed ? 'text-glow' : 'text-crema/40'}>{brewBriefed ? '✓' : '3'} BRIEFED</span>
            </div>
            {brewStep === 1 && (<>
              <div className="cafe-sign text-2xl mb-2">connect your AI</div>
              <div className="font-mono text-[10px] leading-relaxed text-crema/70 mb-3">
                Paste this to your AI — it logs in with the key, reads the guide,
                and stands by for your brief:
              </div>
              <div className="rounded-lg bg-black/60 border border-brass/30 px-3 py-2.5 font-mono text-[10px] leading-relaxed text-glow/90 whitespace-pre-wrap break-all select-all max-h-44 overflow-y-auto mb-3">
                {connectPrompt(brewToken)}
              </div>
              <div className="flex gap-2 items-center">
                <button onClick={() => navigator.clipboard?.writeText(connectPrompt(brewToken))}
                  className="flex-1 rounded-lg bg-flame/90 hover:bg-glow py-2 font-mono text-[10px] tracking-[0.15em] text-void transition-colors">
                  COPY CONNECTION PROMPT
                </button>
                <button onClick={() => setBrewStep(2)} className="flex-1 brass-tab py-2 text-[10px]">
                  {brewAi ? 'NEXT → NAME IT' : 'WAITING FOR AI… SKIP AHEAD'}
                </button>
              </div>
              <div className="font-mono text-[9px] tracking-[0.15em] mt-2 text-crema/40">
                {brewAi ? 'your AI is in the world, reading the guide' : 'watching for its first login…'}
              </div>
            </>)}
            {brewStep === 2 && (<>
              <div className="cafe-sign text-2xl mb-2">name your world</div>
              <input autoFocus value={brewName} onChange={e => setBrewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && brewName.trim()) brewSaveName() }}
                placeholder="e.g. Tidepool Abbey"
                className="w-full rounded-lg bg-black/50 border border-brass/30 px-3 py-2.5 font-mono text-sm text-glow outline-none focus:border-brass mb-3" />
              {brewErr && <div className="font-mono text-[10px] text-red-400 mb-2">{brewErr}</div>}
              <button disabled={!brewName.trim()} onClick={brewSaveName}
                className="w-full rounded-lg bg-flame/90 hover:bg-glow py-2.5 font-mono text-[11px] tracking-[0.15em] text-void transition-colors disabled:opacity-40">
                NEXT → THE BRIEF
              </button>
            </>)}
            {brewStep === 3 && (<>
              <div className="cafe-sign text-2xl mb-2">tell it what to build</div>
              <div className="font-mono text-[10px] tracking-wide text-crema/60 mb-3">
                delivered straight into the world — your AI builds THIS, not its own idea
              </div>
              <textarea autoFocus value={brewBrief} onChange={e => setBrewBrief(e.target.value)}
                placeholder="a tidepool at dusk; anemones open when my cursor is still; crabs argue over a pearl…"
                rows={4}
                className="w-full rounded-lg bg-black/50 border border-brass/30 px-3 py-2.5 font-mono text-xs text-glow outline-none focus:border-brass mb-3 resize-none" />
              {brewErr && <div className="font-mono text-[10px] text-red-400 mb-2">{brewErr}</div>}
              {!brewBriefed ? (
                <button disabled={!brewBrief.trim()} onClick={brewSaveBrief}
                  className="w-full rounded-lg bg-flame/90 hover:bg-glow py-2.5 font-mono text-[11px] tracking-[0.15em] text-void transition-colors disabled:opacity-40">
                  DELIVER THE BRIEF
                </button>
              ) : (
                <button disabled={!(brewAi && brewNamed && brewBriefed)}
                  onClick={() => { window.location.href = '/space/' + brewSlug }}
                  className="w-full rounded-lg bg-flame/90 hover:bg-glow py-2.5 font-mono text-[11px] tracking-[0.15em] text-void transition-colors disabled:opacity-40">
                  {brewAi ? 'ENTER WORLD' : 'WAITING FOR YOUR AI TO CONNECT…'}
                </button>
              )}
            </>)}
          </div>
        </div>
      )}

      {/* one table per player — this tab lost the seat */}
      {blocked && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-void/85 backdrop-blur-sm">
          <div className="border border-brass/40 rounded-xl px-8 py-6 text-center bg-void/95 shadow-[0_0_60px_rgba(245,176,76,0.15)]">
            <div className="cafe-sign text-2xl mb-1">you&rsquo;re seated elsewhere</div>
            <div className="font-mono text-[10px] tracking-[0.2em] text-crema/50 uppercase mb-5">
              the cafe allows one table at a time · this tab is paused
            </div>
            <button onClick={() => claimRef.current()}
              className="rounded-lg bg-flame/90 hover:bg-glow px-5 py-2 font-mono text-[11px] tracking-[0.15em] text-void transition-colors">
              PLAY HERE
            </button>
          </div>
        </div>
      )}

      {/* every level: a way back, top-left. It pauses and asks. */}
      {inGame && (
        <button
          onClick={() => (confirmLeave ? stay() : openConfirm())}
          aria-label="Back to the cafe"
          className="fixed top-4 left-4 z-50 w-9 h-9 rounded-full border border-brass/50 bg-void/70 backdrop-blur-sm text-glow/80 hover:text-glow hover:border-brass font-mono text-sm transition-colors"
        >
          ◂
        </button>
      )}
      {inGame && confirmLeave && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-void/60 backdrop-blur-[2px]"
          onClick={stay}>
          <div className="border border-brass/40 rounded-xl px-8 py-6 text-center bg-void/95 shadow-[0_0_60px_rgba(245,176,76,0.15)]"
            onClick={e => e.stopPropagation()}>
            <div className="cafe-sign text-2xl mb-1">leave this world?</div>
            <div className="font-mono text-[10px] tracking-[0.2em] text-crema/50 uppercase mb-5">
              the world is paused · your save keeps
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={stay}
                className="rounded-lg bg-flame/90 hover:bg-glow px-5 py-2 font-mono text-[11px] tracking-[0.15em] text-void transition-colors">
                STAY
              </button>
              <button onClick={() => { pause(false); skipCrumbRef.current = true; go(crumbRef.current.pop() || 'CAFE') }}
                className="brass-tab px-5 py-2 text-[11px]">
                LEAVE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* in a game: nothing but a hint that leaves */}
      {inGame && hint && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 font-mono text-[10px] tracking-[0.3em] text-glow/40 pointer-events-none select-none">
          ESC → CAFE
        </div>
      )}

      {/* the sign and two small doors — the only permanent chrome */}
      {!inGame && (
        <>
          <div className="fixed top-5 left-6 z-50 pointer-events-none select-none">
            <div className="cafe-sign text-2xl">
              cartridge<span className="not-italic font-mono text-base text-brass">.cafe</span>
            </div>
            <div className="font-mono text-[9px] tracking-[0.18em] text-glow/50 mt-1">
              Instant natural language to game world framework.
            </div>
            {mine && (
              <div className="font-mono text-[10px] tracking-[0.3em] text-brass uppercase mt-2">
                {mine}&apos;s worlds
              </div>
            )}
          </div>
          <div className="fixed top-5 right-6 z-50 flex gap-2">
            {mine ? (
              <button onClick={commons} className="rounded-lg border border-brass/40 hover:border-flame/60 px-3 py-1.5 font-mono text-[10px] tracking-[0.15em] text-steamer/80 hover:text-glow transition-all">
                ⟵ THE COMMONS
              </button>
            ) : (
              <button onClick={myWorlds} className="rounded-lg border border-brass/40 hover:border-flame/60 px-3 py-1.5 font-mono text-[10px] tracking-[0.15em] text-steamer/80 hover:text-glow transition-all">
                MY WORLDS
              </button>
            )}
            <button onClick={brew} className="rounded-lg bg-flame/90 hover:bg-glow px-3 py-1.5 font-mono text-[10px] tracking-[0.15em] text-void transition-colors">
              BREW YOURS
            </button>
          </div>
        </>
      )}
    </>
  )
}
