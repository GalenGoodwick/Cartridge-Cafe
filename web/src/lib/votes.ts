// ♥ UPVOTES — the pure core (no I/O). One vote per player per world, upvote
// ONLY (Galen's ruling: no downvote). The doc lives in the `votes:<spaceId>`
// engine slot: { up: { [voterId]: at } } — a map, so a voter re-tapping
// toggles their OWN entry and can never touch anyone else's.

export type VoteDoc = { up: Record<string, number> }

/** Read a raw slot payload into a safe VoteDoc (never trust stored shape). */
export function readVoteDoc(raw: unknown): VoteDoc {
  const up = (raw as { up?: unknown } | null | undefined)?.up
  if (!up || typeof up !== 'object' || Array.isArray(up)) return { up: {} }
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(up as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  return { up: out }
}

export function voteCount(doc: VoteDoc): number {
  return Object.keys(doc.up).length
}

/** Toggle `voter`'s vote: absent → cast (stamped `at`), present → withdrawn.
 *  Returns the next doc plus the state the UI shows ({ count, mine }). */
export function toggleVote(doc: VoteDoc, voter: string, at: number): { doc: VoteDoc; count: number; mine: boolean } {
  const up = { ...doc.up }
  const mine = !(voter in up)
  if (mine) up[voter] = at
  else delete up[voter]
  const next = { up }
  return { doc: next, count: voteCount(next), mine }
}

/** The shelf's vote lift — how many milliseconds of RECENCY one vote is worth
 *  when the games list orders itself. Votes must never be the sole key (a
 *  ghost-town shelf frozen by early winners); they BLEND into the existing
 *  recency order: sortKey = updatedAt + votes · VOTE_LIFT_MS. Six hours per
 *  vote — a loved world outranks hours of churn, but fresh work still surfaces. */
export const VOTE_LIFT_MS = 6 * 60 * 60 * 1000

export function voteLiftedRecency(updatedAt: number, votes: number): number {
  return updatedAt + Math.max(0, votes) * VOTE_LIFT_MS
}
