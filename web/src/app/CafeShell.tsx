'use client'

import { useEffect, useRef, useState } from 'react'
import FieldEngine from '@/app/engine/FieldEngine'
import TournamentBar from '@/app/TournamentBar'
import MainCommonsChat from '@/app/MainCommonsChat'
import ChatWorld from '@/app/ChatWorld'
import AdInterstitial from '@/app/AdInterstitial'
import LendAiPanel from '@/app/LendAiPanel'
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

// AD POP-UP: OFF for now — grow the audience before we interrupt it. The whole ad
// system (serve/rotate/track API, interstitial, protection, lifecycle) stays built
// and tested; flip this to true to turn the world-start pop-up back on.
const ADS_ENABLED = false

/** The world IS the interface. The only HTML: the sign, two small doors,
 *  and a name that appears at your cursor when a window notices you. */
// ONE hub-button style — both the cafe dock and the sub-main hub use it, so the
// two hubs read as the same layer (surface:'hub'), not two different UIs.
const hubBtn = 'rounded-lg border border-brass/40 hover:border-flame/60 px-3 py-1.5 font-mono text-[12px] tracking-[0.15em] text-steamer/80 hover:text-glow transition-all'

export default function CafeShell({ initialScene = 'CAFE' }: { initialScene?: string }) {
  const [scene, setScene] = useState(initialScene)

  // the tab title follows you: into a world, and — the bug — back out again.
  // In-shell scene swaps never navigate, so the /play/[scene] metadata title
  // goes stale the moment you leave; keep document.title honest by hand.
  useEffect(() => {
    document.title = scene && scene !== 'CAFE'
      ? `${scene.toLowerCase()} · cartridge.cafe`
      : 'cartridge.cafe — little worlds, served as single files'
  }, [scene])
  // the contained ad shown on game-world entry; server decides if the viewer /
  // world is protected (ad-free), the client just throttles how often it shows.
  const [ad, setAd] = useState<{ id: string; title: string; body: string; emoji: string; advertiser: string } | null>(null)
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
  // BREW YOUR ICON — the local player's dancing avatar. fx = look (0 comet · 1
  // ring · 2 eyes · 3 spark · 4 cup · 5 the un-brewed DEFAULT: a big black
  // cursor with a white pointer — not brewable, only ever the starting state),
  // hue 0..1, size. Lives in localStorage and rides to the shader via
  // window.__cafeIcon (packed at the uniform tail by the hook).
  const [iconOpen, setIconOpen] = useState(false)
  const [lendOpen, setLendOpen] = useState(false)   // "Lend your AI" volunteer panel
  const [icon, setIcon] = useState<{ fx: number; hue: number; size: number; wgsl?: string }>({ fx: 5, hue: 0.55, size: 1 })
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('cafeIcon') || 'null')
      // scrub the ACCIDENTAL comet: a StrictMode double-mount once persisted
      // the untouched {fx:0, hue:0.55, size:1} default — it reads as brewed
      // but never was, and it kept the un-brewed default cursor from landing
      const accidental = saved && saved.fx === 0 && saved.hue === 0.55 && saved.size === 1 && !saved.wgsl
      if (saved && typeof saved.fx === 'number' && !accidental) setIcon({ fx: saved.fx, hue: saved.hue ?? 0.55, size: saved.size ?? 1, wgsl: typeof saved.wgsl === 'string' ? saved.wgsl : undefined })
    } catch { /* first brew */ }
    // an AI may have brewed the icon through the bridge (set_player_icon) —
    // the server copy wins over the local one, so it follows you across
    // browsers. Signed in with NOTHING brewed is also server truth: wear the
    // default cursor, whatever stale localStorage claims.
    fetch('/api/engine/player-icon').then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.icon && typeof d.icon.fx === 'number') setIcon({ fx: d.icon.fx, hue: d.icon.hue ?? 0.55, size: d.icon.size ?? 1, wgsl: typeof d.icon.wgsl === 'string' ? d.icon.wgsl : undefined })
        else if (d?.signedIn) setIcon({ fx: 5, hue: 0.55, size: 1 })
      })
      .catch(() => { /* offline is fine — localStorage carried it */ })
  }, [])
  // the panel's ICON TOKEN — minted on open, folded into the copied prompt so
  // the AI can set_player_icon with no world and no space token. Re-minting
  // revokes the previous token (one live icon key per player).
  const [iconToken, setIconToken] = useState('')
  useEffect(() => {
    if (!iconOpen) return
    fetch('/api/engine/player-icon', { method: 'POST' }).then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.token) setIconToken(d.token) })
      .catch(() => { /* signed out — the copied prompt will say so */ })
  }, [iconOpen])
  // watch for the AI's brew landing — fast while the panel is open, slow in the
  // background otherwise, so an icon set from a terminal session hot-swaps the
  // cursor without a reload (setIcon → cafe:icon → the engine recompiles the
  // glyph module). Hidden tabs skip the beat.
  useEffect(() => {
    const look = () => {
      if (document.hidden) return
      fetch('/api/engine/player-icon').then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d?.icon && typeof d.icon.fx === 'number') setIcon(prev => (prev.fx === d.icon.fx && prev.hue === d.icon.hue && prev.size === d.icon.size && prev.wgsl === d.icon.wgsl) ? prev : { fx: d.icon.fx, hue: d.icon.hue ?? 0.55, size: d.icon.size ?? 1, wgsl: typeof d.icon.wgsl === 'string' ? d.icon.wgsl : undefined })
          else if (d?.signedIn) setIcon(prev => (prev.fx === 5 && !prev.wgsl) ? prev : { fx: 5, hue: 0.55, size: 1 })
        })
        .catch(() => {})
    }
    const iv = setInterval(look, iconOpen ? 2000 : 12000)
    return () => clearInterval(iv)
  }, [iconOpen])
  // don't persist the untouched default — in dev, StrictMode's double-mount
  // otherwise writes it over the stored icon before the second mount's load
  // effect reads it (the icon "forgot itself" on reload). Once icon is a NEW
  // object (loaded from storage/server or brewed), persisting is safe.
  const initialIconRef = useRef(icon)
  useEffect(() => {
    ;(window as unknown as { __cafeIcon?: typeof icon }).__cafeIcon = icon
    if (icon !== initialIconRef.current) {
      try { localStorage.setItem('cafeIcon', JSON.stringify(icon)) } catch { /* private mode */ }
    }
    window.dispatchEvent(new CustomEvent('cafe:icon'))   // the engine rebuilds the glyph cursor
  }, [icon])
  const [iconPrompt, setIconPrompt] = useState('')
  const [iconCopied, setIconCopied] = useState(false)
  // like BREW YOURS: you don't tune it by hand — you describe it, copy the prompt,
  // and hand it to an AI, which authors your icon through the bridge and confirms.
  const copyIconPrompt = async () => {
    const p = iconPrompt.trim()
    if (p.length < 3) return
    const o = window.location.origin
    const text = `Brew my cartridge.cafe player icon: "${p}".

Author a custom WGSL glyph — this IS my cursor in the cafe, so make it live up to the description. Set it with one call:

POST ${o}/api/engine/bridge
Authorization: Bearer ${iconToken || '<open the brew panel while signed in to mint your icon token>'}
Body: {"type":"set_player_icon","icon":{"fx":<0-4 preset fallback>,"hue":<0-1>,"size":<0.5-2>,"wgsl":"<the glyph>"}}

The glyph is one WGSL function, under 6KB, no bindings, exactly this signature:
fn visual_glyph(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f
uv spans -1..1 inside the icon's small cursor cell; animate off time; return vec4f(rgb, alpha) with alpha 0 outside the shape. Also pick fx/hue/size so the preset fallback echoes the idea. Full engine guide: ${o}/api/engine/guide

Hard rules — the icon must be SAFE: no strobing or flashing, no rapid brightness swings, no unbounded loops (the cell caps its size). Within that, go as bold and alive as the description demands. Reply to confirm once it's set.`
    try {
      await navigator.clipboard.writeText(text)
      setIconCopied(true); setTimeout(() => setIconCopied(false), 1800)
    } catch { /* clipboard blocked */ }
  }
  const [brewStep, setBrewStep] = useState(0)          // 0 closed · 1 open (single panel, gates unlock in place)
  const [brewName, setBrewName] = useState('')
  const [brewBrief, setBrewBrief] = useState('')
  const [brewToken, setBrewToken] = useState('')
  const [brewSlug, setBrewSlug] = useState('')
  const [brewErr, setBrewErr] = useState('')
  const [brewAi, setBrewAi] = useState(false)
  const [brewNameOk, setBrewNameOk] = useState<boolean | null>(null)   // null = unchecked/too short · true/false = unique?
  const [brewChecking, setBrewChecking] = useState(false)
  const [houseAiUp, setHouseAiUp] = useState(false)   // a swarm builder is online → offer "have the house AI build it"
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
  const [subMode, setSubMode] = useState<{ mode: string; slug: string | null; name: string | null; haveOwn: boolean; member: boolean; owner?: boolean; pinsLocked?: boolean; members?: Record<string, string>; ownerId?: string | null; admins?: string[]; bans?: Record<string, { until: number; name?: string; by?: string }>; shelf?: string[] } | null>(null)
  const [subTools, setSubTools] = useState(false)          // founder's moderation panel
  const [chatWorld, setChatWorld] = useState<{ channel: string; title: string; subtitle?: string } | null>(null)   // the structural chat world you've entered
  // LANDING ON MAIN ALWAYS SHOWS MAIN. Whatever path brought you back (ESC,
  // back button, crumbs, a door), an open commons never greets you — the shelf
  // does. Opening the commons doesn't change `scene`, so this only fires on
  // actual arrivals, never on the open itself.
  useEffect(() => {
    if (scene === 'CAFE') setChatWorld(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])
  // deep-link: /?commons opens straight into the commons chat world — ONCE, and
  // the URL is scrubbed immediately so browser-back / reload can never resurrect
  // the commons over main. The commons only ever opens by explicit click after this.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (new URLSearchParams(window.location.search).has('commons')) {
      window.history.replaceState({}, '', '/')
      setChatWorld({ channel: 'commons:main', title: 'The Commons', subtitle: 'the AIs at scale' })
    }
  }, [])
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
  // THE RECKONING: the vote overlay takes over the screen. While it's up, the
  // engine renders the world you're hovering (previewScene) instead of the
  // constellation — scene stays 'CAFE' so the arena bar never unmounts.
  const [voting, setVoting] = useState(false)
  const [dockBottom, setDockBottom] = useState(0)   // live bottom of the engine's UI dock — seats the in-world VOTE button under it
  const [previewScene, setPreviewScene] = useState<string | null>(null)
  const [stageRect, setStageRect] = useState<{ top: number; right: number; bottom: number; left: number } | null>(null)
  const votingRef = useRef(false)
  votingRef.current = voting
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
  type SubEntry = { name: string; ownerId: string; ownerName: string; founded: number; members: Record<string, string>; shelf: Record<string, { launch: string; addedBy: string; at: number }>; pinsLocked?: boolean; admins?: string[]; bans?: Record<string, { until: number; name?: string; by?: string }> }
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
      const b = s.bans?.[who.id]
      if (b && b.until > Date.now()) return 'you are banned from this sub-main until ' + new Date(b.until).toLocaleDateString()
      s.members[who.id] = who.name
      return null
    })
  }

  /** members pin worlds (or spaces) onto the group's shelf by name */
  // PIN A WORLD — a live search box (site colors), not a browser prompt. Open it,
  // it loads every pinnable world on main, and you filter as you type.
  const [pinOpen, setPinOpen] = useState(false)
  const [pinQuery, setPinQuery] = useState('')
  const [pinWorldList, setPinWorldList] = useState<{ name: string; launch: string }[]>([])
  const openPin = async () => {
    if (!who) { window.alert('sign in to pin'); return }
    if (!subMode?.slug) { window.alert('step inside a sub-main first — pins land on its shelf'); return }
    setPinQuery(''); setPinWorldList([]); setPinOpen(true)
    const [sc, sp] = await Promise.all([
      fetch('/api/engine/scene?action=list').then(r => r.json()).catch(() => ({ scenes: [] })),
      fetch('/api/spaces/browse').then(r => r.json()).catch(() => ({ spaces: [] })),
    ])
    const list: { name: string; launch: string }[] = []
    for (const n of (sc.scenes || []) as string[]) {
      if (n === 'CAFE' || n === 'SUB-MAIN' || n.includes(' ⑂ ') || n.includes('␂')) continue
      list.push({ name: n.toUpperCase(), launch: n })
    }
    for (const s of (sp.spaces || []) as { name?: string; slug: string; blank?: boolean; building?: boolean }[]) {
      if (s.blank || s.building) continue
      const nm = (s.name || s.slug).toUpperCase()
      if (!list.some(w => w.name === nm)) list.push({ name: nm, launch: 'space:' + s.slug })
    }
    list.sort((a, b) => a.name.localeCompare(b.name))
    setPinWorldList(list)
  }
  const doPin = async (target: string, launch: string) => {
    const slug = subMode?.slug
    if (!slug || !who) return
    setPinOpen(false)
    const ok = await mutateSubs(subs => {
      const s = subs[slug]
      if (!s) return 'this sub-main dissolved'
      if (!s.members[who.id]) return 'join first — only members pin'
      if (s.pinsLocked && s.ownerId !== who.id) return 'the founder closed the shelf — pinning is founder-only right now'
      s.shelf[target] = { launch, addedBy: who.name, at: Date.now() }
      return null
    })
    if (ok) window.dispatchEvent(new CustomEvent('cafe:caption', { detail: { text: 'pinned ' + target, kind: 'tuned' } }))
  }

  /** ── moderation: the founder AND admins kick/ban members; admins are unkickable.
   *  A ban stands for one month (server-enforced in validateSubmainsWrite). ── */
  const BAN_MS = 30 * 24 * 60 * 60_000
  const canMod = (s: SubEntry) => !!who && (s.ownerId === who.id || (s.admins || []).includes(who.id))
  const unkickable = (s: SubEntry, uid: string) => uid === s.ownerId || (s.admins || []).includes(uid)

  const kickMember = async (uid: string) => {
    const slug = subMode?.slug
    if (!who || !slug) return
    await mutateSubs(subs => {
      const s = subs[slug]
      if (!s) return 'this sub-main dissolved'
      if (!canMod(s)) return 'only the founder or an admin moderates'
      if (unkickable(s, uid)) return 'admins are unkickable'
      delete s.members[uid]
      return null
    })
  }

  const banUser = async (uid: string, name: string) => {
    const slug = subMode?.slug
    if (!who || !slug) return
    const ok = await mutateSubs(subs => {
      const s = subs[slug]
      if (!s) return 'this sub-main dissolved'
      if (!canMod(s)) return 'only the founder or an admin moderates'
      if (unkickable(s, uid)) return 'admins cannot be banned'
      s.bans = s.bans || {}
      s.bans[uid] = { until: Date.now() + BAN_MS, name, by: who.name }
      delete s.members[uid]
      return null
    })
    if (ok) window.dispatchEvent(new CustomEvent('cafe:caption', { detail: { text: 'banned ' + name + ' · 1 month', kind: 'tuned' } }))
  }

  const unbanUser = async (uid: string) => {
    const slug = subMode?.slug
    if (!who || !slug) return
    await mutateSubs(subs => {
      const s = subs[slug]
      if (!s) return 'this sub-main dissolved'
      if (!canMod(s)) return 'only the founder or an admin moderates'
      if (s.bans) delete s.bans[uid]
      return null
    })
  }

  /** find a player by name — the search half of the kick/ban tool */
  const [userQuery, setUserQuery] = useState('')
  const [userResults, setUserResults] = useState<{ id: string; name: string | null; image: string | null }[]>([])
  const searchUsers = async (q: string) => {
    setUserQuery(q)
    if (q.trim().length < 2) { setUserResults([]); return }
    try {
      const j = await fetch('/api/users/search?q=' + encodeURIComponent(q.trim())).then(r => r.json())
      setUserResults(Array.isArray(j.users) ? j.users : [])
    } catch { setUserResults([]) }
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
You may open your world's page in your own (headless) browser as your eyes —
GET the bridge URL and use space.viewUrl (it can change when I name the world).
Your view is yours: it never takes my seat and never counts in head-counts.`
  }
  const brew = async () => {
    const sess = await fetch('/api/auth/session').then(r => r.json()).catch(() => null)
    if (!sess?.user) { window.location.href = '/auth/signin?callbackUrl=' + encodeURIComponent('/?brew=1'); return }
    setBrewErr('')
    // restore an in-progress draft — a mistaken exit shouldn't lose their words.
    // Cleared only when the world is made (finalizeBrief) or they wipe it themselves.
    try {
      setBrewName(localStorage.getItem('cafe:brew:name') || '')
      setBrewBrief(localStorage.getItem('cafe:brew:brief') || '')
    } catch { setBrewName(''); setBrewBrief('') }
    setBrewAi(false); setBrewNameOk(null); setBrewChecking(false)
    brewFinalizedRef.current = false
    // sweep my own abandoned drafts first — unnamed, unbuilt, invisible
    try {
      const b = await fetch('/api/spaces/browse').then(r2 => r2.json())
      const now = Date.now()
      for (const sp of (b.spaces || [])) {
        // Sweep only GENUINELY abandoned drafts. A blank draft is NOT abandoned if
        // it is mid-brief (a creation_brief was set) or was just touched — those are
        // in-flight connects, and deleting them cascade-kills the token we just
        // handed to an AI (the "engine gave me a token that 401s" bug). Require the
        // draft to be blank, not-building, AND untouched for >1h before removing it.
        const stale = sp.updatedAt && (now - new Date(sp.updatedAt).getTime() > 60 * 60 * 1000)
        if (sp.owner?.id === sess.user.id && sp.blank && !sp.building && stale) {
          await fetch('/api/spaces/' + sp.slug, { method: 'DELETE' }).catch(() => {})
        }
      }
    } catch { /* best effort */ }
    // a DRAFT is born now — private, off every shelf — so its AI key can
    // exist before anything else. ENTER WORLD is what makes it a world.
    // a blank draft is named with a timestamp (unique + sortable) until the player names it
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const r = await fetch('/api/spaces', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: stamp, slug: 'w-' + Math.random().toString(36).slice(2, 8), draft: true }),
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
    if (brewAi && connectReady) finalizeBrief()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brewAi, connectReady])
  // is a swarm builder (house AI or a volunteer) online right now? gates the
  // "have the house AI build it" button so a player with no AI can still ship.
  useEffect(() => {
    if (brewStep < 1) { setHouseAiUp(false); return }
    let alive = true
    const check = () => fetch('/api/builds/availability').then(r => r.json())
      .then(d => { if (alive) setHouseAiUp(!!d.available) }).catch(() => {})
    check()
    const iv = setInterval(check, 15_000)
    return () => { alive = false; clearInterval(iv) }
  }, [brewStep])
  // draft autosave: keep the name + brief so a mistaken exit (close, reload,
  // navigate away) restores them on reopen. Cleared on world-made or manual wipe.
  useEffect(() => {
    if (brewStep < 1) return
    try {
      localStorage.setItem('cafe:brew:name', brewName)
      localStorage.setItem('cafe:brew:brief', brewBrief)
    } catch { /* storage blocked/full — non-fatal */ }
  }, [brewName, brewBrief, brewStep])
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
  /** Deliver the brief and open the world — fired either by the player's OWN AI
   *  logging in (brewAi), or by "have the house AI build it": setting the brief
   *  enqueues it, and a resident/volunteer builder picks it up and builds live. */
  const finalizeBrief = async () => {
    if (brewFinalizedRef.current || !connectReady) return
    brewFinalizedRef.current = true
    setBrewErr('')
    const r = await fetch('/api/spaces/' + brewSlugRef.current, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: brewName.trim(), slugFromName: true, brief: brewBrief.trim() }),
    }).catch(() => null)
    const d = await r?.json().catch(() => null)
    if (!r || !r.ok) { brewFinalizedRef.current = false; setBrewErr(d?.error || 'could not open the world'); return }
    if (d?.space?.slug) { brewSlugRef.current = d.space.slug; setBrewSlug(d.space.slug) }
    // the world is made — the draft did its job; drop the saved name + brief
    try { localStorage.removeItem('cafe:brew:name'); localStorage.removeItem('cafe:brew:brief') } catch { /* non-fatal */ }
    enterWorld()
  }
  /** wipe the saved draft on purpose — name + brief back to blank */
  const clearDraft = () => {
    setBrewName(''); setBrewBrief(''); setBrewNameOk(null)
    try { localStorage.removeItem('cafe:brew:name'); localStorage.removeItem('cafe:brew:brief') } catch { /* non-fatal */ }
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
    setChatWorld(null)  // the commons never follows you: returning to main lands on the SHELF, always
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
    const onLaunch = async (e: Event) => {
      const name = (e as CustomEvent).detail
      if (typeof name !== 'string' || !name) return
      if (name.startsWith('space:')) { window.location.href = '/space/' + name.slice(6); return }
      if (name.startsWith('sub:')) {
        // entering a group is an in-scene morph, not a departure — the
        // SUB-MAIN world repolls its roster off this flag on its next frame
        ;(window as unknown as { __cafeSub?: string | null }).__cafeSub = name.slice(4)
        return
      }
      // king-of-the-hill: the door says "ORCHID", but entering it loads whoever
      // currently holds MAIN — the branch that won its arena — not the frozen
      // original. A branch or hub launches as itself; the ★ ORIGINAL bookmark
      // (in the world chrome) always returns to the immortal original.
      let target = name
      if (!name.includes(' ⑂ ') && name !== 'CAFE' && name !== 'SUB-MAIN') {
        try {
          const lin = (await fetch(`/api/engine/save?action=load&slot=${encodeURIComponent('lineage:' + name.toUpperCase())}`).then(r => r.json()))?.data
          if (lin?.mainHolder && lin.original && lin.mainHolder !== lin.original) target = lin.mainHolder
        } catch { /* offline → the original is a fine fallback */ }
      }
      go(target)
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
        // MY WORLDS must be a place you GO, not a mode that haunts the tab:
        // a plain reload lands on the commons. Only the explicit ?mine=1
        // (the sign-in round-trip) restores the personal view.
        const wantsMine = new URLSearchParams(window.location.search).has('mine')
        if (!wantsMine) { try { sessionStorage.removeItem('cafe-mine') } catch { /* private mode */ } }
        if (navType !== 'back_forward' && wantsMine) {
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
      if (d.kind !== 'typing') captionTimer.current = setTimeout(() => setCaption(null), 3000)
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
      // a pop while the reckoning is open is ITS throwaway entry unwinding —
      // the arena closes itself; re-navigating here would yank the scene and
      // make browser-back feel nothing like the ✕ (which it must equal)
      if (votingRef.current) return
      const m = window.location.pathname.match(/^\/play\/(.+)$/)
      go(m ? decodeURIComponent(m[1]) : 'CAFE', false)
    }
    const onMove = (e: PointerEvent) => setMouse({ x: e.clientX, y: e.clientY })
    const onPortals = (e: Event) => {
      if (votingRef.current) return   // previewing a world under the reckoning — its doors are not contenders
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
    // the ONE back button (engine's identity strip) asks us to leave a world
    const onBack = () => {
      // one layer at a time: an open reckoning closes first — the ◂ does
      // exactly what its ✕ does — and only the NEXT ◂ asks about leaving
      if (votingRef.current) { window.dispatchEvent(new CustomEvent('cafe:close-reckoning')); return }
      if (confirmRef.current) stay(); else openConfirm()
    }
    window.addEventListener('cafe:back', onBack)
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
      window.removeEventListener('cafe:back', onBack)
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

  // Bubble icons are LIVING SHADER EMBLEMS drawn in the door itself: each world
  // wears its own palette (hue from its field colors, carried in the per-bubble
  // uniform by the door hook). No screenshots, no atlas, no /thumbs, nothing
  // stored. House worlds keep their hand-coded minis; everything else is a
  // living emblem in its own color.

  // on entering a game world (not the cafe / group nav), maybe show a contained
  // ad — throttled to at most once every 4 min. The server serves nothing to a
  // protected viewer or a protected world (pay-to-protect = ad-free everywhere).
  useEffect(() => {
    if (!ADS_ENABLED || scene === 'CAFE' || scene === 'SUB-MAIN' || !scene) return
    let cancelled = false
    let last = 0
    try { last = +(localStorage.getItem('cc-ad-t') || 0) } catch { /* private mode */ }
    if (Date.now() - last < 4 * 60 * 1000) return
    fetch('/api/engine/ads?world=' + encodeURIComponent(scene)).then(r => r.json()).then(d => {
      if (cancelled || !d?.ad) return
      try { localStorage.setItem('cc-ad-t', String(Date.now())) } catch { /* ignore */ }
      setAd(d.ad)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [scene])

  // PLAY-TIME heartbeat — the substrate for XP + the Vote's factory order. While
  // genuinely playing a game world (tab visible, recent input), beat the server
  // every 10s; it rate-limits and accrues authoritatively, so this is a dumb
  // signal, never a trusted counter. Idle > 60s or a hidden tab stops accruing.
  useEffect(() => {
    if (scene === 'CAFE' || scene === 'SUB-MAIN' || !scene) return
    let lastActive = Date.now()
    const bump = () => { lastActive = Date.now() }
    window.addEventListener('pointermove', bump)
    window.addEventListener('keydown', bump)
    window.addEventListener('pointerdown', bump)
    const iv = setInterval(() => {
      if (document.hidden || Date.now() - lastActive > 60_000) return
      fetch('/api/engine/playtime', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ world: scene }) }).catch(() => {})
    }, 10_000)
    return () => {
      clearInterval(iv)
      window.removeEventListener('pointermove', bump)
      window.removeEventListener('keydown', bump)
      window.removeEventListener('pointerdown', bump)
    }
  }, [scene])

  return (
    <>
      {/* BOOT SPINNER — the door publishes portals on its first live frame;
          until then the canvas is black (engine compiling, scene loading).
          A DOM ring covers that gap so loading is visible from first paint. */}
      {scene === 'CAFE' && portals.length === 0 && (
        <div className="fixed inset-0 z-30 pointer-events-none flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-full border-2 border-brass/20 border-t-flame/70 animate-spin" />
            <div className="font-mono text-[12px] tracking-[0.3em] text-crema/40 uppercase">the shelf is waking</div>
          </div>
        </div>
      )}
      {ad && <AdInterstitial ad={ad} onClose={() => setAd(null)} />}
      <FieldEngine playScene={voting && previewScene ? previewScene : scene}
        onDockRect={setDockBottom}
        viewport={voting && stageRect ? { top: stageRect.top, right: Math.max(0, vp.w - stageRect.right), bottom: Math.max(0, vp.h - stageRect.bottom), left: stageRect.left } : null} />

      {/* the rolling tournament — every page is its own arena.
          commons: all core worlds · MY WORLDS: your deeds · SUB-MAIN: the
          branch shelf · a world: MAIN vs its branches (what promotion enacts).
          While DOCKED, the main arena rides along into worlds (so a voter can
          see the contenders) and every other arena stands down. */}
      {/* the main arena STAYS on the hub — it no longer rides into worlds
          (docked): inside a world the only vote you see is that world's own
          branch arena. Traveling mid-deliberation lands you in the world;
          the main reckoning waits back at the cafe. */}
      {scene === 'CAFE' && !mine && (
        <TournamentBar key="arena-main" visible={!modalUp && !confirmLeave} slot="tournament:main" worlds={mainRoster}
          bubbles={scene === 'CAFE' ? portals : undefined}
          onReckoning={(on) => { setVoting(on); if (!on) { setPreviewScene(null); setStageRect(null) } }} onPreview={(w) => setPreviewScene(w ? (launchMapRef.current[w] || w) : null)} onStageRect={setStageRect}
          rail={scene !== 'CAFE'} railTop={dockBottom ? dockBottom + 8 : undefined}
          docked={docked} onDock={setDocked} onTravel={travelTo} sceneKey={scene}
          onCloseHome={() => { setDocked(false); if (sceneRef.current !== 'CAFE') go('CAFE') }}
          emptyHint="⚔ THE ARENA WAITS FOR WORLDS" />
      )}
      {scene === 'CAFE' && mine && (
        <TournamentBar key={`arena-mine-${mine}`} visible={!modalUp} slot={`tournament:mine:${mine}`} worlds={portals.map(pt => pt.name)}
          bubbles={portals}
          onReckoning={(on) => { setVoting(on); if (!on) { setPreviewScene(null); setStageRect(null) } }} onPreview={(w) => setPreviewScene(w ? (launchMapRef.current[w] || w) : null)} onStageRect={setStageRect}
          emptyHint="⚔ BREW A SECOND WORLD TO OPEN YOUR ARENA" />
      )}
      {scene === 'SUB-MAIN' && (
        <TournamentBar key={subMode?.slug ? `arena-sub-${subMode.slug}` : 'arena-submain'} visible={!modalUp}
          slot={subMode?.slug ? `tournament:sub:${subMode.slug}` : 'tournament:submain'}
          worlds={portals.map(pt => pt.name)}
          bubbles={portals}
          onReckoning={(on) => { setVoting(on); if (!on) { setPreviewScene(null); setStageRect(null) } }} onPreview={(w) => setPreviewScene(w ? (launchMapRef.current[w] || w) : null)} onStageRect={setStageRect}
          emptyHint="⚔ PIN TWO WORLDS TO OPEN THIS ARENA" />
      )}
      {scene !== 'CAFE' && scene !== 'SUB-MAIN' && (
        <TournamentBar
          key={`arena-world-${scene.split(' ⑂ ')[0]}`}
          visible={!modalUp && !confirmLeave}
          slot={`tournament:world:${scene.split(' ⑂ ')[0]}`}
          branchesOf={scene.split(' ⑂ ')[0]}
          sceneKey={scene}
          rail railTop={dockBottom ? dockBottom + 8 : undefined}
          onReckoning={(on) => { setVoting(on); if (!on) { setPreviewScene(null); setStageRect(null) } }}
          onPreview={setPreviewScene}
          onStageRect={setStageRect}
        />
      )}

      {/* a name surfaces where you're looking, then gets out of the way */}
      {portals.length > 0 && hover && !modalUp && !voting && (mouse.x !== 0 || mouse.y !== 0) && (
        <div
          className="fixed z-50 pointer-events-none select-none rounded-xl bg-black/60 backdrop-blur-sm border border-brass/20 px-3.5 py-2.5"
          style={{ left: Math.min(mouse.x + 30, Math.max(0, vp.w - 250)), top: Math.max(8, mouse.y - 8) }}
        >
          <div className="cafe-sign text-xl leading-none">{hover.toLowerCase()}</div>
          <div className="font-mono text-[12px] tracking-[0.25em] text-crema/60 uppercase mt-1.5">
            {BLURBS[hover] || ''} · click to enter
          </div>
        </div>
      )}

      {/* (bubble faces are drawn INSIDE the door shader now — see the icon-atlas
          effect above; no DOM overlay layer exists to drift) */}

      {/* (head-counts are drawn INSIDE each bubble by the door shader now —
          see the stride-4 publish + cafeCount() in shaders.ts; no DOM overlay) */}

      {/* a world's OSD — old TV set lettering, top-left of the glass */}
      {caption && (caption.text || caption.kind === 'typing') && !voting && (
        <div className="fixed top-8 left-10 z-50 pointer-events-none select-none font-mono uppercase tracking-[0.3em]"
          style={{
            color: caption.kind === 'hint' ? 'rgba(140,255,170,0.45)' : 'rgb(140,255,170)',
            fontSize: caption.kind === 'hint' ? 11 : 22,
            textShadow: '0 0 8px rgba(80,255,140,0.8), 0 0 28px rgba(80,255,140,0.35)',
          }}>
          {caption.text}{caption.kind === 'typing' ? '▮' : ''}
        </div>
      )}

      {/* THE universal back — the same ◂ strip the engine draws inside worlds,
          extended to every shell surface with an "up" to go to. One glyph, one
          place (top-left, under the sign), one style, everywhere: group →
          SUB-MAINS, SUB-MAIN hub → CAFE, MY WORLDS → CAFE. Only the CAFE root
          has no back. Replaces the per-surface ⟵ buttons that used to live in
          the top-right clusters. */}
      {!modalUp && !voting && (() => {
        const up = scene === 'SUB-MAIN'
          ? (subMode?.mode === 'group'
              ? { label: 'SUB-MAINS', leave: () => { (window as unknown as { __cafeSub?: string | null }).__cafeSub = null } }
              : { label: 'CAFE', leave: () => go('CAFE') })
          : (scene === 'CAFE' && mine ? { label: 'CAFE', leave: commons } : null)
        if (!up) return null
        return (
          <div className="fixed left-6 top-24 z-50">
            <button onClick={up.leave} title="back"
              className="px-2.5 py-1 rounded-lg font-mono text-[13px] text-white/70 hover:text-white bg-black/55 backdrop-blur border border-white/10 hover:bg-black/80 transition-colors">
              ◂ <span className="text-[12px] tracking-[0.2em] text-white/45">{up.label}</span>
            </button>
          </div>
        )
      })()}

      {/* the group layer's controls — same PLACE + STYLE as the cafe dock's
          (top-right, rounded), so main→sub-main isn't a jarring re-layout. The
          sub-main's name shows under the title (like MY WORLDS), not inline. */}
      {scene === 'SUB-MAIN' && !modalUp && !voting && (
        <div className="fixed top-5 right-6 z-50 flex gap-2">
          {!who && (
            <button onClick={() => { window.location.href = '/auth/signin?callbackUrl=' + encodeURIComponent(window.location.pathname) }}
              className={`${hubBtn} border-flame/50 text-glow`}>SIGN IN</button>
          )}
          {subMode?.mode === 'group' ? (<>
            {who && !subMode.member && <button onClick={joinSub} className={hubBtn}>JOIN</button>}
            {/* found your OWN sub-main from inside another one (one per person) */}
            {who && !subMode.haveOwn && <button onClick={foundSub} className={hubBtn}>⌂ FOUND YOURS</button>}
            {who && subMode.member && (subMode.owner || !subMode.pinsLocked) && (
              <button onClick={openPin} className={hubBtn}>+ PIN A WORLD</button>
            )}
            {who && subMode.member && !subMode.owner && subMode.pinsLocked && (
              <span className="self-center font-mono text-[12px] tracking-[0.2em] text-white/35 px-1">SHELF CLOSED</span>
            )}
            {who && (subMode.owner || (subMode.admins || []).includes(who.id)) && (
              <button onClick={() => setSubTools(o => !o)} className={hubBtn}>⚙ TOOLS</button>
            )}
            {subMode.slug && (
              <button onClick={() => setChatWorld({ channel: 'chat:sub:' + subMode.slug, title: (subMode.name || 'sub-main') + ' · chat', subtitle: 'check in on this sub-main' })}
                className={hubBtn}>⌁ CHAT</button>
            )}
          </>) : (
            !subMode?.haveOwn && (
              <button onClick={foundSub} className={hubBtn}>⌂ FOUND YOURS</button>
            )
          )}
        </div>
      )}

      {/* the sub-chant moderation desk: members, kick/ban, pins, shelf rule.
          Open to the founder AND admins (co-devs). Founder-only controls stay gated. */}
      {scene === 'SUB-MAIN' && !modalUp && !voting && subTools && subMode?.mode === 'group' && (subMode.owner || (subMode.admins || []).includes(who?.id || '')) && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 w-[380px] max-w-[90vw] max-h-[55vh] overflow-y-auto rounded-xl bg-[#171009]/90 backdrop-blur border border-[#b97a2a]/25 p-3 space-y-3 font-mono text-[12px] tracking-[0.15em]">
          {subMode.owner && (
            <div className="flex items-center justify-between">
              <span className="text-brass">SHELF RULE</span>
              <button onClick={togglePins} className="brass-tab px-2 py-1">
                {subMode.pinsLocked ? 'PINNING: FOUNDER ONLY' : 'PINNING: ALL MEMBERS'}
              </button>
            </div>
          )}
          <div>
            <div className="text-brass mb-1">MEMBERS · {Object.keys(subMode.members || {}).length}</div>
            {Object.entries(subMode.members || {}).map(([uid, mName]) => {
              const unkick = uid === subMode?.ownerId || (subMode?.admins || []).includes(uid)
              const badge = uid === subMode?.ownerId ? ' · founder' : (subMode?.admins || []).includes(uid) ? ' · admin' : ''
              return (
                <div key={uid} className="flex justify-between items-center py-0.5">
                  <span className="text-white/70">{mName}{badge}</span>
                  {!unkick && (
                    <span className="flex gap-2">
                      <button onClick={() => kickMember(uid)} className="text-flame/80 hover:text-flame">KICK</button>
                      <button onClick={() => banUser(uid, mName)} className="text-red-400/80 hover:text-red-400">BAN</button>
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {/* find any player by name, then kick or ban them from this sub-chant */}
          <div>
            <div className="text-brass mb-1">FIND A USER</div>
            <input value={userQuery} onChange={e => searchUsers(e.target.value)}
              placeholder="search a name to kick / ban…"
              className="w-full bg-black/40 border border-white/15 rounded px-2 py-1.5 text-white/80 outline-none focus:border-amber-400/40 mb-1" />
            {userResults.map(u => {
              const unkick = u.id === subMode?.ownerId || (subMode?.admins || []).includes(u.id)
              return (
                <div key={u.id} className="flex justify-between items-center py-0.5">
                  <span className="text-white/70">{u.name || u.id.slice(0, 6)}{(subMode?.members || {})[u.id] ? ' · member' : ''}</span>
                  {unkick ? <span className="text-white/30">protected</span> : (
                    <span className="flex gap-2">
                      <button onClick={() => kickMember(u.id)} className="text-flame/80 hover:text-flame">KICK</button>
                      <button onClick={() => banUser(u.id, u.name || 'user')} className="text-red-400/80 hover:text-red-400">BAN</button>
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {/* the banned — a ban stands for one month; a moderator may lift it early */}
          {Object.keys(subMode.bans || {}).length > 0 && (
            <div>
              <div className="text-brass mb-1">BANNED · {Object.keys(subMode.bans || {}).length}</div>
              {Object.entries(subMode.bans || {}).map(([uid, b]) => (
                <div key={uid} className="flex justify-between items-center py-0.5">
                  <span className="text-white/45">{b.name || uid.slice(0, 6)} · until {new Date(b.until).toLocaleDateString()}</span>
                  <button onClick={() => unbanUser(uid)} className="text-emerald-400/80 hover:text-emerald-400">UNBAN</button>
                </div>
              ))}
            </div>
          )}

          {subMode.owner && (
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
          )}
        </div>
      )}

      {/* the commons chat WORLD — a structural door on main; entering it renders
          the full chat world over everything. The door waits for the room:
          it appears WITH the woken shelf, never popping in over the boot
          spinner or the return-from-a-world transition. */}
      <MainCommonsChat visible={scene === 'CAFE' && !modalUp && !voting && brewStep === 0 && !chatWorld}
        onEnter={() => setChatWorld({ channel: 'commons:main', title: 'The Commons', subtitle: 'the AIs at scale' })} />
      {/* each sub-main gets the SAME prominent commons door as main, scoped to it */}
      <MainCommonsChat
        visible={scene === 'SUB-MAIN' && subMode?.mode === 'group' && !!subMode?.slug && !modalUp && !voting && !chatWorld}
        channel={'commons:sub:' + (subMode?.slug || '')}
        label={(subMode?.name || 'sub-main').toUpperCase() + ' COMMONS'}
        onEnter={() => setChatWorld({ channel: 'commons:sub:' + subMode!.slug, title: (subMode?.name || 'sub-main') + ' · commons', subtitle: 'this sub-main’s AIs, at scale' })} />
      {/* render-gated too: the commons can ONLY exist over a dock scene — never
          over a world, never during a transition frame */}
      {chatWorld && (scene === 'CAFE' || scene === 'SUB-MAIN') && <ChatWorld channel={chatWorld.channel} title={chatWorld.title} subtitle={chatWorld.subtitle} onExit={() => setChatWorld(null)} />}

      {/* PIN A WORLD — live search box in the cafe's own colors (was a browser prompt) */}
      {pinOpen && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center pt-24 bg-void/70 backdrop-blur-sm" onClick={() => setPinOpen(false)}>
          <div className="w-[92%] max-w-md rounded-xl border border-brass/40 bg-void/95 p-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="cafe-sign text-lg">pin a world</div>
              <button onClick={() => setPinOpen(false)} aria-label="close" className="font-mono text-glow/50 hover:text-glow text-sm px-1">×</button>
            </div>
            <input autoFocus value={pinQuery} onChange={e => setPinQuery(e.target.value)}
              placeholder="search worlds on main…" maxLength={64}
              className="w-full rounded-lg border border-brass/40 bg-void/60 px-3 py-2 font-mono text-[14px] text-glow placeholder:text-steamer/40 focus:border-flame/60 outline-none mb-3" />
            <div className="max-h-64 overflow-y-auto flex flex-col gap-1">
              {pinWorldList.length === 0 ? (
                <div className="font-mono text-[12px] text-glow/30 px-2 py-4">loading worlds…</div>
              ) : (() => {
                const q = pinQuery.trim().toUpperCase()
                const hits = pinWorldList.filter(w => w.name.includes(q)).slice(0, 40)
                if (hits.length === 0) return <div className="font-mono text-[12px] text-glow/30 px-2 py-4">no world by that name on main</div>
                return hits.map(w => (
                  <button key={w.launch} onClick={() => doPin(w.name, w.launch)}
                    className="text-left rounded-lg border border-brass/20 hover:border-flame/60 hover:bg-flame/10 px-3 py-2 font-mono text-[13px] tracking-[0.1em] text-steamer/90 hover:text-glow transition-colors">
                    {w.name.toLowerCase()}
                  </button>
                ))
              })()}
            </div>
          </div>
        </div>
      )}

      {/* the cafe's ears — one small switch, bottom-right */}
      <button
        onClick={() => { setMuted(!mute); setMute(!mute) }}
        aria-label={mute ? 'Unmute' : 'Mute'}
        style={{ display: voting ? 'none' : undefined }}
        className="fixed bottom-4 right-4 z-50 w-8 h-8 rounded-full border border-brass/40 bg-void/60 backdrop-blur-sm text-glow/60 hover:text-glow font-mono text-[13px] transition-colors"
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
            <div className="flex gap-3 mb-4 font-mono text-[12px] tracking-[0.2em]">
              <span className={nameValid ? 'text-glow' : 'text-crema/40'}>{nameValid ? '✓' : '1'} NAME</span>
              <span className={briefLen >= 100 && briefLen <= 500 ? 'text-glow' : 'text-crema/40'}>{briefLen >= 100 && briefLen <= 500 ? '✓' : '2'} BRIEF</span>
              <span className={brewAi && connectReady ? 'text-glow' : 'text-crema/40'}>{brewAi && connectReady ? '⚒' : '3'} CONNECT AI</span>
            </div>
            <div className="flex items-baseline justify-between mb-4">
              <div className="cafe-sign text-2xl">brew your world</div>
              {(brewName || brewBrief) && (
                <button onClick={clearDraft}
                  className="font-mono text-[12px] tracking-[0.15em] text-crema/40 hover:text-flame transition-colors">
                  clear draft
                </button>
              )}
            </div>

            {/* GATE 1 — NAME (5–20 chars, unique) */}
            <div className="mb-1 font-mono text-[12px] tracking-[0.2em] text-crema/50">1 · NAME IT</div>
            <input autoFocus value={brewName} maxLength={20}
              onChange={e => setBrewName(e.target.value)}
              placeholder="e.g. Tidepool Abbey"
              className={'w-full rounded-lg bg-black/50 border px-3 py-2.5 font-mono text-sm text-glow outline-none mb-1 focus:border-brass '
                + (nameValid ? 'border-glow/60' : 'border-brass/30')} />
            <div className="font-mono text-[12px] tracking-[0.15em] mb-4 min-h-[13px]">
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
              <div className="mb-1 font-mono text-[12px] tracking-[0.2em] text-crema/50">
                2 · TELL IT WHAT TO BUILD {!nameValid && <span className="text-crema/40">· name it first</span>}
              </div>
              <textarea value={brewBrief} maxLength={500} disabled={!nameValid}
                onChange={e => setBrewBrief(e.target.value)}
                placeholder="a tidepool at dusk; anemones open when my cursor is still; crabs argue over a pearl…"
                rows={4}
                className="w-full rounded-lg bg-black/50 border border-brass/30 px-3 py-2.5 font-mono text-xs text-glow outline-none focus:border-brass mb-1 resize-none" />
              <div className="font-mono text-[12px] tracking-[0.15em] mb-4">
                <span className={briefLen >= 100 && briefLen <= 500 ? 'text-glow' : 'text-crema/50'}>{briefLen}/500</span>
                <span className="text-crema/40"> · min 100 to unlock connect</span>
              </div>
            </div>

            {/* GATE 3 — CONNECT AI: the copy text, disabled until name + brief are ready.
                the AI logging in delivers the brief, opens the world, and closes this. */}
            <div className={'transition-opacity ' + (connectReady ? 'opacity-100' : 'opacity-35 pointer-events-none select-none')}>
              <div className="mb-1 font-mono text-[12px] tracking-[0.2em] text-crema/50">
                3 · BRING YOUR OWN AI {!connectReady && <span className="text-crema/40">· finish name + brief first</span>}
              </div>
              {connectReady ? (
                <div className="rounded-lg bg-black/60 border border-brass/30 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-glow/90 whitespace-pre-wrap break-all select-all max-h-40 overflow-y-auto mb-3">
                  {connectPrompt(brewToken)}
                </div>
              ) : (
                <div className="rounded-lg bg-black/40 border border-brass/20 px-3 py-4 font-mono text-[12px] text-crema/40 text-center mb-3">
                  locked — the connection prompt appears once the name and a 100-character brief are set
                </div>
              )}
              <button disabled={!connectReady}
                onClick={() => navigator.clipboard?.writeText(connectPrompt(brewToken))}
                className="w-full rounded-lg bg-flame/90 hover:bg-glow py-2.5 font-mono text-[12px] tracking-[0.15em] text-void transition-colors disabled:opacity-35">
                COPY CONNECTION PROMPT
              </button>
              <div className="font-mono text-[12px] tracking-[0.2em] text-crema/40 text-center my-2">— or —</div>
              <button disabled={!connectReady} onClick={finalizeBrief}
                className="w-full rounded-lg bg-brass/90 hover:bg-glow py-2.5 font-mono text-[12px] tracking-[0.15em] text-void transition-colors disabled:opacity-35">
                ☕ HAVE THE HOUSE AI BUILD IT
              </button>
              <div className="font-mono text-[12px] tracking-[0.15em] mt-2 text-crema/40">
                {houseAiUp
                  ? <span className="text-glow/70">a resident AI is online — it builds your brief live while you watch.</span>
                  : 'no AI of your own? leave it to the house — your brief queues and an AI builds it as soon as one is free.'}
              </div>
              <div className="font-mono text-[12px] tracking-[0.15em] mt-2 text-crema/40">
                {brewAi && connectReady
                  ? <span className="text-glow animate-pulse">your AI connected — delivering the brief and opening your world…</span>
                  : 'paste it into an AI that can call APIs — Claude Code, Cursor, ChatGPT agent mode. plain chat windows can read it but can\u2019t build. the moment your AI logs in, your world opens'}
              </div>
            </div>
            {brewErr && <div className="font-mono text-[12px] text-red-400 mt-3">{brewErr}</div>}
          </div>
        </div>
      )}

      {/* one table per player — this tab lost the seat */}
      {blocked && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-void/85 backdrop-blur-sm">
          <div className="border border-brass/40 rounded-xl px-8 py-6 text-center bg-void/95 shadow-[0_0_60px_rgba(245,176,76,0.15)]">
            <div className="cafe-sign text-2xl mb-1">you&rsquo;re seated elsewhere</div>
            <div className="font-mono text-[12px] tracking-[0.2em] text-crema/50 uppercase mb-5">
              the cafe allows one table at a time · this tab is paused
            </div>
            <button onClick={() => claimRef.current()}
              className="rounded-lg bg-flame/90 hover:bg-glow px-5 py-2 font-mono text-[13px] tracking-[0.15em] text-void transition-colors">
              PLAY HERE
            </button>
          </div>
        </div>
      )}

      {/* the way back is now the ONE identity-strip button the engine draws
          (top-left). It dispatches cafe:back → the same pause-and-ask below.
          No second ◂ button here. */}
      {inGame && confirmLeave && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-void/60 backdrop-blur-[2px]"
          onClick={stay}>
          <div className="border border-brass/40 rounded-xl px-8 py-6 text-center bg-void/95 shadow-[0_0_60px_rgba(245,176,76,0.15)]"
            onClick={e => e.stopPropagation()}>
            <div className="cafe-sign text-2xl mb-1">leave this world?</div>
            <div className="font-mono text-[12px] tracking-[0.2em] text-crema/50 uppercase mb-5">
              the world is paused · your save keeps
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={stay}
                className="rounded-lg bg-flame/90 hover:bg-glow px-5 py-2 font-mono text-[13px] tracking-[0.15em] text-void transition-colors">
                STAY
              </button>
              <button onClick={() => {
                pause(false); skipCrumbRef.current = true
                // Back means THE DOCK. The crumb trail can carry world names
                // (stale-portal pushes) — never follow it into another world.
                const c = crumbRef.current.pop()
                go(c === 'CAFE' || c === 'SUB-MAIN' ? c : 'CAFE')
              }}
                className="brass-tab px-5 py-2 text-[13px]">
                LEAVE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* in a game: nothing but a hint that leaves */}
      {inGame && hint && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 font-mono text-[12px] tracking-[0.3em] text-glow/40 pointer-events-none select-none">
          ESC → CAFE
        </div>
      )}

      {/* the sign — the permanent chrome for BOTH hubs (cafe main + sub-main),
          so the title sits top-left in the same place on each. */}
      {(scene === 'CAFE' || scene === 'SUB-MAIN') && !voting && (
        <>
          <div className="fixed top-5 left-6 z-50 pointer-events-none select-none">
            <div className="cafe-sign text-2xl">
              cartridge<span className="not-italic font-mono text-base text-brass">.cafe</span>
            </div>
            <div className="font-mono text-[12px] tracking-[0.18em] text-glow/50 mt-1">
              Instant natural language to game world framework.
            </div>
            {mine && (
              <div className="font-mono text-[12px] tracking-[0.3em] text-brass uppercase mt-2">
                {mine}&apos;s worlds
              </div>
            )}
            {scene === 'SUB-MAIN' && subMode?.mode === 'group' && subMode.name && (
              <div className="font-mono text-[12px] tracking-[0.3em] text-brass uppercase mt-2">
                ⑂ {subMode.name}
              </div>
            )}
          </div>
          {scene === 'CAFE' && (
          <div className="fixed top-5 right-6 z-50 flex gap-2">
            {/* signed-out gets the door said out loud — every AI prompt box
                (CONNECT AI, BREW ICON, BREW YOURS) needs a session to mint its
                key, so the way in must be visible, not discovered on failure */}
            {!who && (
              <button onClick={() => { window.location.href = '/auth/signin?callbackUrl=' + encodeURIComponent(window.location.pathname) }}
                className={`${hubBtn} border-flame/50 text-glow`}>SIGN IN</button>
            )}
            {/* mine-mode's way out is the universal ◂ strip (top-left) */}
            {!mine && (
              <button onClick={myWorlds} className={`${hubBtn} opacity-60 hover:opacity-100`}>MY WORLDS</button>
            )}
            {/* lend your idle AI to the swarm — needs a session to mint a uc_bt_ */}
            <button onClick={async () => {
              if (!who) {
                const sess = await fetch('/api/auth/session').then(r => r.json()).catch(() => null)
                if (!sess?.user) { window.location.href = '/auth/signin?callbackUrl=' + encodeURIComponent(window.location.pathname); return }
              }
              setLendOpen(o => !o)
            }} className={`${hubBtn} opacity-60 hover:opacity-100 ${lendOpen ? 'border-flame/60 text-glow opacity-100' : ''}`}>
              🤝 LEND AI
            </button>
            <button onClick={async () => {
              // an AI prompt box: its token mint needs a session — auth first,
              // with a live re-check so a slow session fetch doesn't bounce a
              // signed-in player
              if (!who) {
                const sess = await fetch('/api/auth/session').then(r => r.json()).catch(() => null)
                if (!sess?.user) { window.location.href = '/auth/signin?callbackUrl=' + encodeURIComponent(window.location.pathname); return }
              }
              setIconOpen(o => !o)
            }} className={`${hubBtn} opacity-60 hover:opacity-100 ${iconOpen ? 'border-flame/60 text-glow opacity-100' : ''}`}>
              BREW ICON
            </button>
            <button onClick={brew}
              className="rounded-lg bg-flame hover:bg-glow px-5 py-2.5 font-mono text-[13px] tracking-[0.2em] text-void font-bold transition-all shadow-[0_0_28px_rgba(245,176,76,0.45)] hover:shadow-[0_0_40px_rgba(245,176,76,0.65)] hover:scale-[1.03]">
              ☕ BREW YOUR WORLD
            </button>
          </div>
          )}

          {/* LEND YOUR AI — enroll as a swarm builder, get the token + run command */}
          {scene === 'CAFE' && lendOpen && <LendAiPanel onClose={() => setLendOpen(false)} />}

          {/* BREW YOUR ICON — pick a look, hue, size; your dancing avatar updates live */}
          {iconOpen && (
            <div className="fixed top-20 right-6 z-50 w-64 rounded-xl border border-brass/40 bg-void/90 backdrop-blur-sm p-4 select-none">
              <div className="flex items-start justify-between mb-2">
                <div className="cafe-sign text-lg">brew your icon</div>
                <button onClick={() => setIconOpen(false)} aria-label="close"
                  className="font-mono text-glow/50 hover:text-glow text-sm leading-none -mt-0.5 px-1">×</button>
              </div>
              <div className="font-mono text-[12px] text-glow/40 leading-relaxed mb-2">
                describe your icon, then hand the prompt to your AI — it authors a
                safe, gentle avatar for you and confirms.
              </div>
              <textarea
                value={iconPrompt}
                onChange={e => setIconPrompt(e.target.value)}
                placeholder="a shy blue jellyfish that drifts…"
                maxLength={200}
                rows={3}
                className="w-full resize-none rounded-md border border-brass/30 bg-void/60 px-2 py-1.5 font-mono text-[13px] text-glow placeholder:text-steamer/40 focus:border-flame/60 outline-none mb-2"
              />
              <button onClick={copyIconPrompt} disabled={iconPrompt.trim().length < 3}
                className="w-full rounded-md bg-flame/90 hover:bg-glow disabled:opacity-40 px-3 py-2 font-mono text-[12px] tracking-[0.15em] text-void transition-colors">
                {iconCopied ? 'COPIED ✓' : 'COPY FOR YOUR AI'}
              </button>
            </div>
          )}
        </>
      )}
    </>
  )
}
