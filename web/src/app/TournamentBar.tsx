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
 *  Contestants are dealt into cells of five. One voice per cell. When every
 *  cell has spoken, the tier resolves: winners advance (gravity reads
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
  voteAt?: Record<string, number>   // when each voter cast — a vote locks for VOTE_LOCK_MS
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
const QUORUM = 3   // distinct voters a cell needs before it can speak — no single vote crowns anything
const VOTE_LOCK_MS = 10 * 60_000   // once cast, a vote locks for ten minutes
// (the day-scale decay on a world's pull lives in the CAFE hook, where the constellation is drawn)

const hash = (s: string) => {
  let h = 2166136261
  for (const c of s) { h ^= c.charCodeAt(0); h = (h * 16777619) >>> 0 }
  return h
}

/** deal contestants into cells of ≤5, deterministically shuffled per round */
function deal(worlds: string[], round: number): Cell[] {
  const order = [...worlds].sort((a, b) => hash(a + ':' + round) - hash(b + ':' + round))
  const cells: Cell[] = []
  for (let i = 0; i < order.length; i += 5) cells.push({ worlds: order.slice(i, i + 5), votes: {} })
  // a cell of one can't deliberate — borrow a neighbor
  if (cells.length > 1 && cells[cells.length - 1].worlds.length === 1) {
    cells[cells.length - 1].worlds.unshift(cells[cells.length - 2].worlds.pop() as string)
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

export default function TournamentBar({ slot, worlds, branchesOf, visible, emptyHint, sceneKey, rail, onReckoning, onPreview, onStageRect }: {
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
  bubbles?: { name: string; x: number; y: number; r: number }[]   // live constellation bubble positions (screen px) — the 5 candidates get highlighted in place
  onReckoning?: (open: boolean) => void          // the vote overlay takes/releases the screen — the shell greys the world behind
  onPreview?: (world: string | null) => void     // render this world live in the stage (the engine swaps to it while the arena stays home)
  onStageRect?: (rect: { top: number; right: number; bottom: number; left: number } | null) => void   // the center hole the engine reflows into
}) {
  const [doc, setDoc] = useState<TDoc | null>(null)
  const [open, setOpen] = useState(false)
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
  useEffect(() => { setSeen(new Set()) }, [cellKey])
  const markSeen = useCallback((w: string) => setSeen(prev => prev.has(w) ? prev : new Set(prev).add(w)), [])
  // to "review" a world you must rest on it a beat — a glance isn't a witness.
  const dwell = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const stopDwell = useCallback((w: string) => {
    const t = dwell.current[w]; if (t) { clearTimeout(t); delete dwell.current[w] }
  }, [])
  // the world currently under your gaze — it fills the stage and owns the chat
  const [focus, setFocus] = useState<string | null>(null)
  // the center hole: the engine reflows the world/constellation into exactly
  // this rect, so the vote panels frame a resized main rather than overlaying it.
  const stageRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || !onStageRect) return
    const measure = () => {
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
  type Msg = { who: string; text: string; at: number }
  const [chat, setChat] = useState<Record<string, Msg[]>>({})
  const chatSlot = (w: string) => 'world-chat:' + w.toUpperCase()
  const loadChat = useCallback(async (w: string) => {
    try {
      const j = await fetch('/api/engine/save?slot=' + encodeURIComponent('world-chat:' + w.toUpperCase())).then(r => r.json())
      const msgs = Array.isArray(j?.data?.msgs) ? j.data.msgs as Msg[] : []
      setChat(prev => ({ ...prev, [w]: msgs }))
    } catch { /* offline is fine */ }
  }, [])

  // stepping into any world minimizes the panel — the pill rides along
  const sceneSeen = useRef(sceneKey)
  useEffect(() => {
    if (sceneKey !== sceneSeen.current) { sceneSeen.current = sceneKey; setOpen(false) }
  }, [sceneKey])

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
          const vAt = n.lastIndexOf(' · v')
          const base = vAt > 0 ? n.slice(0, vAt) : n
          const ver = vAt > 0 ? (parseInt(n.slice(vAt + 4), 10) || 0) : 0
          if (!(base in bestVer) || ver >= bestVer[base]) { bestVer[base] = ver; bestName[base] = n }
        }
        const bases = Object.keys(bestName)
        // MAIN previews the base world itself; each branch previews its newest version
        previewMap.current = { MAIN: branchesOf, ...bestName }
        setSelfRoster(bases.length > 0 ? ['MAIN', ...bases] : [])
      } catch { /* offline is fine */ }
    }
    scan()
    const t = setInterval(scan, 15000)
    return () => { stop = true; clearInterval(t) }
  }, [branchesOf, visible])

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
    // the tier resolves ONLY once EVERY cell has gathered QUORUM distinct
    // voices. No timer: a cast vote can be moved and the talk keeps going until
    // enough of the cell has weighed in. This is the guard that makes a single
    // vote unable to crown — a champion needs a quorate final cell.
    const quorate = d.cells.length > 0 && d.cells.every(c => new Set(Object.keys(c.votes)).size >= QUORUM)
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

  // UC: you are dealt into ONE cell per tier — your voice lives there only
  const myCellIdx = (d: TDoc): number =>
    who && d.cells.length > 0 ? hash(who + ':' + d.round + ':' + d.tier) % d.cells.length : -1

  const vote = (cellIdx: number, world: string) => {
    if (!who) { window.location.assign('/auth/signin?callbackUrl=' + encodeURIComponent(window.location.pathname)); return }
    if (!doc) return
    if (cellIdx !== myCellIdx(doc)) return   // not your cell — watching is free
    // a vote LOCKS for ten minutes once cast — no flip-flopping to game the tally.
    const cell0 = doc.cells[cellIdx]
    const castAt = cell0?.voteAt?.[who]
    if (castAt && Date.now() - castAt < VOTE_LOCK_MS) return   // still locked
    const at = Date.now()
    const next = { ...doc, cells: doc.cells.map((c, i) => i === cellIdx
      ? { ...c, votes: { ...c.votes, [who]: world }, voteAt: { ...(c.voteAt || {}), [who]: at } }
      : c) }
    setDoc(next)
    save(next)
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
    const next = [...cur, { who, text: t.slice(0, 280), at: Date.now() }].slice(-200)
    setChat(prev => ({ ...prev, [w]: next }))
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
  const load = (w: string) => { setFocus(w); loadChat(w); markSeen(w); onPreview?.(previewName(w)) }
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
    setOpen(true)
    onReckoning?.(true)
  }
  const leaveReckoning = () => {
    // reverse it: panels slide back out AS the canvas grows back to full — then
    // unmount once they've met at the edges (same 320ms as the resize).
    setMounted(false)
    setFocus(null)
    onPreview?.(null)
    onStageRect?.(null)
    window.setTimeout(() => { setOpen(false); onReckoning?.(false) }, 320)
  }

  // while the overlay is up, keep the focused world's talk fresh
  useEffect(() => {
    if (!open || !focus) return
    const t = setInterval(() => loadChat(focus), 5000)
    return () => clearInterval(t)
  }, [open, focus, loadChat])

  if (!visible) return null

  const pill = 'font-mono text-[10px] tracking-[0.2em]'

  // an arena short of two contenders says so instead of vanishing
  if (!doc) {
    // a world's own arena stays silent until real rivals exist — no nagging to branch
    if (branchesOf) return null
    const hint = emptyHint
    if (!hint || roster.length >= 2) return null
    return (
      <div className={rail ? 'fixed top-[205px] right-3 z-40' : 'fixed bottom-5 left-1/2 -translate-x-1/2 z-50'}>
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
    const msgs = focus ? (chat[focus] || []) : []
    return (
      <div className="fixed inset-0 z-[62] flex flex-col pointer-events-none">
        {/* the header — the reckoning, and the world you're looking at, named here */}
        <div className={`pointer-events-auto flex items-center justify-between px-4 py-2 bg-[#0d0906]/90 backdrop-blur-sm border-b border-brass/20 transition-transform duration-[320ms] ease-out ${mounted ? 'translate-y-0' : '-translate-y-full'}`}>
          <div className={`${pill} text-amber-200/70`}>
            ⚔ THE RECKONING{focus && <span className="text-white/45"> · {focus.toLowerCase()}</span>}
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
              💬 {focus ? focus.toLowerCase() : '—'} <span className="text-white/30">· the talk on this world</span>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
              {focus && msgs.length === 0 && <div className={`${pill} text-white/30`}>no one has spoken on this one yet</div>}
              {!focus && <div className={`${pill} text-white/30`}>load a world to hear its talk</div>}
              {msgs.map((m, k) => (
                <div key={k} className={`${pill} text-white/70 leading-relaxed`}>
                  <span className="text-brass/80">{m.who}</span> — {m.text}
                </div>
              ))}
            </div>
            {focus && (
              <div className="p-2.5 border-t border-white/10">
                {who ? (
                  <div className="flex gap-1.5">
                    <input value={draft} onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') postChat(focus, draft) }}
                      placeholder={`speak on ${focus.toLowerCase()}…`} maxLength={280}
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
          {/* the how-to, tucked in the grid's top-right corner */}
          <button onClick={() => setShowInstr(v => !v)} title="how the reckoning works"
            className={`${pill} absolute -top-3 right-3 px-2.5 py-1 rounded-t-md border border-b-0 backdrop-blur-sm transition-colors ${showInstr ? 'border-brass/50 bg-[#0d0906] text-amber-200/90' : 'border-brass/25 bg-[#0d0906]/90 text-white/50 hover:text-amber-200/80'}`}>
            ? INSTRUCTIONS
          </button>
          {showInstr && (
            <div className={`${pill} absolute bottom-full right-3 mb-1 w-[340px] max-w-[80vw] rounded-lg border border-brass/30 bg-[#0d0906] p-3 leading-relaxed text-white/60 shadow-xl`}>
              <div className="text-amber-200/80 mb-1.5">HOW THE RECKONING WORKS</div>
              {branchesOf ? (
                <>this arena asks one thing: should a <span className="text-amber-300">branch</span> replace{' '}
                <span className="text-amber-300">{branchesOf.toLowerCase()}</span>&apos;s MAIN? load each contender (MAIN and every
                branch), witness them all, then tap the <span className="text-amber-300">+</span> on the one that should hold the
                name. a vote locks for ten minutes; a change only lands when a cell reaches a quorum.</>
              ) : (
                <>hover or click a world to load it live in the stage · read &amp; add to its talk in the rail · once you&apos;ve
                witnessed all five, the <span className="text-amber-300">+</span> in a tile&apos;s corner unlocks — tap it to cast
                your vote. a vote locks for ten minutes; every vote nudges its world in the constellation, and a tier only crowns
                when a cell gathers a quorum, so no single vote decides it.</>
              )}
            </div>
          )}
          <div className="grid grid-cols-5 gap-3 max-w-[1080px] mx-auto">
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
                    {isSeen && !voted && <span className="absolute top-1.5 left-1.5 w-4 h-4 rounded-full bg-emerald-500/90 border border-emerald-300 text-black text-[9px] flex items-center justify-center">✓</span>}
                    {/* THE VOTE BOX — top-right. Once cast, it locks for ten minutes
                        and shows the time remaining. */}
                    {seated && (() => {
                      const castAt = cell.voteAt?.[who || '']
                      const lockLeft = voted && castAt ? Math.max(0, castAt + VOTE_LOCK_MS - (now || Date.now())) : 0
                      const locked = lockLeft > 0
                      const mm = Math.floor(lockLeft / 60000), ss = Math.floor((lockLeft % 60000) / 1000)
                      const armed = canVote && !locked
                      return (
                        <button
                          onClick={e => { e.stopPropagation(); if (armed) vote(mci, w) }}
                          disabled={!armed}
                          title={locked ? `vote locked · ${mm}:${String(ss).padStart(2, '0')} left` : voted ? 'your vote' : armed ? 'cast your vote' : 'witness all five to vote'}
                          className={`absolute top-1.5 right-1.5 ${locked ? 'w-auto px-1.5 gap-0.5' : 'w-7'} h-7 rounded-md border-2 flex items-center justify-center font-mono font-bold transition-all ${
                            voted ? 'bg-amber-400 border-amber-200 text-black shadow-[0_0_14px_rgba(212,160,60,0.75)]'
                                  : armed ? 'bg-black/75 border-amber-400/80 text-amber-300 hover:bg-amber-400 hover:text-black hover:scale-110'
                                          : 'bg-black/60 border-white/15 text-white/25 cursor-not-allowed'
                          }`}>
                          {locked
                            ? <span className="text-[9px] flex items-center gap-0.5">🔒 {mm}:{String(ss).padStart(2, '0')}</span>
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
          <div className={`${pill} text-center mt-2 ${
            !seated ? 'text-white/40' : myVote ? 'text-amber-200/80' : seenAll ? 'text-emerald-300/80' : 'text-white/40'
          }`}>
            {!seated ? 'sign in to take a seat — loading and reading are free'
              : myVote ? (() => {
                  const castAt = cell.voteAt?.[who || '']
                  const left = castAt ? Math.max(0, castAt + VOTE_LOCK_MS - (now || Date.now())) : 0
                  const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000)
                  return left > 0
                    ? `voice locked on ${myVote.toLowerCase()} · ${mm}:${String(ss).padStart(2, '0')} until you can move it`
                    : `voice cast for ${myVote.toLowerCase()} · tap another + to move it`
                })()
              : seenAll ? 'all five witnessed — tap the + on your choice to vote'
              : `load each world to witness it — ${seenN}/5 · the + unlocks at 5`}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={rail
      ? 'fixed top-[205px] right-3 z-40 flex flex-col items-end gap-2'
      : 'fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2'}>
      <button
        onClick={enterReckoning}
        className={`${pill} rounded-full px-4 py-2 border backdrop-blur transition-colors ${
          doc.champion
            ? 'border-amber-400/60 bg-amber-500/15 text-amber-200'
            : 'border-brass/40 bg-void/60 text-glow/80 hover:border-flame/60'
        }`}>
        {rail ? `⚔ VOTE · T${doc.tier}` : `⚔ TIER ${doc.tier} · VOTE`}
      </button>
    </div>
  )
}
