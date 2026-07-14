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

export default function TournamentBar({ slot, worlds, branchesOf, visible, emptyHint, docked, onDock, onTravel, onCloseHome, sceneKey, rail }: {
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
}) {
  const [doc, setDoc] = useState<TDoc | null>(null)
  const [open, setOpen] = useState(false)
  const [who, setWho] = useState<string | null>(null)
  const [threadFor, setThreadFor] = useState<string | null>(null)   // world whose comments are unfolded
  const [draft, setDraft] = useState('')
  const [now, setNow] = useState(0)   // 1s tick for the deliberation countdown
  // deliberation gate: the worlds you have witnessed this cell. You cannot
  // vote until you've reviewed all five — UC's rule, made spatial.
  const [seen, setSeen] = useState<Set<string>>(new Set())
  const cellKey = doc ? doc.round + ':' + doc.tier : ''
  useEffect(() => { setSeen(new Set()) }, [cellKey])
  const markSeen = useCallback((w: string) => setSeen(prev => prev.has(w) ? prev : new Set(prev).add(w)), [])

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
    if (!who) { window.location.href = '/auth/signin?callbackUrl=' + encodeURIComponent(window.location.pathname) ; return }
    if (!doc) return
    if (cellIdx !== myCellIdx(doc)) return   // not your cell — watching is free
    // casting only RECORDS your voice — it never resolves the tier. The tier
    // resolves solely on its two-hour timer (via the heartbeat), by vote count.
    // Until then your vote can move and the conversation keeps going.
    const next = { ...doc, cells: doc.cells.map((c, i) => i === cellIdx ? { ...c, votes: { ...c.votes, [who]: world } } : c) }
    setDoc(next)
    save(next)
  }

  /** deliberation: a comment on a world, spoken inside your cell */
  const comment = (cellIdx: number, world: string, text: string) => {
    if (!who) { window.location.href = '/auth/signin?callbackUrl=' + encodeURIComponent(window.location.pathname) ; return }
    if (!doc || !text.trim()) return
    if (cellIdx !== myCellIdx(doc)) return
    const next = {
      ...doc,
      cells: doc.cells.map((c, i) => {
        if (i !== cellIdx) return c
        const thread = [...(c.comments?.[world] || []), { who, text: text.trim().slice(0, 280), at: Date.now() }].slice(-50)
        return { ...c, comments: { ...(c.comments || {}), [world]: thread } }
      }),
    }
    setDoc(next)
    save(next)
    setDraft('')
  }

  /** step into a contender to see it — the bar docks and rides along */
  const travel = (world: string) => {
    if (!onTravel) return
    onDock?.(true)
    setOpen(false)   // minimize for the trip; the pill stays within reach
    onTravel(world)
  }

  /** ✕ — undock, close, go back to this arena's door */
  const closeOut = () => {
    setOpen(false)
    setThreadFor(null)
    onDock?.(false)
    onCloseHome?.()
  }

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

  const standings = Object.entries(doc.reached).sort((a, b) => b[1] - a[1])

  return (
    <div className={rail
      ? 'fixed top-[205px] right-3 z-40 flex flex-col items-end gap-2'
      : 'fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2'}>
      {open && (
        <div className="w-[440px] max-w-[92vw] max-h-[52vh] overflow-y-auto rounded-xl bg-[#171009]/90 backdrop-blur border border-[#b97a2a]/25 p-3 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className={`${pill} text-white/50`}>
              ROUND {doc.round} · TIER {doc.tier}
              {doc.tierAt && !doc.champion && (() => {
                const left = Math.max(0, doc.tierAt + TIER_MAX_MS - (now || Date.now()))
                const hrs = Math.floor(left / 3600000), mins = Math.floor((left % 3600000) / 60000)
                const label = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`
                return <span className="text-amber-300/80"> · resolves by vote in {label}</span>
              })()}
              {' '}— you are dealt into ONE cell; until the window closes your vote can move and the
              conversation keeps going. Click a NAME to walk through the world · ○ casts your vote · 💬 speaks in your cell.
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => setOpen(false)} title="minimize — the pill rides along"
                className={`${pill} px-1.5 py-0.5 rounded border border-white/15 text-white/60 hover:text-white`}>—</button>
              <button onClick={closeOut} title="leave the deliberation — back to the door"
                className={`${pill} px-1.5 py-0.5 rounded border border-white/15 text-white/60 hover:text-white`}>✕</button>
            </div>
          </div>
          {/* UC law: you are dealt into ONE cell — you sit in yours; the other
              cells of the tier are a pulse (spoken / deliberating), not a window. */}
          {doc.cells.length > 1 && (
            <div className={`${pill} flex items-center gap-1.5 text-white/40`}>
              TIER CELLS
              {doc.cells.map((c, i) => (
                <span key={i}
                  title={`cell ${i + 1} — ${Object.keys(c.votes).length > 0 ? 'spoken' : 'deliberating'}${i === myCellIdx(doc) ? ' — yours' : ''}`}
                  className={`inline-block w-2 h-2 rounded-full ${Object.keys(c.votes).length > 0 ? 'bg-emerald-400/80' : 'bg-white/25'} ${i === myCellIdx(doc) ? 'ring-2 ring-amber-300/80' : ''}`} />
              ))}
              {myCellIdx(doc) < 0 && <span className="ml-1 text-white/30">sign in to take a seat</span>}
            </div>
          )}
          {doc.cells.map((c, i) => {
            const mine = i === myCellIdx(doc)
            // one cell on screen: yours. (Signed-out visitors may listen to cell 1.)
            if (myCellIdx(doc) >= 0 ? !mine : i > 0) return null
            const myVote = who && mine ? c.votes[who] : undefined
            const tally: Record<string, number> = {}
            for (const w of Object.values(c.votes)) tally[w] = (tally[w] || 0) + 1
            return (
              <div key={i} className={`rounded-lg border p-2 ${mine ? 'border-amber-400/40' : 'border-white/10'}`}>
                <div className={`${pill} mb-1.5 ${mine ? 'text-amber-300' : 'text-brass'}`}>
                  {mine ? 'YOUR CELL' : 'CELL 1 · listening'} {Object.keys(c.votes).length > 0 ? '· spoken' : '· deliberating'}
                  {mine && !c.worlds.every(x => seen.has(x)) && (
                    <span className="text-white/40"> · review all five to vote ({c.worlds.filter(x => seen.has(x)).length}/5)</span>
                  )}
                </div>
                <div className="space-y-1">
                  {c.worlds.map(w => {
                    const thread = c.comments?.[w] || []
                    const unfolded = threadFor === i + ':' + w
                    return (
                      <div key={w} onMouseEnter={() => mine && markSeen(w)}>
                        <div className="flex items-center gap-1.5">
                          {mine && (() => {
                            const isSeen = seen.has(w)
                            const allSeen = c.worlds.every(x => seen.has(x))
                            const locked = !allSeen && myVote !== w
                            return (
                              <button onClick={() => { if (!locked) vote(i, w) }} disabled={locked}
                                title={myVote === w ? 'your vote' : locked ? 'review all five first' : 'cast your vote (+1)'}
                                className={`${pill} w-7 text-center py-1 rounded border transition-colors ${
                                  myVote === w
                                    ? 'border-amber-400/70 bg-amber-500/20 text-amber-200'
                                    : locked
                                      ? (isSeen ? 'border-emerald-500/30 text-emerald-400/70' : 'border-white/12 text-white/30')
                                      : 'border-white/15 text-white/50 hover:border-amber-400/50 hover:text-amber-200'
                                }`}>
                                {myVote === w ? '+1' : locked ? (isSeen ? '☑' : '☐') : '○'}
                              </button>
                            )
                          })()}
                          <button onClick={() => { if (mine) markSeen(w); travel(w) }} title="walk through this world, bar in hand"
                            className={`${pill} flex-1 text-left px-2 py-1 rounded border transition-colors ${
                              mine ? 'border-white/15 text-white/80 hover:border-flame/50 hover:text-white'
                                   : 'border-white/8 text-white/45 hover:border-white/25 hover:text-white/70'
                            }`}>
                            {w.toLowerCase()}{tally[w] ? ` ·${tally[w]}` : ''} <span className="opacity-50">↗</span>
                          </button>
                          <button onClick={() => { if (mine) markSeen(w); setThreadFor(unfolded ? null : i + ':' + w); setDraft('') }}
                            className={`${pill} px-1.5 py-1 rounded border border-white/10 ${thread.length ? 'text-brass' : 'text-white/35'} hover:text-white`}>
                            💬{thread.length > 0 ? thread.length : ''}
                          </button>
                        </div>
                        {unfolded && (
                          <div className="ml-7 mt-1 mb-1.5 space-y-1">
                            {thread.map((m, k) => (
                              <div key={k} className={`${pill} text-white/60 leading-relaxed`}>
                                <span className="text-brass/80">{m.who}</span> — {m.text}
                              </div>
                            ))}
                            {thread.length === 0 && <div className={`${pill} text-white/30`}>no one has spoken on this one</div>}
                            {mine && who && (
                              <div className="flex gap-1.5">
                                <input value={draft} onChange={e => setDraft(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') comment(i, w, draft) }}
                                  placeholder="speak in your cell…" maxLength={280}
                                  className={`${pill} flex-1 bg-black/40 border border-white/15 rounded px-2 py-1 text-white/80 outline-none focus:border-amber-400/40`} />
                                <button onClick={() => comment(i, w, draft)}
                                  className={`${pill} px-2 py-1 rounded border border-white/15 text-white/60 hover:text-white`}>SAY</button>
                              </div>
                            )}
                            {!mine && <div className={`${pill} text-white/25`}>not your cell — listening only</div>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {/* the stats: who stands where this round */}
          {standings.length > 0 && (
            <div className="rounded-lg border border-white/10 p-2">
              <div className={`${pill} text-brass mb-1.5`}>STANDINGS</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                {standings.map(([w, tier]) => (
                  <div key={w} className={`${pill} flex justify-between gap-2 ${doc.champion === w ? 'text-amber-300' : 'text-white/60'}`}>
                    <span className="truncate">{doc.champion === w ? '♛ ' : ''}{w.toLowerCase()}</span>
                    <span className="shrink-0">t{tier}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!who && <div className={`${pill} text-flame/80`}>sign in to vote — watching is free</div>}
        </div>
      )}
      <button
        onClick={() => setOpen(o => !o)}
        className={`${pill} rounded-full px-4 py-2 border backdrop-blur transition-colors ${
          doc.champion
            ? 'border-amber-400/60 bg-amber-500/15 text-amber-200'
            : 'border-brass/40 bg-void/60 text-glow/80 hover:border-flame/60'
        }`}>
        {rail
          ? (docked ? `⚔ VOTING · T${doc.tier}` : `⚔ VOTE · T${doc.tier}`)
          : docked
            ? `⚔ TIER ${doc.tier} · YOUR CELL`
            : `⚔ TIER ${doc.tier} · VOTE`}
      </button>
    </div>
  )
}
