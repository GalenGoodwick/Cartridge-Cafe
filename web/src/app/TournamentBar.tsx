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

type Cell = { worlds: string[]; votes: Record<string, string> }
type TDoc = {
  round: number
  tier: number
  cells: Cell[]
  reached: Record<string, number>
  champion: string | null
  championAt: number
}

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

export default function TournamentBar({ slot, worlds, branchesOf, visible }: {
  slot: string
  worlds?: string[]              // roster handed in (door pages: the visible bubbles)
  branchesOf?: string            // world pages: self-fetch MAIN + this world's branches
  visible: boolean
}) {
  const [doc, setDoc] = useState<TDoc | null>(null)
  const [open, setOpen] = useState(false)
  const [who, setWho] = useState<string | null>(null)
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
      const seeded: TDoc = { round: 1, tier: 1, cells: deal(r, 1), reached: {}, champion: null, championAt: 0 }
      for (const w of r) seeded.reached[w] = 1
      save(seeded)
      return seeded
    }
    // a doc without cells rolls into its next round as soon as it can
    if (d.cells.length === 0 && r.length >= 2) {
      const next: TDoc = { ...d, round: d.round + 1, tier: 1, cells: deal(r, d.round + 1), reached: {} }
      for (const w of r) next.reached[w] = 1
      save(next)
      return next
    }
    // tier resolves only when every cell has spoken
    if (d.cells.length > 0 && d.cells.every(c => Object.keys(c.votes).length > 0)) {
      const winners = d.cells.map(c => cellWinner(c, d.round)).filter(Boolean) as string[]
      const next = { ...d }
      for (const w of winners) next.reached = { ...next.reached, [w]: d.tier + 1 }
      if (winners.length === 1) {
        // coronation — and in the same breath, the next round is dealt
        next.champion = winners[0]
        next.championAt = Date.now()
        next.round = d.round + 1
        next.tier = 1
        next.cells = r.length >= 2 ? deal(r, next.round) : []
        const fresh: Record<string, number> = {}
        for (const w of r) fresh[w] = 1
        next.reached = { ...fresh, [winners[0]]: d.tier + 1 }
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

  const vote = (cellIdx: number, world: string) => {
    if (!who) { window.location.href = '/auth/signin?callbackUrl=' + encodeURIComponent(window.location.pathname) ; return }
    if (!doc) return
    const next = { ...doc, cells: doc.cells.map((c, i) => i === cellIdx ? { ...c, votes: { ...c.votes, [who]: world } } : c) }
    const settled = reconcile(next) || next
    setDoc(settled)
    if (settled === next) save(next)   // reconcile saves when it changes things; otherwise persist the vote
  }

  if (!visible) return null

  const pill = 'font-mono text-[10px] tracking-[0.2em]'

  // a world with no rivals yet: the arena exists, it's just waiting
  if (!doc) {
    if (!branchesOf || selfRoster.length !== 0) return null
    return (
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50">
        <div className={`${pill} rounded-full px-4 py-2 border border-white/15 bg-void/60 text-white/40 backdrop-blur`}>
          ⚔ NO RIVALS YET — ⑂ BRANCH TO CHALLENGE MAIN
        </div>
      </div>
    )
  }

  const standings = Object.entries(doc.reached).sort((a, b) => b[1] - a[1])

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2">
      {open && (
        <div className="w-[440px] max-w-[92vw] max-h-[52vh] overflow-y-auto rounded-xl bg-[#171009]/90 backdrop-blur border border-[#b97a2a]/25 p-3 space-y-3">
          <div className={`${pill} text-white/50`}>
            ROUND {doc.round} · TIER {doc.tier} — one voice per cell · every cell must speak before the tier resolves
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
        {doc.champion
          ? `♛ ${doc.champion.toLowerCase()} · TIER ${doc.tier} · VOTE`
          : `⚔ TOURNAMENT · TIER ${doc.tier} · VOTE`}
      </button>
    </div>
  )
}
