'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** The rolling tournament of the commons — Unity Chant over the whole universe.
 *
 *  Worlds are dealt into cells of five. Anyone signed in votes once per cell.
 *  When every cell has spoken, the tier resolves: winners advance (and sink
 *  toward the center — the door's gravity reads `reached`), losers keep the
 *  tier they earned. Tiers repeat until one world remains: the champion, max
 *  gravity, crowned in gold. It holds the middle for a while, then the whole
 *  tournament restarts with whatever worlds exist by then.
 *
 *  Every world competes as its MAIN version — the core its own branch
 *  tournament (cells on ⑂ branches) established. This bar never sees branches.
 *
 *  v0 truth model: the doc lives in save-slot `tournament:main`, last-write-
 *  wins, reconciled client-side — same law as branch cells until BRANCHES v1
 *  moves enforcement server-side.
 */

type Cell = { worlds: string[]; votes: Record<string, string> }
type TDoc = {
  round: number
  tier: number
  cells: Cell[]
  reached: Record<string, number>
  champion: string | null
  championAt: number
}

const CHAMP_HOLD_MS = 15 * 60_000   // the champion's reign before a fresh round

const hash = (s: string) => {
  let h = 2166136261
  for (const c of s) { h ^= c.charCodeAt(0); h = (h * 16777619) >>> 0 }
  return h
}

/** deal worlds into cells of ≤5, deterministically shuffled per round */
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

export default function TournamentBar({ worlds, visible }: { worlds: string[]; visible: boolean }) {
  const [doc, setDoc] = useState<TDoc | null>(null)
  const [open, setOpen] = useState(false)
  const [who, setWho] = useState<string | null>(null)
  const worldsRef = useRef(worlds)
  worldsRef.current = worlds

  useEffect(() => {
    fetch('/api/auth/session').then(r => r.json())
      .then(s => setWho(s?.user?.name || null)).catch(() => {})
  }, [])

  const save = (d: TDoc) => {
    fetch('/api/engine/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot: 'tournament:main', data: d }),
    }).catch(() => {})
  }

  /** the law, applied: seed when empty, resolve full tiers, crown, restart */
  const reconcile = useCallback((d: TDoc | null): TDoc | null => {
    const roster = worldsRef.current
    if (!d || !d.round) {
      if (roster.length < 2) return null
      const seeded: TDoc = { round: 1, tier: 1, cells: deal(roster, 1), reached: {}, champion: null, championAt: 0 }
      for (const w of roster) seeded.reached[w] = 1
      save(seeded)
      return seeded
    }
    // a champion reigns, then the whole thing begins again
    if (d.champion) {
      if (Date.now() - d.championAt > CHAMP_HOLD_MS && roster.length >= 2) {
        const next: TDoc = { round: d.round + 1, tier: 1, cells: deal(roster, d.round + 1), reached: {}, champion: null, championAt: 0 }
        for (const w of roster) next.reached[w] = 1
        save(next)
        return next
      }
      return d
    }
    // tier resolves only when every cell has spoken
    if (d.cells.length > 0 && d.cells.every(c => Object.keys(c.votes).length > 0)) {
      const winners = d.cells.map(c => cellWinner(c, d.round)).filter(Boolean) as string[]
      const next = { ...d }
      for (const w of winners) next.reached = { ...next.reached, [w]: d.tier + 1 }
      if (winners.length === 1) {
        next.champion = winners[0]
        next.championAt = Date.now()
        next.cells = []
      } else {
        next.tier = d.tier + 1
        next.cells = deal(winners, d.round * 100 + next.tier)
      }
      save(next)
      return next
    }
    return d
  }, [])

  // the heartbeat: read, apply the law, adopt
  useEffect(() => {
    if (!visible) return
    let stop = false
    const beat = async () => {
      let d: TDoc | null = null
      try {
        const j = await fetch('/api/engine/save?slot=' + encodeURIComponent('tournament:main')).then(r => r.json())
        d = (j?.data && j.data.round) ? j.data as TDoc : null
      } catch { /* offline is fine */ }
      if (stop) return
      setDoc(reconcile(d))
    }
    beat()
    const t = setInterval(beat, 6000)
    return () => { stop = true; clearInterval(t) }
  }, [visible, reconcile])

  const vote = (cellIdx: number, world: string) => {
    if (!who) { window.location.href = '/auth/signin?callbackUrl=' + encodeURIComponent('/') ; return }
    if (!doc || doc.champion) return
    const next = { ...doc, cells: doc.cells.map((c, i) => i === cellIdx ? { ...c, votes: { ...c.votes, [who]: world } } : c) }
    const settled = reconcile(next) || next
    setDoc(settled)
    if (settled === next) save(next)   // reconcile saves when it changes things; otherwise persist the vote
  }

  if (!visible || !doc) return null

  const pill = 'font-mono text-[10px] tracking-[0.2em]'

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2">
      {open && !doc.champion && (
        <div className="w-[420px] max-w-[92vw] max-h-[46vh] overflow-y-auto rounded-xl bg-[#171009]/90 backdrop-blur border border-[#b97a2a]/25 p-3 space-y-3">
          <div className={`${pill} text-white/50`}>
            ROUND {doc.round} · TIER {doc.tier} — one voice per cell · every cell must speak before the tier sinks inward
          </div>
          {doc.cells.map((c, i) => {
            const myVote = who ? c.votes[who] : undefined
            const tally: Record<string, number> = {}
            for (const w of Object.values(c.votes)) tally[w] = (tally[w] || 0) + 1
            return (
              <div key={i} className="rounded-lg border border-white/10 p-2">
                <div className={`${pill} text-brass mb-1.5`}>CELL {i + 1} {Object.keys(c.votes).length > 0 ? '· spoken' : '· waiting'}</div>
                <div className="flex flex-wrap gap-1.5">
                  {c.worlds.map(w => (
                    <button key={w}
                      onClick={() => vote(i, w)}
                      className={`${pill} px-2 py-1 rounded border transition-colors ${
                        myVote === w
                          ? 'border-amber-400/70 bg-amber-500/20 text-amber-200'
                          : 'border-white/15 text-white/70 hover:border-amber-400/40 hover:text-white'
                      }`}>
                      {w.toLowerCase()}{tally[w] ? ` ·${tally[w]}` : ''}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
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
        {doc.champion ? `♛ CHAMPION · ${doc.champion.toLowerCase()}` : `⚔ TOURNAMENT · TIER ${doc.tier} · VOTE`}
      </button>
    </div>
  )
}
