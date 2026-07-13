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
worldData.player_focus is what I have selected — always follow it.
You may open your world's page in your own (headless) browser as your eyes —
GET the bridge URL and use space.viewUrl (it can change when I name the world).
Your view is yours: it never takes my seat and never counts in head-counts.`
  }
  const brew = async () => {
    const sess = await fetch('/api/auth/session').then(r => r.json()).catch(() => null)
    if (!sess?.user) { window.location.href = '/auth/signin?callbackUrl=' + encodeURIComponent('/?brew=1'); return }
    setBrewErr(''); setBrewName(''); setBrewBrief('')
    setBrewAi(false); setBrewNamed(false); setBrewBriefed(false)
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
    setBrewStep(4)   // now the AI takes over — wake it and watch for the first build
  }
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
  /** step 4: watch the world through the AI's own key — the moment its first
   *  build lands (a field, a visual, a hook, or brief_done), walk the player in */
  useEffect(() => {
    if (brewStep !== 4 || !brewToken) return
    let stop = false
    const iv = setInterval(async () => {
      try {
        const d = await fetch('/api/engine/bridge', { headers: { Authorization: 'Bearer ' + brewToken } }).then(r => r.json())
        if (stop) return
        const started = (d.fields || []).length > 0 || (d.visualTypes || []).length > 0 ||
          (d.stepHooks || []).length > 0 || d.worldData?.ai_focus || d.worldData?.brief_done
        if (started) { stop = true; enterWorld() }
      } catch { /* keep watching */ }
    }, 2000)
    return () => { stop = true; clearInterval(iv) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brewStep, brewToken])
  const reupPrompt = (token: string) => {
    const o = window.location.origin
    return `Your brief is in the world now. GET ${o}/api/engine/bridge
Header: Authorization: Bearer ${token}
Read worldData.creation_brief and BUILD EXACTLY THAT — not your own idea.
When the first pass stands, set worldData.brief_done = true.
worldData.instructions is mandatory: key entry + the point.`
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

  // the thumbnail layer's own clock: every frame, weld each world-face img to
  // its bubble's live geometry (the door hook writes window.__cafeBubbles per
  // tick). Direct DOM writes — no React re-render, no event latency.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const bubbles = (window as unknown as { __cafeBubbles?: Array<{ name: string; x: number; y: number; r: number }> }).__cafeBubbles
      const w = window.innerWidth, hgt = window.innerHeight
      const spanNow = Math.min(w, hgt)
      const byName: Record<string, { x: number; y: number; r: number }> = {}
      if (bubbles) for (const bb of bubbles) byName[bb.name] = bb
      document.querySelectorAll<HTMLImageElement>('img[data-bubble]').forEach(img => {
        if (img.dataset.dead === '1') return
        const bb = byName[img.dataset.bubble || '']
        if (!bb) { img.style.display = 'none'; return }
        // inset well within the glass: the shader's rim and hover bloom frame
        // the face instead of being covered by it
        const d = bb.r * spanNow * 0.76
        if (d < 8) { img.style.display = 'none'; return }
        img.style.display = ''
        img.style.left = (w / 2 + bb.x * spanNow / 2) + 'px'
        img.style.top = (hgt / 2 + bb.y * spanNow / 2) + 'px'
        img.style.width = d + 'px'
        img.style.height = d + 'px'
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

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
          rail={scene !== 'CAFE'}
          docked={docked} onDock={setDocked} onTravel={travelTo} sceneKey={scene}
          onCloseHome={() => { setDocked(false); if (sceneRef.current !== 'CAFE') go('CAFE') }}
          emptyHint="⚔ THE ARENA WAITS FOR WORLDS" />
      )}
      {scene === 'CAFE' && mine && !docked && (
        <TournamentBar key={`arena-mine-${mine}`} visible={!modalUp} slot={`tournament:mine:${mine}`} worlds={portals.map(pt => pt.name)}
          emptyHint="⚔ BREW A SECOND WORLD TO OPEN YOUR ARENA" />
      )}
      {scene === 'SUB-MAIN' && !docked && (
        <TournamentBar key={subMode?.slug ? `arena-sub-${subMode.slug}` : 'arena-submain'} visible={!modalUp}
          slot={subMode?.slug ? `tournament:sub:${subMode.slug}` : 'tournament:submain'}
          worlds={portals.map(pt => pt.name)}
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

      {/* every bubble wears its world's true face: a screenshot the Eye took,
          inlaid under the shader's glass edge. React only mounts the imgs —
          POSITION comes from a rAF loop reading window.__cafeBubbles (written
          by the door hook every tick), so faces stay welded to the shader's
          bubbles through pans and zooms. Missing thumb → 404 → hides itself. */}
      {!modalUp && portals.map(pt => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={'thumb-' + pt.name}
          data-bubble={pt.name}
          src={`/thumbs/${encodeURIComponent(pt.name)}.jpg`}
          alt=""
          className="fixed z-30 pointer-events-none select-none rounded-full object-cover"
          style={{ left: -9999, top: -9999, width: 1, height: 1, transform: 'translate(-50%, -50%)',
                   opacity: 0.92, boxShadow: 'inset 0 0 18px rgba(0,0,0,0.8)' }}
          onError={e => { const el = e.currentTarget as HTMLImageElement; el.dataset.dead = '1'; el.style.display = 'none' }}
        />
      ))}

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

      {/* BREW: key first → name → brief → enter (all three gates) */}
      {brewStep > 0 && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-void/80 backdrop-blur-sm"
          onClick={brewCancel}>
          <div className="relative w-[480px] max-w-[94vw] border border-brass/40 rounded-xl px-7 py-6 bg-void/95 shadow-[0_0_60px_rgba(245,176,76,0.15)]"
            onClick={e => e.stopPropagation()}>
            <button onClick={brewCancel} aria-label="back out"
              className="absolute top-2.5 right-3.5 font-mono text-sm text-crema/40 hover:text-glow transition-colors">✕</button>
            <div className="flex gap-3 mb-4 font-mono text-[9px] tracking-[0.2em]">
              <span className={brewAi ? 'text-glow' : 'text-crema/40'}>{brewAi ? '✓' : '1'} AI CONNECTED</span>
              <span className={brewNamed ? 'text-glow' : 'text-crema/40'}>{brewNamed ? '✓' : '2'} NAMED</span>
              <span className={brewBriefed ? 'text-glow' : 'text-crema/40'}>{brewBriefed ? '✓' : '3'} BRIEFED</span>
              <span className={brewStep === 4 ? 'text-glow' : 'text-crema/40'}>{brewStep === 4 ? '⚒' : '4'} BUILDING</span>
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
                <button disabled={!brewAi} onClick={() => setBrewStep(2)}
                  className="flex-1 brass-tab py-2 text-[10px] disabled:opacity-35">
                  {brewAi ? 'NEXT → NAME IT' : 'WAITING FOR AI…'}
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
              <button disabled={!brewBrief.trim()} onClick={brewSaveBrief}
                className="w-full rounded-lg bg-flame/90 hover:bg-glow py-2.5 font-mono text-[11px] tracking-[0.15em] text-void transition-colors disabled:opacity-40">
                DELIVER THE BRIEF
              </button>
            </>)}
            {brewStep === 4 && (<>
              <div className="cafe-sign text-2xl mb-2">wake your AI</div>
              <div className="font-mono text-[10px] leading-relaxed text-crema/70 mb-3">
                The brief is in the world. If your AI is still standing by, it will begin on
                its own — the door opens the moment its first build lands. If its session
                ended, paste this to wake it:
              </div>
              <div className="rounded-lg bg-black/60 border border-brass/30 px-3 py-2.5 font-mono text-[10px] leading-relaxed text-glow/90 whitespace-pre-wrap break-all select-all max-h-40 overflow-y-auto mb-3">
                {reupPrompt(brewToken)}
              </div>
              <div className="flex gap-2 items-center">
                <button onClick={() => navigator.clipboard?.writeText(reupPrompt(brewToken))}
                  className="flex-1 rounded-lg bg-flame/90 hover:bg-glow py-2 font-mono text-[10px] tracking-[0.15em] text-void transition-colors">
                  COPY WAKE-UP PROMPT
                </button>
                <button onClick={enterWorld} className="flex-1 brass-tab py-2 text-[10px]">
                  STEP IN NOW
                </button>
              </div>
              <div className="font-mono text-[9px] tracking-[0.15em] mt-2 text-crema/40 animate-pulse">
                watching for its first build — the door opens itself…
              </div>
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
