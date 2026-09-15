// DOCKSTAR ACCOUNTING (workbench W2+W4) — the two charts and the triage law.
//
// A dockstar world is BORN LOADED: worldData.dockstarBay.born lists every
// primitive (prim-* hooks/fields) shipped in the bay. The AI's build act is
// TRIAGE: each primitive is either MOVED (its logic grafted into a node,
// then the prim removed) or DELETED (discarded with a reason) — recorded in
// worldData.triage, the append-only AI-accounting ledger written ONLY by the
// bridge's `triage` verb. Ship gate: bay EMPTY + ledger COMPLETE + every
// node GREEN. "Node carving with 0 primitive layover is directly
// unfalsifiable" (Galen): the shipped world carries the attested ledger, so
// the method claim is verifiable by anyone from the world source.

export type PrimKind = 'hook' | 'field'

export interface BornPrim {
  /** id, must start with 'prim-' */
  id: string
  kind: PrimKind
  role: string
  /** suggested destination node (advisory — the ledger records the real one) */
  target?: string
}

export interface DockstarBay {
  v: 1
  born: BornPrim[]
}

export interface TriageEntry {
  prim: string
  fate: 'moved' | 'deleted'
  /** node the logic landed in (fate: moved) */
  to?: string
  /** why it was discarded (fate: deleted) */
  reason?: string
  by?: string
  at?: number
}

export interface SnapshotShape {
  stepHooks?: Array<{ hookId?: string; id?: string }>
  fields?: Array<{ id?: string; name?: string }>
  worldData?: Record<string, unknown> | null
}

const isPrimId = (id: string) => id.startsWith('prim-')

/** PRIMITIVE-SIDE CHART: every prim-* still present in the snapshot. */
export function primsInSnapshot(snap: SnapshotShape): Array<{ id: string; kind: PrimKind }> {
  const out: Array<{ id: string; kind: PrimKind }> = []
  for (const h of snap.stepHooks ?? []) {
    const id = String(h.hookId ?? h.id ?? '')
    if (isPrimId(id)) out.push({ id, kind: 'hook' })
  }
  for (const f of snap.fields ?? []) {
    const id = String(f.id ?? f.name ?? '')
    if (isPrimId(id)) out.push({ id, kind: 'field' })
  }
  return out
}

/** NODE-SIDE CHART: the organized (non-prim) hooks — the nodes that must run green. */
export function nodeIds(snap: SnapshotShape): string[] {
  return (snap.stepHooks ?? [])
    .map(h => String(h.hookId ?? h.id ?? ''))
    .filter(id => id && !isPrimId(id))
}

export function bayOf(snap: SnapshotShape): DockstarBay | null {
  const bay = snap.worldData?.dockstarBay as DockstarBay | undefined
  return bay && bay.v === 1 && Array.isArray(bay.born) ? bay : null
}

export function ledgerOf(snap: SnapshotShape): TriageEntry[] {
  const l = snap.worldData?.triage
  return Array.isArray(l) ? (l as TriageEntry[]) : []
}

export interface TriageVerdict {
  ok: boolean
  /** prims still in the world — the bay is not empty */
  leftovers: string[]
  /** born prims that vanished with NO ledger entry — accounting was bypassed */
  unaccounted: string[]
  /** ledger entries for prims never born — the ledger cannot invent history */
  ghosts: string[]
  /** 'moved' entries whose target node does not exist */
  badTargets: string[]
  /** born total / moved / deleted, for the chart */
  counts: { born: number; moved: number; deleted: number; remaining: number }
}

/** THE TRIAGE LAW: born-inventory ≡ ledger, bay empty, targets real.
 *  (Last ledger entry wins per prim — a re-triage supersedes.) */
export function checkTriage(snap: SnapshotShape): TriageVerdict | null {
  const bay = bayOf(snap)
  if (!bay) return null   // not a dockstar world — the law does not apply
  const born = new Set(bay.born.map(p => p.id))
  const present = new Set(primsInSnapshot(snap).map(p => p.id))
  const nodes = new Set(nodeIds(snap))
  const fate = new Map<string, TriageEntry>()
  const ghosts: string[] = []
  for (const e of ledgerOf(snap)) {
    if (!born.has(e.prim)) { ghosts.push(e.prim); continue }
    fate.set(e.prim, e)   // last wins
  }
  const leftovers = [...present].filter(id => born.has(id))
  const unaccounted = [...born].filter(id => !present.has(id) && !fate.has(id))
  const badTargets = [...fate.values()]
    .filter(e => e.fate === 'moved' && (!e.to || !nodes.has(e.to)))
    .map(e => `${e.prim} → ${e.to ?? '?'}`)
  const moved = [...fate.values()].filter(e => e.fate === 'moved').length
  const deleted = [...fate.values()].filter(e => e.fate === 'deleted').length
  return {
    ok: leftovers.length === 0 && unaccounted.length === 0 && ghosts.length === 0 && badTargets.length === 0,
    leftovers, unaccounted, ghosts: [...new Set(ghosts)], badTargets,
    counts: { born: born.size, moved, deleted, remaining: leftovers.length },
  }
}

/** The per-node green checks a dockstar world owes as evidence
 *  (submitted via validate_world by the submission ritual). */
export function nodeGreenChecks(snap: SnapshotShape): string[] {
  return nodeIds(snap).map(id => `node-green:${id}`)
}
