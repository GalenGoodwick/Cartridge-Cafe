'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** The rolling tournament — Unity Chant at every level of the cafe.
 *
 *  One bar, many arenas. Each page mounts it with its own save-slot and its
 *  own roster:
 *    · main (commons)      tournament:main         over all core worlds
 *    · MY WORLDS submain   tournament:mine:<who>   over your own deeds
 *    · SUB-MAIN            tournament:submain      over the branch shelf
 *    · any world page      tournament:world:<name> over MAIN vs its branches
 *
 *  Contestants are dealt into balanced cells of ≤5 (7 worlds → 4+3). One voice
 *  per cell. When every cell has spoken, the tier resolves: winners advance (gravity reads
 *  `reached` where a door listens), losers keep the tier they earned. One
 *  survivor = champion — and in the same breath the next round is dealt.
 *  Always rolling; a crown holds only until the next coronation.
 *
 *  World-page arenas answer the question the branches exist to ask: should a
 *  branch replace MAIN? The winner here is what promotion (BRANCHES v1) will
 *  enact server-side.
 *
 *  v0 truth model: docs in save-slots, last-write-wins, law applied client-
 *  side — same law as branch cells until enforcement moves server-side.
 */

type Cell = {
  worlds: string[]
  votes: Record<string, string>
  voteAt?: Record<string, number>   // when each voter cast (record only; the cell locks at QUORUM voices, not on a timer)
  // deliberation, just like UC: per-world comment threads inside the cell.
  // They live and die with the tier — a fresh deal is a fresh conversation.
  comments?: Record<string, { who: string; text: string; at: number }[]>
}
type TDoc = {
  round: number
  tier: number
  cells: Cell[]
  tierAt?: number                 // when this tier was dealt (kept for record; no longer a clock)
  reached: Record<string, number>
  reachedAt?: Record<string, number>   // when each world last earned its standing — the constellation decays it over days
  champion: string | null
  championAt: number
  champTier?: number              // the tier the reigning champion was crowned at
}

// UC: one participant belongs to ONE cell per tier. A tier resolves only when
// every cell has gathered a QUORUM of distinct voices — no clock, and no single
// vote can crown anything. Low-traffic arenas simply wait; the day-scale decay
// on the constellation keeps a stale standing from lingering.
const QUORUM = 5   // distinct voters a FULL cell needs to resolve — AND the point at which
                   // votes lock. Until the 5th voice lands, every vote stays freely
                   // changeable; the 5th settles the cell. (No time-based lock.)
/** the BASE FLOOR scales with the cell: a full cell of 5 needs 5 voices, a 4-cell
 *  needs 4, and 3 is the floor (even a 2-world duel needs 3 voices, so one voice
 *  can never settle anything and a duel can't deadlock 1–1). Ties at any quorum
 *  fall to cellWinner's deterministic hash break. */
const cellQuorum = (c: Cell) => Math.min(QUORUM, Math.max(3, c.worlds.length))
// The VOTE-rules gate is accept-once. localStorage is the durable store, but some
// contexts DENY it (private mode, partitioned/sandboxed storage) — there, getItem
// throws, `accepted` stays false, and the warning pops EVERY time. This module-
// level flag is the in-memory fallback: once accepted it holds for the session
// regardless of storage, so the gate never nags twice.
let gateAcceptedMem = false
// (the day-scale decay on a world's pull lives in the CAFE hook, where the constellation is drawn)

const hash = (s: string) => {
  let h = 2166136261
  for (const c of s) { h ^= c.charCodeAt(0); h = (h * 16777619) >>> 0 }
  return h
}

/** deal contestants into cells of ≤5, deterministically shuffled per round, and
 *  BALANCED evenly across the fewest cells — 7 worlds → 4+3 (not 5+2), 6 → 3+3,
 *  11 → 4+4+3. Even cells make each deliberation the same weight, and balancing
 *  can never strand a lone cell of one. */
function deal(worlds: string[], round: number): Cell[] {
  const order = [...worlds].sort((a, b) => hash(a + ':' + round) - hash(b + ':' + round))
  const n = order.length
  if (n === 0) return []
  const numCells = Math.ceil(n / 5)      // fewest cells that keep every cell ≤5
  const base = Math.floor(n / numCells)  // even floor size
  const rem = n % numCells               // this many cells carry one extra (the remainder)
  const cells: Cell[] = []
  let i = 0
  for (let c = 0; c < numCells; c++) {
    const size = base + (c < rem ? 1 : 0)
    cells.push({ worlds: order.slice(i, i + size), votes: {} })
    i += size
  }
  return cells
}

function cellWinner(c: Cell, round: number): string | null {
  const tally: Record<string, number> = {}
  for (const w of Object.values(c.votes)) tally[w] = (tally[w] || 0) + 1
  let best: string | null = null
  for (const w of c.worlds) {
    if (best === null) { best = w; continue }
    const a = tally[w] || 0, b = tally[best] || 0
    if (a > b || (a === b && hash(w + ':' + round) < hash(best + ':' + round))) best = w
  }
  return best
}

export default function TournamentBar({ slot, worlds, branchesOf, visible, emptyHint, sceneKey, rail, railTop, onReckoning, onPreview, onStageRect }: {
  slot: string
  worlds?: string[]              // roster handed in (door pages: the visible bubbles)
  branchesOf?: string            // world pages: self-fetch MAIN + this world's branches
  visible: boolean
  emptyHint?: string             // what to say while the arena waits for two contenders
  docked?: boolean               // deliberating: the bar rides along into worlds
  onDock?: (d: boolean) => void  // the shell keeps the bar mounted while docked
  onTravel?: (world: string) => void   // clicking a contender's name loads it
  onCloseHome?: () => void       // ✕: undock and return to this arena's door
  sceneKey?: string              // the scene under the bar — changing it minimizes the panel
  rail?: boolean                 // in-world: sit in the right rail under the AI lamp, not bottom-center
  railTop?: number               // in-world: the y (px) to seat the rail button at — just under the engine's UI dock, so VOTE lands beneath AI plugged/unplugged
  bubbles?: { name: string; x: number; y: number; r: number }[]   // live constellation bubble positions (screen px) — the 5 candidates get highlighted in place
  onReckoning?: (open: boolean) => void          // the vote overlay takes/releases the screen — the shell greys the world behind
  onPreview?: (world: string | null) => void     // render this world live in the stage (the engine swaps to it while the arena stays home)
  onStageRect?: (rect: { top: number; right: number; bottom: number; left: number } | null) => void   // the center hole the engine reflows into
}) {
  const [doc, setDoc] = useState<TDoc | null>(null)
  const [open, setOpen] = useState(false)
  const [gate, setGate] = useState(false)   // THE VOTE gate — first-timers must read & accept the rules
  const [confirm, setConfirm] = useState(false)   // returning voters get a light enter/exit confirm, not the rules
  const [mounted, setMounted] = useState(false)   // drives the slide-in: false = panels at the edges, true = seated
  const [showInstr, setShowInstr] = useState(false)   // the how-to popover, from the grid's corner tab
  const [now, setNow] = useState(0)   // 1s tick, for the vote-lock countdown
  useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [open])
  const [who, setWho] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // deliberation gate: the worlds you have witnessed this cell. You cannot
  // vote until you've reviewed all five — UC's rule, made spatial.
  const [seen, setSeen] = useState<Set<string>>(new Set())
  const cellKey = doc ? doc.round + ':' + doc.tier : ''
  const markSeen = useCallback((w: string) => setSeen(prev => prev.has(w) ? prev : new Set(prev).add(w)), [])
  // to "review" a world you must rest on it a beat — a glance isn't a witness.
  const dwell = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const stopDwell = useCallback((w: string) => {
    const t = dwell.current[w]; if (t) { clearTimeout(t); delete dwell.current[w] }
  }, [])
  // WITNESS TIMER: a game must be watched for 3s to count — but the time
  // ACCUMULATES across visits, so you can snap between games and each one banks
  // whatever it's shown for. At 3s it earns its ✓ and the vote unlocks.
  const WITNESS_MS = 3_000
  const viewMs = useRef<Record<string, number>>({})
  const focusRef = useRef<string | null>(null)
  const [vtick, setVtick] = useState(0)
  // witness memory: watch-time per world, PERSISTED per arena so leaving and
  // re-entering never restarts the 3s stare — the countdown resumes where you
  // left it, and a finished witness stays finished.
  const witnessKey = 'cc-witness:' + slot
  useEffect(() => {
    let stored: Record<string, number> = {}
    try { stored = JSON.parse(localStorage.getItem(witnessKey) || '{}') } catch { /* ignore */ }
    viewMs.current = stored
    setSeen(prev => { const s = new Set(prev); for (const w of Object.keys(stored)) { if ((stored[w] || 0) >= WITNESS_MS) s.add(w) } return s })
  }, [witnessKey])
  const persistWitness = useCallback(() => {
    try { localStorage.setItem(witnessKey, JSON.stringify(viewMs.current)) } catch { /* ignore */ }
  }, [witnessKey])
  // the world currently under your gaze — it fills the stage and owns the chat
  const [focus, setFocus] = useState<string | null>(null)
  focusRef.current = focus
  // accumulate the watched game's time (fine tick) and stamp ✓ at 3s
  useEffect(() => {
    const id = setInterval(() => {
      const f = focusRef.current
      if (f) {
        const prevV = viewMs.current[f] || 0
        const v = Math.min(WITNESS_MS, prevV + 250)
        viewMs.current[f] = v
        if (v >= WITNESS_MS) markSeen(f)
        if (Math.floor(v / 1000) > Math.floor(prevV / 1000)) persistWitness()   // bank each new second watched
      }
      setVtick(x => (x + 1) & 0xffff)
    }, 250)
    return () => clearInterval(id)
  }, [markSeen, persistWitness])
  // PRESENCE: everyone in this cell's reckoning heartbeats their name to a shared
  // slot; each viewer prunes the stale and shows who else is watching. v0 rmw.
  const [viewers, setViewers] = useState<{ who: string; at: number }[]>([])
  useEffect(() => {
    if (!open || !who) return
    const vslot = 'cellviewers:' + slot + ':' + cellKey
    let stop = false
    const beat = async () => {
      let cur: { who: string; at: number }[] = []
      try {
        const j = await fetch('/api/engine/save?slot=' + encodeURIComponent(vslot)).then(r => r.json())
        if (Array.isArray(j?.data?.v)) cur = j.data.v
      } catch { /* start fresh */ }
      if (stop) return
      const nowT = Date.now()
      const next = [...cur.filter(v => v.who !== who && nowT - v.at < 12000), { who, at: nowT }].slice(-40)
      setViewers(next)
      fetch('/api/engine/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slot: vslot, data: { v: next } }) }).catch(() => {})
    }
    beat()
    const id = setInterval(beat, 4000)
    return () => { stop = true; clearInterval(id) }
  }, [open, who, slot, cellKey])
  // the center hole: the engine reflows the world/constellation into exactly
  // this rect, so the vote panels frame a resized main rather than overlaying it.
  const stageRef = useRef<HTMLDivElement>(null)
  // While closing, freeze stage-rect measuring: closeReckoning's final
  // onStageRect(null) (which un-shrinks the world/grid) must be the LAST word.
  // Without this, a late ResizeObserver tick during the 320ms close animation
  // re-measured and re-sent a rect, leaving the grid stuck shrunk after a vote
  // was finalized.
  const closingRef = useRef(false)
  useEffect(() => {
    if (!open || !onStageRect) return
    closingRef.current = false   // fresh open — measuring is live again
    const measure = () => {
      if (closingRef.current) return
      const el = stageRef.current; if (!el) return
      const r = el.getBoundingClientRect()
      if (r.width < 80 || r.height < 80) return   // layout not settled — don't collapse the canvas
      onStageRect({ top: r.top, right: r.right, bottom: r.bottom, left: r.left })
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (stageRef.current) ro.observe(stageRef.current)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [open, onStageRect])
  // deliberation is now GLOBAL PER WORLD: one pooled conversation per world,
  // shared across every cell, tier, round and arena. It lives in its own slot
  // ('world-chat:NAME') so a world accrues a real, lasting discussion.
  type Msg = { who: string; text: string; at: number; from?: string }
  const [chat, setChat] = useState<Record<string, Msg[]>>({})
  // ONE chat per world: main, every branch, and the /space page all share it.
  // Key by the BASE world (strip the ` ⑂ branch · vN` suffix) so a comment made
  // while focused on a branch lands in the same thread as the world's own chat —
  // vote chat and world chat are the same conversation.
  const chatBase = (w: string) => w.split(' ⑂ ')[0].trim().toUpperCase()
  const chatSlot = (w: string) => 'world-chat:' + chatBase(w)
  // a message carries the vantage it was spoken from — which branch (or main) the
  // speaker was viewing, and whether they were IN THE VOTE (seated in a cell) —
  // so one shared thread still reads clearly.
  const viewingLabel = (w: string, voting: boolean) => {
    const i = w.indexOf(' ⑂ ')
    // space-page arenas: candidates are save points ('v3') or LIVE — the vantage
    // is the version itself, not 'main' (every version read as main before)
    const where = /^(v\d+|LIVE)$/i.test(w) ? w.toLowerCase()
      : i < 0 ? 'main' : '⑂ ' + (w.slice(i + 3).split(' · ')[0] || 'branch')
    return voting ? '⚔ voting · ' + where : where
  }
  const loadChat = useCallback(async (w: string) => {
    try {
      const j = await fetch('/api/engine/save?slot=' + encodeURIComponent('world-chat:' + w.split(' ⑂ ')[0].trim().toUpperCase())).then(r => r.json())
      const msgs = Array.isArray(j?.data?.msgs) ? j.data.msgs as Msg[] : []
      setChat(prev => ({ ...prev, [w.split(' ⑂ ')[0].trim().toUpperCase()]: msgs }))
    } catch { /* offline is fine */ }
  }, [])

  // stepping into any world (or backing out to another scene) minimizes the
  // panel — the pill rides along. Crucially this must RELEASE the screen the
  // reckoning took: a bare setOpen(false) leaves the parent's voting/stageRect
  // set, so the world/grid stays shrunk into the vote hole. Fire the same parent
  // callbacks closeReckoning does so back-to-main restores the grid to full size.
  const sceneSeen = useRef(sceneKey)
  useEffect(() => {
    if (sceneKey === sceneSeen.current) return
    sceneSeen.current = sceneKey
    setOpen(false); setMounted(false); setFocus(null)
    onReckoning?.(false)   // releases voting + previewScene + stageRect in the parent
    onStageRect?.(null)    // un-shrink the grid immediately
  }, [sceneKey, onReckoning, onStageRect])

  // once the overlay is up, let the panels slide in from the edges (next frame,
  // so the transition animates from the off-screen start position)
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [open])

  const [selfRoster, setSelfRoster] = useState<string[]>([])
  // for a world-page arena the candidates are base names ('MAIN', 'NAME ⑂ author');
  // this maps each to a LOADABLE scene so the stage can preview it — MAIN → the
  // base world, a branch → its newest saved version.
  const previewMap = useRef<Record<string, string>>({})
  const roster = branchesOf ? selfRoster : (worlds || [])
  const rosterRef = useRef(roster)
  rosterRef.current = roster
  const slotRef = useRef(slot)
  slotRef.current = slot

  useEffect(() => {
    fetch('/api/auth/session').then(r => r.json())
      .then(s => setWho(s?.user?.name || null)).catch(() => {})
  }, [])

  // world pages find their own contestants: MAIN + each branch, newest version
  useEffect(() => {
    if (!branchesOf || !visible) return
    let stop = false
    const scan = async () => {
      try {
        const j = await fetch('/api/engine/scene?action=list').then(r => r.json())
        if (stop) return
        const bestVer: Record<string, number> = {}
        const bestName: Record<string, string> = {}
        for (const n of (j.scenes || []) as string[]) {
          if (!n.startsWith(branchesOf + ' ⑂ ')) continue
          if (n.startsWith(branchesOf + ' ⑂ main · v') || n.startsWith(branchesOf + ' ⑂ winner · v')) continue   // podium copies already won — never contestants
          const vAt = n.lastIndexOf(' · v')
          const base = vAt > 0 ? n.slice(0, vAt) : n
          const ver = vAt > 0 ? (parseInt(n.slice(vAt + 4), 10) || 0) : 0
          if (!(base in bestVer) || ver >= bestVer[base]) { bestVer[base] = ver; bestName[base] = n }
        }
        const bases = Object.keys(bestName)
        // challengers ONLY — the base world is not a contestant in its own
        // arena (you are standing in it; it holds the throne, it doesn't run).
        // Live docs that still carry MAIN in a cell heal via the PRUNE law.
        previewMap.current = { ...bestName }
        setSelfRoster(bases)
      } catch { /* offline is fine */ }
    }
    scan()
    const t = setInterval(scan, 15000)
    return () => { stop = true; clearInterval(t) }
  }, [branchesOf, visible])

  // tournament → throne: when THIS world arena crowns a champion, nudge the server
  // to promote it to the lineage's mainHolder. The server reads the arena's OWN
  // stored champion and resolves it, so this can't spoof a winner — it just says
  // "the arena settled, re-check the throne." World arenas only; skips a null
  // champion so a between-rounds lull never demotes the reigning branch.
  const promotedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!branchesOf || !doc?.champion) return
    if (promotedRef.current === doc.champion) return
    promotedRef.current = doc.champion
    fetch('/api/engine/lineage/promote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base: branchesOf }),
    }).catch(() => {})
  }, [branchesOf, doc?.champion])

  const save = (d: TDoc) => {
    fetch('/api/engine/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot: slotRef.current, data: d }),
    }).catch(() => {})
  }

  /** the law: seed when empty, resolve a tier once every cell reaches quorum,
   *  crown only on a quorate final — no clock, no single-vote coronations. */
  const reconcile = useCallback((d: TDoc | null): TDoc | null => {
    const r = rosterRef.current
    const nowT = Date.now()
    const stampAll = (ws: string[]): Record<string, number> => {
      const at: Record<string, number> = {}; for (const w of ws) at[w] = nowT; return at
    }
    if (!d || !d.round) {
      if (r.length < 2) return null
      const seeded: TDoc = { round: 1, tier: 1, cells: deal(r, 1), tierAt: nowT, reached: {}, reachedAt: stampAll(r), champion: null, championAt: 0 }
      for (const w of r) seeded.reached[w] = 1
      save(seeded)
      return seeded
    }
    // a doc without cells rolls into its next round as soon as it can
    if (d.cells.length === 0 && r.length >= 2) {
      const next: TDoc = { ...d, round: d.round + 1, tier: 1, cells: deal(r, d.round + 1), tierAt: nowT, reached: {}, reachedAt: stampAll(r) }
      for (const w of r) next.reached[w] = 1
      save(next)
      return next
    }
    // PRUNE THE DEAD — everything here is live state, so a deleted world must
    // LEAVE its cell on the next beat, not haunt it (the mirror law of GROW).
    // Votes cast for the dead are released — those voters may vote again; a
    // dead champion loses the crown (a world that no longer exists cannot
    // reign). Guarded on a real roster (≥2) so one transient empty fetch can't
    // wipe a living bracket; a wrongly-pruned survivor rejoins via GROW below.
    if (d.cells.length > 0 && r.length >= 2) {
      const alive = new Set(r)
      const deadChamp = !!d.champion && !alive.has(d.champion)
      if (deadChamp || d.cells.some(c => c.worlds.some(w => !alive.has(w)))) {
        const cells = d.cells
          .map(c => {
            const ws = c.worlds.filter(w => alive.has(w))
            const votes: Record<string, string> = {}
            for (const [voter, w] of Object.entries(c.votes)) if (alive.has(w)) votes[voter] = w
            return { ...c, worlds: ws, votes }
          })
          .filter(c => c.worlds.length > 0)   // an emptied cell is done — time to done
        const reached: Record<string, number> = {}
        for (const [w, t] of Object.entries(d.reached)) if (alive.has(w)) reached[w] = t
        const pruned: TDoc = { ...d, cells, reached }
        if (deadChamp) { pruned.champion = null; pruned.champTier = 0; pruned.championAt = nowT }
        save(pruned)
        return pruned   // the 6s beat carries the law onward (quorum, next tier)
      }
    }
    // GROW THE OPEN CELL — a branch created mid-round joins the cell you're in
    // rather than waiting for the next deal. Any roster contestant not yet in a
    // cell drops into an open one (≤5 per cell) so a fresh challenger is votable
    // NOW. Votes already cast stand; nothing resets.
    if (d.cells.length > 0) {
      const inPlay = new Set(d.cells.flatMap(c => c.worlds))
      const missing = r.filter(w => !inPlay.has(w))
      if (missing.length > 0) {
        const cells = d.cells.map(c => ({ ...c, worlds: [...c.worlds] }))
        for (const w of missing) {
          let cell = cells.find(c => c.worlds.length < 5)
          if (!cell) { cell = { worlds: [], votes: {} }; cells.push(cell) }
          cell.worlds.push(w)
        }
        const grown: TDoc = { ...d, cells, reached: { ...d.reached }, reachedAt: { ...(d.reachedAt || {}) } }
        for (const w of missing) { grown.reached[w] = d.tier; grown.reachedAt![w] = nowT }
        save(grown)
        return grown
      }
    }
    // ONE VOICE PER TIER — a mid-tier GROW changes cells.length, and the hash
    // seat used to reseat voters away from their cast vote, letting a second
    // vote land in another cell. Heal any such doc: keep each voter's latest
    // cast (voteAt), release the rest.
    if (d.cells.length > 1) {
      const latest: Record<string, { i: number; at: number }> = {}
      let dupes = false
      d.cells.forEach((c, i) => {
        for (const voter of Object.keys(c.votes)) {
          const at = c.voteAt?.[voter] ?? 0
          if (voter in latest) { dupes = true; if (at > latest[voter].at) latest[voter] = { i, at } }
          else latest[voter] = { i, at }
        }
      })
      if (dupes) {
        const cells = d.cells.map((c, i) => {
          const votes: Record<string, string> = {}
          const voteAt: Record<string, number> = {}
          for (const [voter, w] of Object.entries(c.votes)) {
            if (latest[voter].i !== i) continue
            votes[voter] = w
            if (c.voteAt?.[voter] !== undefined) voteAt[voter] = c.voteAt[voter]
          }
          return { ...c, votes, voteAt }
        })
        const healed: TDoc = { ...d, cells }
        save(healed)
        return healed   // the 6s beat carries the law onward
      }
    }
    // the tier resolves ONLY once EVERY cell is ready. A cell is ready when it
    // has gathered its quorum of distinct voices — no timer, votes stay movable
    // until then; this is the guard that makes a single vote unable to crown. A
    // cell pruned down to ≤1 world is an uncontested BYE (its cellmates were
    // deleted): it's ready with no deliberation, so a lone survivor can never
    // stall the tier waiting for votes it will never need.
    const cellReady = (c: Cell) => c.worlds.length <= 1 || new Set(Object.keys(c.votes)).size >= cellQuorum(c)
    const quorate = d.cells.length > 0 && d.cells.every(cellReady)
    if (quorate) {
      const winners = d.cells.map(c => cellWinner(c, d.round)).filter(Boolean) as string[]
      const next: TDoc = { ...d, reachedAt: { ...(d.reachedAt || {}) } }
      for (const w of winners) { next.reached = { ...next.reached, [w]: d.tier + 1 }; next.reachedAt![w] = nowT }
      if (winners.length === 1) {
        // A completed chant. The crown TRANSFERS only on a decisive win — a
        // challenger who reached a strictly higher tier than the reigning
        // champion (or the first champion, or the champion re-affirming).
        const w = winners[0]
        const wTier = d.tier + 1
        const reign = d.champion
        const reignTier = d.champTier || 0
        const dethrone = !reign || w === reign || wTier > reignTier
        next.champion = dethrone ? w : reign
        next.champTier = dethrone ? wTier : reignTier
        next.championAt = dethrone ? nowT : d.championAt
        next.round = d.round + 1
        next.tier = 1
        next.cells = r.length >= 2 ? deal(r, next.round) : []
        next.tierAt = nowT
        const fresh: Record<string, number> = {}
        for (const x of r) fresh[x] = 1
        next.reached = fresh
        next.reached[w] = wTier
        if (!dethrone && reign) next.reached[reign] = reignTier
        next.reachedAt = { ...stampAll(r), [w]: nowT }
      } else {
        next.tier = d.tier + 1
        next.cells = deal(winners, d.round * 100 + next.tier)
        next.tierAt = nowT
      }
      save(next)
      return next
    }
    return d
  }, [])

  // the heartbeat: read, apply the law, adopt
  useEffect(() => {
    if (!visible) return
    setDoc(null)   // never show one arena's doc under another's slot
    let stop = false
    const beat = async () => {
      let d: TDoc | null = null
      try {
        const j = await fetch('/api/engine/save?slot=' + encodeURIComponent(slot)).then(r => r.json())
        d = (j?.data && j.data.round) ? j.data as TDoc : null
      } catch { /* offline is fine */ }
      if (stop) return
      setDoc(reconcile(d))
    }
    beat()
    const t = setInterval(beat, 6000)
    return () => { stop = true; clearInterval(t) }
  }, [visible, slot, reconcile])

  // UC: you are dealt into ONE cell per tier — your voice lives there only.
  // A cast vote ANCHORS your seat: GROW can add a cell mid-tier, which changes
  // cells.length and would reseat you by hash away from your standing vote —
  // stranding it in a cell you can no longer see or change. The hash deals
  // only the not-yet-voted.
  const myCellIdx = (d: TDoc): number => {
    if (!who || d.cells.length === 0) return -1
    const anchored = d.cells.findIndex(c => who in c.votes)
    return anchored >= 0 ? anchored : hash(who + ':' + d.round + ':' + d.tier) % d.cells.length
  }

  const vote = (cellIdx: number, world: string) => {
    if (!who) { window.location.assign('/auth/signin?callbackUrl=' + encodeURIComponent(window.location.pathname)); return }
    if (!doc) return
    if (cellIdx !== myCellIdx(doc)) return   // not your cell — watching is free
    const cell0 = doc.cells[cellIdx]
    // votes stay changeable until the cell fills to its quorum of distinct
    // voices; the final voice settles it and locks everyone in. No time lock.
    if (cell0 && new Set(Object.keys(cell0.votes)).size >= cellQuorum(cell0)) return
    const at = Date.now()
    const next = { ...doc, cells: doc.cells.map((c, i) => i === cellIdx
      ? { ...c, votes: { ...c.votes, [who]: world }, voteAt: { ...(c.voteAt || {}), [who]: at } }
      : c) }
    setDoc(next)
    save(next)
    // a completed vote briefly brings the whole cafe field alive: the hub
    // cartridge un-anchors the floating icons, lets physics shift them a beat,
    // then re-settles + re-saves the layout. (Read each frame via window global.)
    try { (window as unknown as { __cafeVoteNudge?: number }).__cafeVoteNudge = at } catch { /* hub not mounted */ }
  }

  /** a word spoken about a world — pooled globally, read-modify-write (v0) */
  const postChat = async (w: string, text: string) => {
    if (!who) { window.location.assign('/auth/signin?callbackUrl=' + encodeURIComponent(window.location.pathname)); return }
    const t = text.trim(); if (!t) return
    let cur: Msg[] = []
    try {
      const j = await fetch('/api/engine/save?slot=' + encodeURIComponent(chatSlot(w))).then(r => r.json())
      cur = Array.isArray(j?.data?.msgs) ? j.data.msgs as Msg[] : []
    } catch { /* start fresh */ }
    const inVote = !!(who && doc && myCellIdx(doc) >= 0)   // seated in a cell = in the reckoning
    const next = [...cur, { who, text: t.slice(0, 280), at: Date.now(), from: viewingLabel(w, inVote) }].slice(-200)
    setChat(prev => ({ ...prev, [chatBase(w)]: next }))
    setDraft('')
    fetch('/api/engine/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot: chatSlot(w), data: { msgs: next } }),
    }).catch(() => {})
  }

  /** load a world into the stage: render it live, pull up its talk, witness it.
   *  cartridges load by name; DB spaces load by their 'space:slug' descriptor,
   *  resolved by the shell — both render in place. */
  // door arenas hand the raw world name to the shell (it resolves 'space:slug');
  // a world-page arena resolves 'MAIN'/branch names to a loadable scene itself.
  const previewName = (w: string) => branchesOf ? (previewMap.current[w] || w) : w
  const load = (w: string) => { setFocus(w); loadChat(w); onPreview?.(previewName(w)) }
  // the reckoning never opens onto a dead stage: the FIRST candidate of your
  // cell loads immediately (in deal order), so entering the vote always means
  // looking at a votable world. Your own hover/click takes over from there.
  useEffect(() => {
    if (!open || !doc || focus) return
    const ci = myCellIdx(doc)
    const c = doc.cells[ci >= 0 ? ci : 0]
    if (c && c.worlds.length > 0) load(c.worlds[0])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doc])

  /** click: load at once. hover: focus + talk now, load after a short dwell. */
  const select = (w: string) => { const t = dwell.current[w]; if (t) { clearTimeout(t); delete dwell.current[w] } load(w) }
  const gaze = (w: string) => {
    setFocus(w); loadChat(w)
    if (dwell.current[w]) return
    dwell.current[w] = setTimeout(() => { load(w); delete dwell.current[w] }, 200)
  }

  /** open THE RECKONING — the overlay takes the screen; the stage waits for
   *  your gaze (hovering a candidate is what loads it live). The panels slide
   *  in from the edges in step with the canvas resizing into the center, so no
   *  blank margin ever shows during the transition. */
  const enterReckoning = () => {
    // First time ever: the full rules, read & accept once. Every time after:
    // just a light enter/exit confirmation — the severe box doesn't repeat.
    let accepted = gateAcceptedMem
    try { accepted = accepted || localStorage.getItem('cc-vote-gate') === '1' } catch { /* storage denied — the memory flag still holds */ }
    if (accepted) setConfirm(true)
    else setGate(true)
  }
  const acceptGate = () => {
    gateAcceptedMem = true   // holds for the session even if storage is blocked
    try { localStorage.setItem('cc-vote-gate', '1') } catch { /* ignore */ }
    setGate(false); setOpen(true); onReckoning?.(true)
  }
  const enterVote = () => { setConfirm(false); setOpen(true); onReckoning?.(true) }
  // the visual close: panels slide back out AS the canvas grows to full, then
  // unmount once they've met at the edges (same 320ms as the resize).
  const closeReckoning = useCallback(() => {
    closingRef.current = true   // freeze measuring so the null below is final
    setMounted(false)
    setFocus(null)
    onPreview?.(null)
    onStageRect?.(null)
    window.setTimeout(() => { setOpen(false); onReckoning?.(false) }, 320)
  }, [onPreview, onStageRect, onReckoning])
  // the shell's ONE back button steps back one LAYER: while the reckoning is
  // open, ◂ routes here (same as ✕) instead of leaving the world/hub.
  useEffect(() => {
    if (!open) return
    const onBk = () => closeReckoning()
    window.addEventListener('cafe:close-reckoning', onBk)
    return () => window.removeEventListener('cafe:close-reckoning', onBk)
  }, [open, closeReckoning])

  // the reckoning takes the whole screen — so it must be exitable the way people
  // reflexively try to exit fullscreen things: the browser BACK button and ESC.
  // Opening pushes a throwaway history entry; back/ESC pop it (→ we just close),
  // and the ✕ button pops it for us so the stack never leaks a dead entry.
  const pushedState = useRef(false)
  const leaveReckoning = useCallback(() => {
    if (pushedState.current) { pushedState.current = false; try { window.history.back() } catch { closeReckoning() } }
    else closeReckoning()
  }, [closeReckoning])
  // The back/ESC wiring must arm ONCE when the reckoning opens and disarm ONCE
  // when it closes — never on every render. closeReckoning/leaveReckoning are
  // recreated each render (they close over inline parent callbacks), so we reach
  // them through refs and depend ONLY on `open`. (A prior version listed them as
  // deps; with the 1s countdown re-rendering, the cleanup fired window.history
  // .back() every second and walked the browser clean off the page. Never again.)
  const closeRef = useRef(closeReckoning); closeRef.current = closeReckoning
  const leaveRef = useRef(leaveReckoning); leaveRef.current = leaveReckoning
  useEffect(() => {
    if (!open) return
    try { window.history.pushState({ ccReckoning: true }, ''); pushedState.current = true } catch { /* ignore */ }
    const onPop = () => { pushedState.current = false; closeRef.current() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') leaveRef.current() }
    window.addEventListener('popstate', onPop)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('keydown', onKey)
      // closed by any other path (scene change, unmount) while our entry is still
      // on the stack → pop it so back doesn't later swallow a real navigation.
      if (pushedState.current) { pushedState.current = false; try { window.history.back() } catch { /* ignore */ } }
    }
  }, [open])

  // while the overlay is up, keep the focused world's talk fresh
  useEffect(() => {
    if (!open || !focus) return
    const t = setInterval(() => loadChat(focus), 5000)
    return () => clearInterval(t)
  }, [open, focus, loadChat])

  if (!visible) return null

  const pill = 'font-mono text-[14px] tracking-[0.2em]'

  // an arena short of two contenders says so instead of vanishing
  if (!doc) {
    // a world's own arena stays silent until real rivals exist — no nagging to branch
    if (branchesOf) return null
    const hint = emptyHint
    if (!hint || roster.length >= 2) return null
    return (
      <div className={rail ? 'fixed right-3 z-40' : 'fixed bottom-5 left-1/2 -translate-x-1/2 z-50'}
        style={rail ? { top: railTop ?? 205 } : undefined}>
        <div className={`${pill} rounded-full px-4 py-2 border border-white/15 bg-void/60 text-white/40 backdrop-blur`}>
          {hint}
        </div>
      </div>
    )
  }

  const mci = myCellIdx(doc)
  const seated = mci >= 0
  const cell = doc.cells[seated ? mci : 0]
  const myVote = who && seated && cell ? cell.votes[who] : undefined
  const seenAll = !!cell && cell.worlds.every(x => seen.has(x))

  // ── THE RECKONING ── the vote takes the whole screen. The world under your
  // gaze fills the stage (rendered live by the engine behind this overlay), its
  // talk pools in the rail, and you may only speak your vote once you have
  // witnessed all five. Hover loads; click votes.
  if (open && cell) {
    const tally: Record<string, number> = {}
    for (const v of Object.values(cell.votes)) tally[v] = (tally[v] || 0) + 1
    const seenN = cell.worlds.filter(x => seen.has(x)).length
    const msgs = focus ? (chat[chatBase(focus)] || []) : []
    return (
      <div className="fixed inset-0 z-[62] flex flex-col pointer-events-none">
        {/* the header — the reckoning, and the world you're looking at, named here */}
        <div className={`pointer-events-auto flex items-center justify-between px-4 py-2 bg-[#0d0906]/90 backdrop-blur-sm border-b border-brass/20 transition-transform duration-[320ms] ease-out ${mounted ? 'translate-y-0' : '-translate-y-full'}`}>
          <div className="flex items-center gap-2">
            <div className={`${pill} text-amber-200/70`}>
              ⚔ THE RECKONING{focus && <span className="text-white/45"> · {focus.toLowerCase()}</span>}
            </div>
            {/* where you stand: tier depth, your cell, its voices — and how the
                whole tier is breathing (every cell's quorum), since no cell
                resolves until ALL of them gather five. */}
            {(() => {
              const tiers = Math.max(1, Math.ceil(Math.log(Math.max(roster.length, 2)) / Math.log(5)))
              const voices = new Set(Object.keys(cell.votes)).size
              const voters = Object.keys(cell.votes)
              return (
                <div className="flex items-center gap-2">
                  <span className={`${pill} text-white/50`}>
                    TIER {doc.tier}/{tiers} · CELL {seated ? mci + 1 : '—'}/{doc.cells.length} · VOICES {voices}/{cellQuorum(cell)}
                  </span>
                  {voters.length > 0 && (
                    <div className="flex -space-x-1.5" title={'voted: ' + voters.join(', ')}>
                      {voters.slice(0, 7).map((v, i) => (
                        <span key={i} className="rounded-full border border-[#0d0906] flex items-center justify-center text-[13px] font-bold text-black"
                          style={{ width: '16px', height: '16px', background: `hsl(${hash(v) % 360},50%,58%)` }}>{v[0]?.toUpperCase()}</span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-1" title="every cell must gather its quorum of voices before the tier resolves">
                    {doc.cells.map((c, i) => {
                      const cv = new Set(Object.keys(c.votes)).size
                      const cq = cellQuorum(c)
                      return (
                        <span key={i} className={`text-[14px] font-mono px-1 rounded ${i === mci ? 'text-amber-200 border border-amber-300/40' : 'text-white/35'}`}>
                          {cv >= cq ? '●' : `${cv}/${cq}`}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )
            })()}
            {/* who else is in this cell right now */}
            {viewers.length > 0 && (
              <div className="flex items-center gap-1" title={viewers.map(v => v.who).join(', ')}>
                <span className="text-white/35 text-[14px] font-mono">👁 {viewers.length}</span>
                <div className="flex -space-x-1.5">
                  {viewers.slice(0, 7).map((v, i) => (
                    <span key={i} className="w-4.5 h-4.5 rounded-full border border-[#0d0906] flex items-center justify-center text-[13px] font-bold text-black"
                      style={{ width: '18px', height: '18px', background: `hsl(${hash(v.who) % 360},55%,62%)` }}>{v.who[0]?.toUpperCase()}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button onClick={leaveReckoning} title="leave the reckoning"
            className={`${pill} px-2.5 py-1 rounded border border-white/15 text-white/60 hover:text-white hover:border-white/40`}>✕ CLOSE</button>
        </div>

        {/* the stage — the ENGINE reflows the constellation (or a hovered world)
            into exactly this box; the panels frame it, they don't cover it. */}
        <div className="flex-1 flex min-h-0">
          <div ref={stageRef} className="relative flex-1 min-h-0">
            {!focus && (
              <div className="absolute inset-x-0 top-3 flex justify-center pointer-events-none">
                <div className={`${pill} text-white/45 bg-black/40 rounded-full px-3 py-1`}>hover a candidate below to load it — or vote from the constellation</div>
              </div>
            )}
          </div>

          {/* GLOBAL PER-WORLD talk — one pool, every cell/tier/round shares it */}
          <div className={`pointer-events-auto w-[300px] max-w-[34vw] bg-[#0d0906]/90 backdrop-blur-sm border-l border-brass/20 flex flex-col transition-transform duration-[320ms] ease-out ${mounted ? 'translate-x-0' : 'translate-x-full'}`}>
            <div className={`${pill} px-3 py-2 border-b border-white/10 text-brass`}>
              💬 {focus ? chatBase(focus).toLowerCase() : '—'} <span className="text-white/30">· the talk on this world</span>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
              {focus && msgs.length === 0 && <div className={`${pill} text-white/30`}>no one has spoken on this one yet</div>}
              {!focus && <div className={`${pill} text-white/30`}>load a world to hear its talk</div>}
              {msgs.map((m, k) => (
                <div key={k} className={`${pill} text-white/70 leading-relaxed`}>
                  <span className="text-brass/80">{m.who}</span>
                  {m.from && <span className="text-white/30"> · {m.from}</span>} — {m.text}
                </div>
              ))}
            </div>
            {focus && (
              <div className="p-2.5 border-t border-white/10">
                {who ? (
                  <div className="flex gap-1.5">
                    <input value={draft} onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') postChat(focus, draft) }}
                      placeholder="speak…" maxLength={280}
                      className={`${pill} flex-1 bg-black/40 border border-white/15 rounded px-2 py-1.5 text-white/80 outline-none focus:border-amber-400/40`} />
                    <button onClick={() => postChat(focus, draft)}
                      className={`${pill} px-2.5 py-1.5 rounded border border-white/15 text-white/60 hover:text-white`}>SAY</button>
                  </div>
                ) : (
                  <div className={`${pill} text-flame/70`}>sign in to speak — reading is free</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* the five candidates — a full-width bar along the bottom, centered in it */}
        <div className={`relative pointer-events-auto bg-[#0d0906]/95 backdrop-blur-sm border-t border-brass/25 px-4 pt-3 pb-4 transition-transform duration-[320ms] ease-out ${mounted ? 'translate-y-0' : 'translate-y-full'}`}>
          <div className="relative max-w-[1080px] mx-auto">
          {/* the how-to — a tab at the TOP-RIGHT of the grid itself, clear of the vote tiles */}
          <button onClick={() => setShowInstr(v => !v)} title="how the reckoning works"
            className={`${pill} absolute -top-3 right-0 z-10 px-2.5 py-1 rounded-t-md border border-b-0 backdrop-blur-sm transition-colors ${showInstr ? 'border-brass/50 bg-[#0d0906] text-amber-200/90' : 'border-brass/25 bg-[#0d0906]/90 text-white/50 hover:text-amber-200/80'}`}>
            ? INSTRUCTIONS
          </button>
          {showInstr && (
            <div className={`${pill} absolute bottom-full right-0 mb-2 w-[340px] max-w-[80vw] rounded-lg border border-brass/30 bg-[#0d0906] p-3 leading-relaxed text-white/60 shadow-xl z-20`}>
              <div className="text-amber-200/80 mb-1.5">HOW THE RECKONING WORKS</div>
              {branchesOf ? (
                <>this arena asks one thing: should a <span className="text-amber-300">branch</span> replace{' '}
                <span className="text-amber-300">{branchesOf.toLowerCase()}</span>&apos;s MAIN? load each contender (MAIN and every
                branch), witness them all, then tap the <span className="text-amber-300">+</span> on the one that should hold the
                name. your vote stays movable until the cell gathers its quorum of voices — the final voice locks everyone in.</>
              ) : (
                <>hover or click a world to load it live in the stage · read &amp; add to its talk in the rail · once you&apos;ve
                witnessed every world in your cell, the <span className="text-amber-300">+</span> in a tile&apos;s corner unlocks — tap it to cast
                your vote. your vote stays movable until the cell gathers its quorum of voices (the final voice locks everyone in); every vote
                nudges its world in the constellation, and a tier only crowns when a cell gathers a quorum, so no single vote decides it.</>
              )}
            </div>
          )}
          <div className="grid grid-cols-5 gap-3">
            {cell.worlds.map(w => {
              const isSeen = seen.has(w)
              const voted = myVote === w
              const isFocus = focus === w
              const canVote = seated && (seenAll || voted)
              return (
                <div key={w}
                  onMouseEnter={() => gaze(w)} onMouseLeave={() => stopDwell(w)}
                  onClick={() => select(w)}
                  title="click to load in the stage"
                  className={`relative rounded-lg border-2 overflow-hidden cursor-pointer transition-all ${
                    isFocus ? 'border-flame/80' : voted ? 'border-amber-400' : isSeen ? 'border-emerald-400/45' : 'border-white/12 hover:border-white/25'
                  }`}>
                  <div className="relative h-[72px] bg-gradient-to-br from-[#3a2410] to-[#120a04]">
                    <div className="absolute inset-0 flex items-center justify-center text-lg font-mono text-white/60">{w[0]?.toUpperCase()}</div>
                    {/* WITNESS TIMER, top-left: seconds left to watch (accumulates
                        across visits) → ✓ at 3s. Amber while it's the one on stage. */}
                    {seated && (() => {
                      void vtick
                      const ms = Math.min(WITNESS_MS, viewMs.current[w] || 0)
                      if (ms >= WITNESS_MS) return <span className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-emerald-500/90 border border-emerald-300 text-black text-[14px] flex items-center justify-center">✓</span>
                      const left = Math.ceil((WITNESS_MS - ms) / 1000)
                      const active = focus === w
                      return <span title="watch 3s to witness · time accumulates"
                        className={`absolute top-1.5 left-1.5 w-5 h-5 rounded-full border font-mono text-[14px] flex items-center justify-center tabular-nums ${active ? 'bg-amber-500/90 border-amber-200 text-black' : 'bg-black/70 border-white/30 text-white/75'}`}>{left}</span>
                    })()}
                    {/* THE VOTE BOX — top-right. Votes stay changeable until the cell
                        gathers its quorum of voices; the final voice locks everyone in. */}
                    {seated && (() => {
                      const cq = cellQuorum(cell)
                      const locked = new Set(Object.keys(cell.votes)).size >= cq
                      const armed = canVote && !locked
                      return (
                        <button
                          onClick={e => { e.stopPropagation(); if (armed) vote(mci, w) }}
                          disabled={!armed}
                          title={locked ? `votes locked · ${cq} have voted, the cell is settled` : voted ? 'your vote — tap another to move it' : armed ? 'cast your vote' : 'witness every world in the cell to vote'}
                          className={`absolute top-1.5 right-1.5 w-7 h-7 rounded-md border-2 flex items-center justify-center font-mono font-bold transition-all ${
                            voted ? 'bg-amber-400 border-amber-200 text-black shadow-[0_0_14px_rgba(212,160,60,0.75)]'
                                  : armed ? 'bg-black/75 border-amber-400/80 text-amber-300 hover:bg-amber-400 hover:text-black hover:scale-110'
                                          : 'bg-black/60 border-white/15 text-white/25 cursor-not-allowed'
                          }`}>
                          {locked && !voted
                            ? <span className="text-[16px]">🔒</span>
                            : <span className="text-base">{voted ? '✓' : '+'}</span>}
                        </button>
                      )
                    })()}
                  </div>
                  <div className={`${pill} px-1.5 py-1 flex items-center justify-between ${voted ? 'bg-amber-500/20 text-amber-200' : 'bg-black/40 text-white/70'}`}>
                    <span className="truncate">{w.toLowerCase()}</span>
                    {tally[w] ? <span className="shrink-0 ml-1">·{tally[w]}</span> : null}
                  </div>
                </div>
              )
            })}
          </div>
          </div>
          <div className={`${pill} text-center mt-2 ${
            !seated ? 'text-white/40' : myVote ? 'text-amber-200/80' : seenAll ? 'text-emerald-300/80' : 'text-white/40'
          }`}>
            {!seated ? 'sign in to take a seat — loading and reading are free'
              : myVote ? (() => {
                  const voters = new Set(Object.keys(cell.votes)).size
                  const cq = cellQuorum(cell)
                  return voters >= cq
                    ? `voice locked on ${myVote.toLowerCase()} · ${cq} have voted, the cell is settled`
                    : `voice on ${myVote.toLowerCase()} · ${voters}/${cq} voted — you can still move it`
                })()
              : seenAll ? 'every world witnessed — tap the + on your choice to vote'
              : `watch each game 3s to witness it — ${seenN}/${cell.worlds.length} · time accumulates`}
          </div>
          {/* FINALIZE — lock your vote and leave the cell at once, no waiting */}
          {seated && (() => {
            // a vote via finalize honors the same rule as the + : all five witnessed
            // (or you already voted). Leaving WITHOUT a vote is the ✕ CLOSE above.
            const chosen = myVote || (seenAll && focus && seen.has(focus) ? focus : null)
            return (
              <div className="flex justify-center mt-2 pointer-events-auto">
                <button
                  disabled={!chosen}
                  onClick={() => { try { if (!myVote && chosen) vote(mci, chosen) } finally { leaveReckoning() } }}
                  title={chosen ? `finalize on ${chosen.toLowerCase()} and leave the cell` : 'witness every world, pick one, then finalize to leave'}
                  className={`${pill} px-4 py-1.5 rounded-full border-2 font-bold tracking-wide transition-all ${
                    chosen ? 'bg-emerald-500/90 border-emerald-300 text-black hover:scale-105 shadow-[0_0_16px_rgba(16,185,129,0.5)]'
                           : 'bg-black/50 border-white/15 text-white/30 cursor-not-allowed'}`}>
                  ✔ FINALIZE {chosen ? `· ${chosen.toLowerCase()}` : ''} & LEAVE
                </button>
              </div>
            )
          })()}
        </div>
      </div>
    )
  }

  return (
    <>
      {gate && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setGate(false)}>
          <div className="w-[540px] max-w-[92vw] max-h-[86vh] overflow-y-auto rounded-lg border border-brass/35 bg-[#0e0b07] p-7 font-mono text-[18px] leading-relaxed text-white/85" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2.5 text-amber-200/80 text-[17px] tracking-[0.22em] uppercase mb-5">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400" /> How the vote works
            </div>
            <p className="text-white/80 mb-4">The vote isn&rsquo;t a like button — it&rsquo;s how the cafe decides what everyone sees first. A quick read:</p>
            <div className="space-y-3 text-[15px] text-white/70">
              <p><span className="text-amber-200">A cell is 60 minutes.</span> It holds several worlds. The idea is simple: give each game in your cell a real look before you vote — that&rsquo;s what keeps the vote fair.</p>
              <p><span className="text-amber-200">Two scores.</span> XP — up to 60, one point per minute actually played. VOTE — up to 100, your interest. Play buys standing; the vote sorts what everyone sees first.</p>
              <p><span className="text-amber-200">Your freedom.</span> Never touch a world and you leave freely for a new cell. Lock in a vote anytime to move on. Review as many cells as you like. Abandon without voting and your play time still counts.</p>
              <p><span className="text-amber-200">The work survives you.</span> Any world that won, or that even one person enjoyed, stays — even if its maker moves on.</p>
            </div>
            <div className="flex items-center justify-between gap-3 mt-6">
              <button onClick={() => setGate(false)} className="text-[16px] tracking-[0.18em] text-white/40 hover:text-white/70 px-2 py-1.5">NOT YET</button>
              <button onClick={acceptGate} className="text-[16px] tracking-[0.2em] px-5 py-2 rounded border border-amber-400/50 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25 transition-colors">ENTER THE VOTE</button>
            </div>
            <p className="text-white/30 text-[14px] tracking-[0.15em] mt-3 text-center">Play fair — give every game in your cell a real look.</p>
          </div>
        </div>
      )}
      {/* returning voters: a light enter/exit confirmation — the rules were read once */}
      {confirm && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setConfirm(false)}>
          <div className="w-[360px] max-w-[92vw] rounded-lg border border-brass/35 bg-[#0e0b07] p-6 font-mono text-[18px] leading-relaxed text-white/85 text-center" onClick={e => e.stopPropagation()}>
            <div className="text-amber-200/80 tracking-[0.2em] text-[17px] mb-2">⚔ ENTER THE VOTE?</div>
            <p className="text-white/60 text-[17px] mb-5">Review this cell&rsquo;s games and cast (or move) your voice. Leaving without voting is free.</p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => setConfirm(false)} className="text-[16px] tracking-[0.18em] px-4 py-2 rounded border border-white/15 text-white/50 hover:text-white/80 hover:border-white/30 transition-colors">EXIT</button>
              <button onClick={enterVote} className="text-[16px] tracking-[0.2em] px-5 py-2 rounded border border-amber-400/50 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25 transition-colors">ENTER</button>
            </div>
          </div>
        </div>
      )}
      <div className={rail
        ? 'fixed right-3 z-40 flex flex-col items-end gap-2'
        : 'fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2'}
        style={rail ? { top: railTop ?? 205 } : undefined}>
        {/* a vote needs challengers: only clickable once at least one branch
            exists (roster = MAIN + branches, so ≥2 means a real contest) */}
        {(() => {
          const canVote = roster.length >= 2
          return (
            <button
              onClick={enterReckoning}
              disabled={!canVote}
              title={canVote ? 'enter the reckoning' : 'a vote needs challengers — branch this world first'}
              className={`${pill} rounded-full px-4 py-2 border backdrop-blur transition-colors disabled:opacity-40 disabled:cursor-default ${
                doc.champion
                  ? 'border-amber-400/60 bg-amber-500/15 text-amber-200'
                  : 'border-brass/40 bg-void/60 text-glow/80 enabled:hover:border-flame/60'
              }`}>
              {rail ? `⚔ VOTE · T${doc.tier}` : `⚔ TIER ${doc.tier} · VOTE`}
            </button>
          )
        })()}
      </div>
    </>
  )
}
