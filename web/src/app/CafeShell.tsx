'use client'

import { useEffect, useRef, useState } from 'react'
import FieldEngine from '@/app/engine/FieldEngine'
import TournamentBar from '@/app/TournamentBar'
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
  'HELIOS': 'carry the sun — a story in chapters',
  'LIGHTHOUSE': 'your cursor is the hour',
}

/** The world IS the interface. The only HTML: the sign, two small doors,
 *  and a name that appears at your cursor when a window notices you. */
export default function CafeShell({ initialScene = 'CAFE' }: { initialScene?: string }) {
  const [scene, setScene] = useState(initialScene)
  const [hint, setHint] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  const hoverBlockRef = useRef(0)
  const hoverAtRef = useRef(0)
  // a tooltip lives only as long as the world keeps affirming it (the cafe
  // heartbeats hover twice a second) — unaffirmed names expire in 1.4s
  useEffect(() => {
    const iv = setInterval(() => {
      setHover(prev => (prev && Date.now() - hoverAtRef.current > 1400) ? null : prev)
    }, 400)
    return () => clearInterval(iv)
  }, [])
  const [mouse, setMouse] = useState({ x: 0, y: 0 })
  const [caption, setCaption] = useState<{ text: string; kind: string } | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [mute, setMute] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [brewStep, setBrewStep] = useState(0)          // 0 closed · 1 open (single panel, gates unlock in place)
  const [brewName, setBrewName] = useState('')
  const [brewBrief, setBrewBrief] = useState('')
  const [brewToken, setBrewToken] = useState('')
  const [brewSlug, setBrewSlug] = useState('')
  const [brewErr, setBrewErr] = useState('')
  const [brewAi, setBrewAi] = useState(false)
  const [brewNameOk, setBrewNameOk] = useState<boolean | null>(null)   // null = unchecked/too short · true/false = unique?
  const [brewChecking, setBrewChecking] = useState(false)
  const brewSlugRef = useRef('')
  const brewFinalizedRef = useRef(false)
  const activeTabRef = useRef(true)
  const claimRef = useRef<() => void>(() => {})
  const [portals, setPortals] = useState<{ name: string; x: number; y: number; r: number }[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [vp, setVp] = useState({ w: 0, h: 0 })
  const [mine, setMine] = useState<string | null>(null)   // display name while in your submain
  const [modalUp, setModalUp] = useState(false)           // an engine panel is open; overlays duck
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const captionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // the group layer: the SUB-MAIN world reports where we stand (viewer or
  // inside a group) and the shell draws FOUND / JOIN / PIN accordingly
  const [subMode, setSubMode] = useState<{ mode: string; slug: string | null; name: string | null; haveOwn: boolean; member: boolean; owner?: boolean; pinsLocked?: boolean; members?: Record<string, string>; shelf?: string[] } | null>(null)
  const [subTools, setSubTools] = useState(false)          // founder's moderation panel
  const [who, setWho] = useState<{ id: string; name: string } | null>(null)

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
  // deliberation mode: the MAIN arena bar docks to the player and rides into
  // worlds so they can see what they're voting on. The roster is frozen from
  // main's doors (worlds' own portals must not become contestants), and every
  // name→launch pair ever announced is kept so travel works from anywhere.
  const [docked, setDocked] = useState(false)
  const [mainRoster, setMainRoster] = useState<string[]>([])
  const launchMapRef = useRef<Record<string, string>>({})
  const travelTo = (name: string) => {
    window.dispatchEvent(new CustomEvent('cafe:launch', { detail: launchMapRef.current[name] || name }))
  }
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

  /** ── the group layer's pen: read-modify-write the sub-mains index.
   *  v0 truth model — a save-slot doc, last-write-wins, reconciled here,
   *  same law as the tournament until enforcement moves server-side. */
  type SubEntry = { name: string; ownerId: string; ownerName: string; founded: number; members: Record<string, string>; shelf: Record<string, { launch: string; addedBy: string; at: number }>; pinsLocked?: boolean }
  /** Optimistic write loop: stamp the doc, write, read back. If someone else
   *  wrote in between (their stamp shows instead), replay our mutation on
   *  THEIR state — concurrent pins/joins merge instead of erasing each other. */
  const mutateSubs = async (fn: (subs: Record<string, SubEntry>) => string | null): Promise<boolean> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const j = await fetch('/api/engine/save?slot=' + encodeURIComponent('submains:index')).then(r => r.json()).catch(() => null)
      const d = (j?.data && j.data.v === 1 && j.data.subs)
        ? j.data as { v: 1; subs: Record<string, SubEntry>; stamp?: string }
        : { v: 1 as const, subs: {} as Record<string, SubEntry>, stamp: undefined as string | undefined }
      const err = fn(d.subs)
      if (err) { window.alert(err); return false }
      const stamp = Math.random().toString(36).slice(2)
      d.stamp = stamp
      await fetch('/api/engine/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: 'submains:index', data: d }),
      }).catch(() => {})
      await new Promise(res => setTimeout(res, 350))
      const back = await fetch('/api/engine/save?slot=' + encodeURIComponent('submains:index')).then(r => r.json()).catch(() => null)
      if (back?.data?.stamp === stamp) {
        // the shelf changed — wake the door now, don't wait out its poll
        ;(window as unknown as { __cafePoke?: number }).__cafePoke = Date.now()
        return true
      }
    }
    window.alert('the shelf is busy — try once more')
    return false
  }

  /** FOUND YOURS — one sub-main per person, named at birth */
  const foundSub = async () => {
    if (!who) { window.location.href = '/auth/signin?callbackUrl=' + encodeURIComponent('/play/SUB-MAIN'); return }
    const name = window.prompt('Name your sub-main:')
    if (!name?.trim()) return
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    if (!slug) return
    const ok = await mutateSubs(subs => {
      if (Object.values(subs).some(s => s.ownerId === who.id)) return 'you already founded a sub-main — one per person'
      if (subs[slug]) return 'that name is taken'
      subs[slug] = { name: name.trim(), ownerId: who.id, ownerName: who.name, founded: Date.now(), members: { [who.id]: who.name }, shelf: {} }
      return null
    })
    if (ok) (window as unknown as { __cafeSub?: string | null }).__cafeSub = slug   // step inside
  }

  const joinSub = async () => {
    const slug = subMode?.slug
    if (!who || !slug) return
    await mutateSubs(subs => {
      const s = subs[slug]
      if (!s) return 'this sub-main dissolved'
      s.members[who.id] = who.name
      return null
    })
  }

  /** members pin worlds (or spaces) onto the group's shelf by name */
  const pinWorld = async () => {
    const slug = subMode?.slug
    if (!who) { window.alert('sign in to pin'); return }
    if (!slug) { window.alert('step inside a sub-main first — pins land on its shelf'); return }
    const name = window.prompt('Pin which world? (its name on main)')
    if (!name?.trim()) return
    const target = name.trim().toUpperCase()
    const [sc, sp] = await Promise.all([
      fetch('/api/engine/scene?action=list').then(r => r.json()).catch(() => ({ scenes: [] })),
      fetch('/api/spaces/browse').then(r => r.json()).catch(() => ({ spaces: [] })),
    ])
    let launch: string | null = ((sc.scenes || []) as string[]).find(n => n.toUpperCase() === target) || null
    if (!launch) {
      const s = ((sp.spaces || []) as { name?: string; slug: string }[]).find(s2 => (s2.name || s2.slug).toUpperCase() === target)
      if (s) launch = 'space:' + s.slug
    }
    if (!launch) { window.alert('no world by that name on the shelf'); return }
    await mutateSubs(subs => {
      const s = subs[slug]
      if (!s) return 'this sub-main dissolved'
      if (!s.members[who.id]) return 'join first — only members pin'
      if (s.pinsLocked && s.ownerId !== who.id) return 'the founder closed the shelf — pinning is founder-only right now'
      s.shelf[target] = { launch: launch as string, addedBy: who.name, at: Date.now() }
      return null
    }).then(ok => {
      if (ok) window.dispatchEvent(new CustomEvent('cafe:caption', { detail: { text: 'pinned ' + target, kind: 'tuned' } }))
    })
  }

  /** ── founder moderation: kick members, unpin worlds, open/close the shelf ── */
  const kickMember = async (uid: string) => {
    const slug = subMode?.slug
    if (!who || !slug) return
    await mutateSubs(subs => {
      const s = subs[slug]
      if (!s) return 'this sub-main dissolved'
      if (s.ownerId !== who.id) return 'only the founder moderates'
      if (uid === s.ownerId) return 'the founder cannot kick themselves'
      delete s.members[uid]
      return null
    })
  }
  const unpinWorld = async (name: string) => {
    const slug = subMode?.slug
    if (!who || !slug) return
    await mutateSubs(subs => {
      const s = subs[slug]
      if (!s) return 'this sub-main dissolved'
      if (s.ownerId !== who.id) return 'only the founder moderates'
      delete s.shelf[name]
      return null
    })
  }
  const togglePins = async () => {
    const slug = subMode?.slug
    if (!who || !slug) return
    await mutateSubs(subs => {
      const s = subs[slug]
      if (!s) return 'this sub-main dissolved'
      if (s.ownerId !== who.id) return 'only the founder sets the rules'
      s.pinsLocked = !s.pinsLocked
      return null
    })
  }

  /** BREW YOURS — the world is born immediately (placeholder name) so its first
   *  AI key exists up front. The player names it, writes the brief, then hands
   *  the AI this connection prompt (key + guide + standby orders). The AI
   *  logging in is the trigger: we deliver name+brief and open the world. */
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
worldData.player_focus is what I have selected — always follow it.
You may open your world's page in your own (headless) browser as your eyes —
GET the bridge URL and use space.viewUrl (it can change when I name the world).
Your view is yours: it never takes my seat and never counts in head-counts.`
  }
  const brew = async () => {
    const sess = await fetch('/api/auth/session').then(r => r.json()).catch(() => null)
    if (!sess?.user) { window.location.href = '/auth/signin?callbackUrl=' + encodeURIComponent('/?brew=1'); return }
    setBrewErr(''); setBrewName(''); setBrewBrief('')
    setBrewAi(false); setBrewNameOk(null); setBrewChecking(false)
    brewFinalizedRef.current = false
    // sweep my own abandoned drafts first — unnamed, unbuilt, invisible
    try {
      const b = await fetch('/api/spaces/browse').then(r2 => r2.json())
      for (const sp of (b.spaces || [])) {
        if (sp.owner?.id === sess.user.id && sp.blank && sp.name === 'Untitled World') {
          await fetch('/api/spaces/' + sp.slug, { method: 'DELETE' }).catch(() => {})
        }
      }
    } catch { /* best effort */ }
    // a DRAFT is born now — private, off every shelf — so its AI key can
    // exist before anything else. ENTER WORLD is what makes it a world.
    const r = await fetch('/api/spaces', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Untitled World', slug: 'w-' + Math.random().toString(36).slice(2, 8), draft: true }),
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
    }, 1200)
    return () => clearInterval(iv)
  }, [brewStep, brewAi])
  // GATE 1 — the name unlocks the brief only when it's 5–20 chars AND unique.
  // Debounced check against the derived slug; deleting below 5 chars re-locks.
  const nameTrim = brewName.trim()
  const nameLenOk = nameTrim.length >= 5 && nameTrim.length <= 20
  const nameValid = nameLenOk && brewNameOk === true
  useEffect(() => {
    if (brewStep < 1) return
    const n = brewName.trim()
    if (n.length < 5 || n.length > 20) { setBrewNameOk(null); setBrewChecking(false); return }
    setBrewChecking(true)
    const t = setTimeout(async () => {
      try {
        const d = await fetch('/api/spaces/name-check?name=' + encodeURIComponent(n) + '&self=' + encodeURIComponent(brewSlug))
          .then(r => r.json())
        setBrewNameOk(!!d.available)
      } catch { setBrewNameOk(null) }
      setBrewChecking(false)
    }, 400)
    return () => clearTimeout(t)
  }, [brewName, brewSlug, brewStep])
  // GATE 2 — the brief unlocks CONNECT at 100 chars (max 500). GATE 3 is the AI
  // itself: when it logs in with a ready name+brief, we deliver the whole brief,
  // open the world, and the panel closes (enterWorld redirects).
  const briefLen = brewBrief.trim().length
  const connectReady = nameValid && briefLen >= 100 && briefLen <= 500
  useEffect(() => {
    if (!brewAi || brewFinalizedRef.current || !connectReady) return
    brewFinalizedRef.current = true
    setBrewErr('')
    ;(async () => {
      const r = await fetch('/api/spaces/' + brewSlugRef.current, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: brewName.trim(), slugFromName: true, brief: brewBrief.trim() }),
      }).catch(() => null)
      const d = await r?.json().catch(() => null)
      if (!r || !r.ok) { brewFinalizedRef.current = false; setBrewErr(d?.error || 'could not open the world'); return }
      if (d?.space?.slug) { brewSlugRef.current = d.space.slug; setBrewSlug(d.space.slug) }
      enterWorld()
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brewAi, connectReady])
  /** all gates passed and the AI has begun — the draft becomes a world.
   *  It joins main automatically (public spaces are shelf bubbles), and if
   *  you founded a sub-main it lands on your shelf there too. */
  const enterWorld = async () => {
    await fetch('/api/spaces/' + brewSlugRef.current, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPublic: true }),
    }).catch(() => {})
    if (who && brewName.trim()) {
      await mutateSubs(subs => {
        const mineSub = Object.keys(subs).find(k => subs[k].ownerId === who.id)
        if (!mineSub) return null
        subs[mineSub].shelf[brewName.trim().toUpperCase()] =
          { launch: 'space:' + brewSlugRef.current, addedBy: who.name, at: Date.now() }
        return null
      }).catch(() => {})
    }
    window.location.href = '/space/' + brewSlugRef.current
  }
  const brewCancel = async () => {
    setBrewStep(0)
    // backing out removes the draft — unless the AI already built something,
    // in which case it survives as a private draft (find it in MY WORLDS)
    const slug = brewSlugRef.current
    if (!slug) return
    try {
      const b = await fetch('/api/spaces/browse').then(r => r.json())
      const mine2 = ((b.spaces || []) as { slug: string; blank?: boolean }[]).find(sp => sp.slug === slug)
      if (mine2 && mine2.blank) fetch('/api/spaces/' + slug, { method: 'DELETE' }).catch(() => {})
    } catch { /* the sweep will catch it */ }
  }
  const brewCancelRef = useRef(brewCancel)
  brewCancelRef.current = brewCancel
  const brewStepRef = useRef(brewStep)
  brewStepRef.current = brewStep

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
    hoverBlockRef.current = Date.now() + 250   // swallow the dying frame's stale hover (expiry is the real safety net)
    setCaption(null)
    setConfirmLeave(false)
    setModalUp(false)   // a panel left open in the old world must not latch shut the new one
    setPortals([])
    portalsBlockRef.current = Date.now() + 600
    if (name !== 'SUB-MAIN') {   // leaving the group layer resets it to the viewer
      ;(window as unknown as { __cafeSub?: string | null }).__cafeSub = null
      setSubMode(null)
    }
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
      if (name.startsWith('sub:')) {
        // entering a group is an in-scene morph, not a departure — the
        // SUB-MAIN world repolls its roster off this flag on its next frame
        ;(window as unknown as { __cafeSub?: string | null }).__cafeSub = name.slice(4)
        return
      }
      go(name)
    }
    // returning from auth with brewing intent
    if (new URLSearchParams(window.location.search).get('brew')) {
      window.history.replaceState({}, '', '/')
      brew()
    }
    // the Cafe button means the commons — explicit intent beats stickiness
    if (new URLSearchParams(window.location.search).get('commons')) {
      window.history.replaceState({}, '', '/')
      try { sessionStorage.removeItem('cafe-mine') } catch { /* private mode */ }
    // returning from auth headed for your own submain
    } else if (new URLSearchParams(window.location.search).get('mine')) {
      window.history.replaceState({}, '', '/')
      myWorlds()
    } else {
      // still in your submain from earlier this session? re-enter it quietly —
      // no redirects here: a stale flag without a session just clears itself.
      // NOT on back/forward: the back button means "return to the cafe dock",
      // and quietly re-opening my-worlds there hijacks the journey.
      const navType = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type
      try {
        if (navType !== 'back_forward' && sessionStorage.getItem('cafe-mine')) {
          fetch('/api/auth/session').then(r => r.json()).then(sess => {
            if (sess?.user) {
              ;(window as unknown as { __cafeMine?: unknown }).__cafeMine = { on: true, ownerId: sess.user.id, who: sess.user.name || '' }
              setMine(sess.user.name || 'your')
            } else sessionStorage.removeItem('cafe-mine')
          }).catch(() => { /* offline is fine */ })
        }
      } catch { /* private mode */ }
    }
    const onHover = (e: Event) => {
      if (Date.now() < hoverBlockRef.current) return   // scene just changed — stale hover
      hoverAtRef.current = Date.now()
      setHover((e as CustomEvent).detail)
    }
    // worlds can put a line of phosphor text on the glass — SIGNAL shows the word you type
    const onCaption = (e: Event) => {
      const d = (e as CustomEvent).detail as { text: string; kind: string } | null
      if (captionTimer.current) clearTimeout(captionTimer.current)
      if (!d || (!d.text && d.kind !== 'typing')) { setCaption(null); return }
      setCaption(d)
      if (d.kind !== 'typing') captionTimer.current = setTimeout(() => setCaption(null), d.kind === 'hint' ? 6000 : 3200)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // ESC backs out of the brew wizard first
      if (brewStepRef.current > 0) { brewCancelRef.current(); return }
      if (sceneRef.current === 'CAFE') return
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
      const ps = ((e as CustomEvent).detail || []) as { name: string; launch?: string; x: number; y: number; r: number }[]
      setPortals(ps)
      for (const p of ps) if (p.launch) launchMapRef.current[p.name] = p.launch
      // the MAIN arena's roster freezes from main's own doors only
      if (sceneRef.current === 'CAFE' && ps.length > 1 && !(window as unknown as { __cafeMine?: { on?: boolean } }).__cafeMine?.on) {
        setMainRoster(ps.map(p => p.name))
      }
    }
    const onModal = (e: Event) => setModalUp(!!(e as CustomEvent).detail)
    const onSubMode = (e: Event) => setSubMode((e as CustomEvent).detail)
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    onResize()
    // the group layer needs to know who's standing in it (found / join / pin)
    fetch('/api/auth/session').then(r => r.json()).then(s => {
      if (s?.user?.id) {
        const w = { id: s.user.id as string, name: (s.user.name || '') as string }
        ;(window as unknown as { __cafeWho?: typeof w }).__cafeWho = w
        setWho(w)
      }
    }).catch(() => {})
    window.addEventListener('cafe:launch', onLaunch)
    window.addEventListener('cafe:hover', onHover)
    window.addEventListener('cafe:caption', onCaption)
    window.addEventListener('keydown', onKey)
    window.addEventListener('popstate', onPop)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('cafe:portals', onPortals)
    window.addEventListener('cafe:modal', onModal)
    window.addEventListener('cafe:submode', onSubMode)
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
      window.removeEventListener('cafe:submode', onSubMode)
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
        .then(d => {
          if (!d) return
          setCounts(d.counts || {})
          // the door shader draws head-counts IN the bubbles — hand it the map
          ;(window as unknown as { __cafeCounts?: Record<string, number> }).__cafeCounts = d.counts || {}
        }).catch(() => {})
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

  // Bubble faces are FOLDED INTO the shader, not overlaid. We load every
  // world's screenshot once, pack them into one RGBA8 atlas (64x64 per slot),
  // and hand it to the engine's icon buffer. The door shader samples a world's
  // slot directly inside its bubble disc — one render pass, zero drift on
  // pan/zoom, no second DOM layer. The name→slot map lets the door hook tell
  // the shader which slot each bubble wears.
  useEffect(() => {
    if (scene !== 'CAFE') return
    let cancelled = false
    ;(async () => {
      const [sc, sp] = await Promise.all([
        fetch('/api/engine/scene?action=list').then(r => r.json()).catch(() => ({ scenes: [] })),
        fetch('/api/spaces/browse').then(r => r.json()).catch(() => ({ spaces: [] })),
      ])
      // house worlds have hand-coded animated minis in the shader — no thumb file
      const STYLED = new Set(['FABRIC', 'ORRERY', 'GARNET', 'ONE DAY', 'SAIL', 'SOLSTICE', 'TIDERUNNER', 'SIGNAL'])
      const names = new Set<string>()
      for (const n of (sc.scenes || []) as string[]) {
        if (n === 'CAFE' || n === 'SUB-MAIN' || n.includes(' ⑂ ') || STYLED.has(n)) continue
        names.add(n.toUpperCase())
      }
      for (const s of (sp.spaces || []) as Array<{ name?: string; slug: string; blank?: boolean }>) {
        if (!s.blank) names.add((s.name || s.slug).toUpperCase())
      }
      const ICON = 64, list = [...names].slice(0, 64)   // atlas cap
      const cv = document.createElement('canvas')
      cv.width = ICON; cv.height = ICON
      const ctx = cv.getContext('2d', { willReadFrequently: true })!
      const loadImg = (src: string) => new Promise<HTMLImageElement | null>(res => {
        const im = new Image()
        im.onload = () => res(im)
        im.onerror = () => res(null)
        im.src = src
      })
      // load every thumbnail AT ONCE (was sequential — the whole delay). As each
      // arrives, pack it and publish an atlas so far, so faces pop in as they
      // decode instead of waiting for the slowest one.
      const slotMap: Record<string, number> = {}
      const atlas = new Uint32Array(list.length * ICON * ICON)
      let slot = 0
      const publish = () => {
        if (cancelled || slot === 0) return
        const packed = atlas.subarray(0, slot * ICON * ICON)
        ;(window as unknown as { __cafeIconAtlas?: Uint32Array; __cafeIconSlots?: Record<string, number> }).__cafeIconAtlas = packed
        ;(window as unknown as { __cafeIconSlots?: Record<string, number> }).__cafeIconSlots = { ...slotMap }
        window.dispatchEvent(new CustomEvent('cafe:icon-atlas', { detail: packed }))
      }
      const loaded = await Promise.all(list.map(name =>
        loadImg(`/thumbs/${encodeURIComponent(name)}.jpg`).then(im => ({ name, im }))))
      if (cancelled) return
      for (const { name, im } of loaded) {
        if (!im) continue   // no thumb (house minis) — no slot; shader keeps its live mini
        ctx.clearRect(0, 0, ICON, ICON)
        const s = Math.min(im.width, im.height)   // cover-crop square into the cell
        ctx.drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, ICON, ICON)
        const px = ctx.getImageData(0, 0, ICON, ICON).data
        const base = slot * ICON * ICON
        for (let i = 0; i < ICON * ICON; i++) {
          atlas[base + i] = px[i * 4] | (px[i * 4 + 1] << 8) | (px[i * 4 + 2] << 16) | 0xff000000
        }
        slotMap[name] = slot
        slot++
      }
      publish()
    })()
    return () => { cancelled = true }
  }, [scene])

  return (
    <>
      <FieldEngine playScene={scene} />

      {/* the rolling tournament — every page is its own arena.
          commons: all core worlds · MY WORLDS: your deeds · SUB-MAIN: the
          branch shelf · a world: MAIN vs its branches (what promotion enacts).
          While DOCKED, the main arena rides along into worlds (so a voter can
          see the contenders) and every other arena stands down. */}
      {((scene === 'CAFE' && !mine) || docked) && (
        <TournamentBar key="arena-main" visible={!modalUp && !confirmLeave} slot="tournament:main" worlds={mainRoster}
          bubbles={scene === 'CAFE' ? portals : undefined}
          rail={scene !== 'CAFE'}
          docked={docked} onDock={setDocked} onTravel={travelTo} sceneKey={scene}
          onCloseHome={() => { setDocked(false); if (sceneRef.current !== 'CAFE') go('CAFE') }}
          emptyHint="⚔ THE ARENA WAITS FOR WORLDS" />
      )}
      {scene === 'CAFE' && mine && !docked && (
        <TournamentBar key={`arena-mine-${mine}`} visible={!modalUp} slot={`tournament:mine:${mine}`} worlds={portals.map(pt => pt.name)}
          bubbles={portals}
          emptyHint="⚔ BREW A SECOND WORLD TO OPEN YOUR ARENA" />
      )}
      {scene === 'SUB-MAIN' && !docked && (
        <TournamentBar key={subMode?.slug ? `arena-sub-${subMode.slug}` : 'arena-submain'} visible={!modalUp}
          slot={subMode?.slug ? `tournament:sub:${subMode.slug}` : 'tournament:submain'}
          worlds={portals.map(pt => pt.name)}
          bubbles={portals}
          emptyHint="⚔ PIN TWO WORLDS TO OPEN THIS ARENA" />
      )}
      {scene !== 'CAFE' && scene !== 'SUB-MAIN' && !docked && (
        <TournamentBar
          key={`arena-world-${scene.split(' ⑂ ')[0]}`}
          visible={!modalUp && !confirmLeave}
          slot={`tournament:world:${scene.split(' ⑂ ')[0]}`}
          branchesOf={scene.split(' ⑂ ')[0]}
          sceneKey={scene}
          rail
        />
      )}

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

      {/* (bubble faces are drawn INSIDE the door shader now — see the icon-atlas
          effect above; no DOM overlay layer exists to drift) */}

      {/* (head-counts are drawn INSIDE each bubble by the door shader now —
          see the stride-4 publish + cafeCount() in shaders.ts; no DOM overlay) */}

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

      {/* the group layer's controls — found in the viewer, join/pin inside.
          Before the world's first report arrives, assume the viewer: the
          FOUND door must never be invisible on an empty group layer. */}
      {scene === 'SUB-MAIN' && !modalUp && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2">
          {subMode?.mode === 'group' ? (<>
            <button onClick={() => { (window as unknown as { __cafeSub?: string | null }).__cafeSub = null }}
              className="brass-tab px-3 py-1.5 text-[10px]">◂ SUB-MAINS</button>
            <span className="cafe-sign text-xl px-1">{(subMode.name || '').toLowerCase()}</span>
            {who && !subMode.member && <button onClick={joinSub} className="brass-tab px-3 py-1.5 text-[10px]">JOIN</button>}
            {who && subMode.member && (subMode.owner || !subMode.pinsLocked) && (
              <button onClick={pinWorld} className="brass-tab px-3 py-1.5 text-[10px]">+ PIN A WORLD</button>
            )}
            {who && subMode.member && !subMode.owner && subMode.pinsLocked && (
              <span className="font-mono text-[9px] tracking-[0.2em] text-white/35 px-1">SHELF CLOSED</span>
            )}
            {who && subMode.owner && (
              <button onClick={() => setSubTools(o => !o)} className="brass-tab px-3 py-1.5 text-[10px]">⚙ TOOLS</button>
            )}
          </>) : (
            !subMode?.haveOwn && (
              <button onClick={foundSub} className="brass-tab px-3 py-1.5 text-[10px]">⌂ FOUND YOURS</button>
            )
          )}
        </div>
      )}

      {/* founder's moderation desk: members, pins, and the shelf rule */}
      {scene === 'SUB-MAIN' && !modalUp && subTools && subMode?.mode === 'group' && subMode.owner && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 w-[380px] max-w-[90vw] max-h-[55vh] overflow-y-auto rounded-xl bg-[#171009]/90 backdrop-blur border border-[#b97a2a]/25 p-3 space-y-3 font-mono text-[10px] tracking-[0.15em]">
          <div className="flex items-center justify-between">
            <span className="text-brass">SHELF RULE</span>
            <button onClick={togglePins} className="brass-tab px-2 py-1">
              {subMode.pinsLocked ? 'PINNING: FOUNDER ONLY' : 'PINNING: ALL MEMBERS'}
            </button>
          </div>
          <div>
            <div className="text-brass mb-1">MEMBERS · {Object.keys(subMode.members || {}).length}</div>
            {Object.entries(subMode.members || {}).map(([uid, mName]) => (
              <div key={uid} className="flex justify-between items-center py-0.5">
                <span className="text-white/70">{mName}{uid === who?.id ? ' · founder' : ''}</span>
                {uid !== who?.id && (
                  <button onClick={() => kickMember(uid)} className="text-flame/80 hover:text-flame">KICK</button>
                )}
              </div>
            ))}
          </div>
          <div>
            <div className="text-brass mb-1">PINNED WORLDS · {(subMode.shelf || []).length}</div>
            {(subMode.shelf || []).length === 0 && <div className="text-white/35">nothing pinned yet</div>}
            {(subMode.shelf || []).map(n => (
              <div key={n} className="flex justify-between items-center py-0.5">
                <span className="text-white/70">{n.toLowerCase()}</span>
                <button onClick={() => unpinWorld(n)} className="text-flame/80 hover:text-flame">UNPIN</button>
              </div>
            ))}
          </div>
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

      {/* BREW: one panel, gates unlock in place — name → brief → connect AI.
          Connecting the AI delivers the brief and opens the world. */}
      {brewStep > 0 && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-void/80 backdrop-blur-sm"
          onClick={brewCancel}>
          <div className="relative w-[480px] max-w-[94vw] border border-brass/40 rounded-xl px-7 py-6 bg-void/95 shadow-[0_0_60px_rgba(245,176,76,0.15)]"
            onClick={e => e.stopPropagation()}>
            <button onClick={brewCancel} aria-label="back out"
              className="absolute top-2.5 right-3.5 font-mono text-sm text-crema/40 hover:text-glow transition-colors">✕</button>
            <div className="flex gap-3 mb-4 font-mono text-[9px] tracking-[0.2em]">
              <span className={nameValid ? 'text-glow' : 'text-crema/40'}>{nameValid ? '✓' : '1'} NAME</span>
              <span className={briefLen >= 100 && briefLen <= 500 ? 'text-glow' : 'text-crema/40'}>{briefLen >= 100 && briefLen <= 500 ? '✓' : '2'} BRIEF</span>
              <span className={brewAi && connectReady ? 'text-glow' : 'text-crema/40'}>{brewAi && connectReady ? '⚒' : '3'} CONNECT AI</span>
            </div>
            <div className="cafe-sign text-2xl mb-4">brew your world</div>

            {/* GATE 1 — NAME (5–20 chars, unique) */}
            <div className="mb-1 font-mono text-[9px] tracking-[0.2em] text-crema/50">1 · NAME IT</div>
            <input autoFocus value={brewName} maxLength={20}
              onChange={e => setBrewName(e.target.value)}
              placeholder="e.g. Tidepool Abbey"
              className={'w-full rounded-lg bg-black/50 border px-3 py-2.5 font-mono text-sm text-glow outline-none mb-1 focus:border-brass '
                + (nameValid ? 'border-glow/60' : 'border-brass/30')} />
            <div className="font-mono text-[9px] tracking-[0.15em] mb-4 min-h-[13px]">
              {nameTrim.length === 0
                ? <span className="text-crema/40">5–20 characters, must be unique</span>
                : !nameLenOk
                  ? <span className="text-crema/50">{nameTrim.length}/20 — need 5–20 characters</span>
                  : brewChecking
                    ? <span className="text-crema/50">checking…</span>
                    : brewNameOk === true
                      ? <span className="text-glow">✓ available</span>
                      : brewNameOk === false
                        ? <span className="text-red-400">that name is already taken</span>
                        : <span className="text-crema/40">&nbsp;</span>}
            </div>

            {/* GATE 2 — BRIEF (100–500 chars), locked until the name is valid */}
            <div className={'transition-opacity ' + (nameValid ? 'opacity-100' : 'opacity-35 pointer-events-none select-none')}>
              <div className="mb-1 font-mono text-[9px] tracking-[0.2em] text-crema/50">
                2 · TELL IT WHAT TO BUILD {!nameValid && <span className="text-crema/40">· name it first</span>}
              </div>
              <textarea value={brewBrief} maxLength={500} disabled={!nameValid}
                onChange={e => setBrewBrief(e.target.value)}
                placeholder="a tidepool at dusk; anemones open when my cursor is still; crabs argue over a pearl…"
                rows={4}
                className="w-full rounded-lg bg-black/50 border border-brass/30 px-3 py-2.5 font-mono text-xs text-glow outline-none focus:border-brass mb-1 resize-none" />
              <div className="font-mono text-[9px] tracking-[0.15em] mb-4">
                <span className={briefLen >= 100 && briefLen <= 500 ? 'text-glow' : 'text-crema/50'}>{briefLen}/500</span>
                <span className="text-crema/40"> · min 100 to unlock connect</span>
              </div>
            </div>

            {/* GATE 3 — CONNECT AI: the copy text, disabled until name + brief are ready.
                the AI logging in delivers the brief, opens the world, and closes this. */}
            <div className={'transition-opacity ' + (connectReady ? 'opacity-100' : 'opacity-35 pointer-events-none select-none')}>
              <div className="mb-1 font-mono text-[9px] tracking-[0.2em] text-crema/50">
                3 · CONNECT YOUR AI {!connectReady && <span className="text-crema/40">· finish name + brief first</span>}
              </div>
              {connectReady ? (
                <div className="rounded-lg bg-black/60 border border-brass/30 px-3 py-2.5 font-mono text-[10px] leading-relaxed text-glow/90 whitespace-pre-wrap break-all select-all max-h-40 overflow-y-auto mb-3">
                  {connectPrompt(brewToken)}
                </div>
              ) : (
                <div className="rounded-lg bg-black/40 border border-brass/20 px-3 py-4 font-mono text-[10px] text-crema/40 text-center mb-3">
                  locked — the connection prompt appears once the name and a 100-character brief are set
                </div>
              )}
              <button disabled={!connectReady}
                onClick={() => navigator.clipboard?.writeText(connectPrompt(brewToken))}
                className="w-full rounded-lg bg-flame/90 hover:bg-glow py-2.5 font-mono text-[10px] tracking-[0.15em] text-void transition-colors disabled:opacity-35">
                COPY CONNECTION PROMPT
              </button>
              <div className="font-mono text-[9px] tracking-[0.15em] mt-2 text-crema/40">
                {brewAi && connectReady
                  ? <span className="text-glow animate-pulse">your AI connected — delivering the brief and opening your world…</span>
                  : 'paste it to your AI — the moment it logs in, your world opens'}
              </div>
            </div>
            {brewErr && <div className="font-mono text-[10px] text-red-400 mt-3">{brewErr}</div>}
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
