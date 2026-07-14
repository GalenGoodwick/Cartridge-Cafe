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
  // deliberation, just like UC: per-world comment threads inside the cell.
  // They live and die with the tier — a fresh deal is a fresh conversation.
  comments?: Record<string, { who: string; text: string; at: number }[]>
}
type TDoc = {
  round: number
  tier: number
  cells: Cell[]
  tierAt?: number                 // when this tier was dealt — the deliberation clock
  reached: Record<string, number>
  champion: string | null
  championAt: number
  champTier?: number              // the tier the reigning champion was crowned at
}

// UC: one participant belongs to ONE cell per tier. Past the deliberation
// window, a tier with at least one voice resolves anyway — silent cells fall
// to the deterministic tie-break, so no empty cell can stall the chant.
const TIER_MAX_MS = 2 * 60 * 60_000   // each tier deliberates for two hours, then resolves by votes

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

export default function TournamentBar({ slot, worlds, branchesOf, visible, emptyHint, sceneKey, rail, onReckoning, onPreview }: {
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
}) {
  const [doc, setDoc] = useState<TDoc | null>(null)
  const [open, setOpen] = useState(false)
  const [who, setWho] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [now, setNow] = useState(0)   // 1s tick for the deliberation countdown
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

  useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [open])
  const [selfRoster, setSelfRoster] = useState<string[]>([])
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
        const bases = new Set<string>()
        for (const n of (j.scenes || []) as string[]) {
          if (!n.startsWith(branchesOf + ' ⑂ ')) continue
          const vAt = n.lastIndexOf(' · v')
          bases.add(vAt > 0 ? n.slice(0, vAt) : n)
        }
        setSelfRoster(bases.size > 0 ? ['MAIN', ...bases] : [])
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

  /** the law: seed when empty, resolve full tiers, crown — and the moment a
   *  champion is crowned, the next round begins. Always rolling. */
  const reconcile = useCallback((d: TDoc | null): TDoc | null => {
    const r = rosterRef.current
    if (!d || !d.round) {
      if (r.length < 2) return null
      const seeded: TDoc = { round: 1, tier: 1, cells: deal(r, 1), tierAt: Date.now(), reached: {}, champion: null, championAt: 0 }
      for (const w of r) seeded.reached[w] = 1
      save(seeded)
      return seeded
    }
    // a doc without cells rolls into its next round as soon as it can
    if (d.cells.length === 0 && r.length >= 2) {
      const next: TDoc = { ...d, round: d.round + 1, tier: 1, cells: deal(r, d.round + 1), tierAt: Date.now(), reached: {} }
      for (const w of r) next.reached[w] = 1
      save(next)
      return next
    }
    // an older doc without a deliberation clock gets one now
    if (d.cells.length > 0 && !d.tierAt) {
      const next = { ...d, tierAt: Date.now() }
      save(next)
      return next
    }
    // the tier resolves ONLY when the deliberation window closes (with at
    // least one voice in it). Never early: a cast vote can be moved and the
    // conversation keeps going until the clock runs out — deliberation is the
    // point, not a race to speak first. Silent cells fall to the tie-break.
    const anyVoice = d.cells.some(c => Object.keys(c.votes).length > 0)
    const windowClosed = !!d.tierAt && Date.now() - d.tierAt > TIER_MAX_MS
    if (d.cells.length > 0 && anyVoice && windowClosed) {
      const winners = d.cells.map(c => cellWinner(c, d.round)).filter(Boolean) as string[]
      const next = { ...d }
      for (const w of winners) next.reached = { ...next.reached, [w]: d.tier + 1 }
      if (winners.length === 1) {
        // A completed chant. The crown TRANSFERS only on a decisive win — a
        // challenger who reached a strictly higher tier than the reigning
        // champion (or the first champion, or the champion re-affirming).
        // Otherwise the champion holds their seat; the challenger keeps the
        // tier it earned but does not dethrone. Then the next round is dealt.
        const w = winners[0]
        const wTier = d.tier + 1
        const reign = d.champion
        const reignTier = d.champTier || 0
        const dethrone = !reign || w === reign || wTier > reignTier
        next.champion = dethrone ? w : reign
        next.champTier = dethrone ? wTier : reignTier
        next.championAt = dethrone ? Date.now() : d.championAt
        next.round = d.round + 1
        next.tier = 1
        next.cells = r.length >= 2 ? deal(r, next.round) : []
        next.tierAt = Date.now()
        const fresh: Record<string, number> = {}
        for (const x of r) fresh[x] = 1
        next.reached = fresh
        next.reached[w] = wTier
        if (!dethrone && reign) next.reached[reign] = reignTier
      } else {
        next.tier = d.tier + 1
        next.cells = deal(winners, d.round * 100 + next.tier)
        next.tierAt = Date.now()
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
    // casting only RECORDS your voice — it never resolves the tier. The tier
    // resolves solely on its two-hour timer (via the heartbeat), by vote count.
    // Until then your vote can move and the conversation keeps going.
    const next = { ...doc, cells: doc.cells.map((c, i) => i === cellIdx ? { ...c, votes: { ...c.votes, [who]: world } } : c) }
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
  const load = (w: string) => { setFocus(w); loadChat(w); markSeen(w); onPreview?.(w) }
  /** click: load at once. hover: focus + talk now, load after a short dwell. */
  const select = (w: string) => { const t = dwell.current[w]; if (t) { clearTimeout(t); delete dwell.current[w] } load(w) }
  const gaze = (w: string) => {
    setFocus(w); loadChat(w)
    if (dwell.current[w]) return
    dwell.current[w] = setTimeout(() => { load(w); delete dwell.current[w] }, 200)
  }

  /** open THE RECKONING — the overlay takes the screen; the stage waits for
   *  your gaze (hovering a candidate is what loads it live). */
  const enterReckoning = () => {
    setOpen(true)
    onReckoning?.(true)
  }
  const leaveReckoning = () => {
    setOpen(false)
    setFocus(null)
    onPreview?.(null)
    onReckoning?.(false)
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
        {/* the header — kept quiet: a title and a way out */}
        <div className="pointer-events-auto flex items-center justify-between px-4 py-2 bg-[#0d0906]/90 backdrop-blur-sm border-b border-brass/20">
          <div className={`${pill} text-amber-200/70`}>⚔ THE RECKONING</div>
          <button onClick={leaveReckoning} title="leave the reckoning"
            className={`${pill} px-2.5 py-1 rounded border border-white/15 text-white/60 hover:text-white hover:border-white/40`}>✕ CLOSE</button>
        </div>

        {/* body: the stage + grid on the left, the world's talk on the right */}
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 flex flex-col min-w-0">
            {/* the stage — the world renders through here (engine canvas behind) */}
            <div className="relative flex-1 min-h-0">
              <div className={`${pill} pointer-events-auto absolute top-3 left-4 px-2.5 py-1 rounded bg-black/50 backdrop-blur-sm border border-brass/20 text-amber-200/90`}>
                {focus ? `▶ ${focus.toLowerCase()}` : 'the stage'}
              </div>
              {!focus && (
                <div className="absolute inset-0 bg-void/60 flex items-center justify-center">
                  <div className={`${pill} text-white/40`}>hover or click a candidate below to load it live</div>
                </div>
              )}
            </div>

            {/* the five candidates — a grid sized to the space beside the talk */}
            <div className="pointer-events-auto bg-[#0d0906]/92 backdrop-blur-sm border-t border-brass/25 px-4 pt-3 pb-5">
              <div className="grid grid-cols-5 gap-2.5">
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
                        <img src={`/thumbs/${encodeURIComponent(w)}.jpg`} alt="" loading="lazy"
                          className={`absolute inset-0 w-full h-full object-cover ${isSeen || isFocus ? '' : 'grayscale opacity-55'}`}
                          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                        {isSeen && !voted && <span className="absolute top-1.5 left-1.5 w-4 h-4 rounded-full bg-emerald-500/90 border border-emerald-300 text-black text-[9px] flex items-center justify-center">✓</span>}
                        {/* THE VOTE BOX — top-right, the click zone that casts your voice */}
                        {seated && (
                          <button
                            onClick={e => { e.stopPropagation(); if (canVote) vote(mci, w) }}
                            disabled={!canVote}
                            title={voted ? 'your vote — tap another world to move it' : canVote ? 'cast your vote' : 'witness all five to vote'}
                            className={`absolute top-1.5 right-1.5 w-7 h-7 rounded-md border-2 flex items-center justify-center font-mono text-base font-bold transition-all ${
                              voted ? 'bg-amber-400 border-amber-200 text-black shadow-[0_0_14px_rgba(212,160,60,0.75)]'
                                    : canVote ? 'bg-black/75 border-amber-400/80 text-amber-300 hover:bg-amber-400 hover:text-black hover:scale-110'
                                              : 'bg-black/60 border-white/15 text-white/25 cursor-not-allowed'
                            }`}>
                            {voted ? '✓' : '+'}
                          </button>
                        )}
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
                  : myVote ? `voice cast for ${myVote.toLowerCase()} · tier ${doc.tier} weight · tap another + to move it`
                  : seenAll ? 'all five witnessed — tap the + on your choice to vote'
                  : `load each world to witness it — ${seenN}/5 · the + unlocks at 5`}
              </div>
            </div>
          </div>

          {/* GLOBAL PER-WORLD talk — one pool, every cell/tier/round shares it */}
          <div className="pointer-events-auto w-[300px] max-w-[34vw] bg-[#0d0906]/90 backdrop-blur-sm border-l border-brass/20 flex flex-col">
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
