// ledger-math — the PURE split engine of the creator ledger (no I/O; see
// DESIGN-creator-ledger.md). Everything here is deterministic and integer-cent
// exact: the same inputs produce byte-identical outputs, and every cent of a
// pool lands on exactly one account — none lost, none minted. This is the half
// of "perfect bookkeeping" that mathematics can guarantee; the DB layer
// (lib/ledger.ts) adds append-only storage + idempotency on top.

/** Current split policy: 30% house · 40% world owner · 30% node authors
 *  weighted by engagement. Entries record the version they were split under —
 *  changing the policy NEVER rewrites history. */
export const SPLIT_POLICY_V1 = 'v1:30-40-30'
export const HOUSE_BPS = 3000    // basis points of the pool (30%)
export const OWNER_BPS = 4000    // 40%
export const AUTHORS_BPS = 3000  // 30% — shared by node authors by weight

export interface Weighted { account: string; weight: number }
export interface Allocation { account: string; cents: number }

function assertCents(n: number, what: string): void {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${what} must be a non-negative integer (cents), got ${n}`)
}

/** Split `pool` cents across weighted accounts, LARGEST-REMAINDER exact:
 *  floor every share, then hand the leftover cents one-by-one to the largest
 *  fractional remainders (ties broken by account name — deterministic).
 *  Duplicate accounts are merged first. Zero/negative weights are dropped;
 *  an empty effective weight set returns [] (caller routes the pool). */
export function splitPoolCents(pool: number, weights: Weighted[]): Allocation[] {
  assertCents(pool, 'pool')
  // merge duplicates, drop non-positive/non-finite weights
  const merged = new Map<string, number>()
  for (const w of weights) {
    if (!Number.isFinite(w.weight) || w.weight <= 0) continue
    merged.set(w.account, (merged.get(w.account) ?? 0) + w.weight)
  }
  if (pool === 0 || merged.size === 0) return []
  const entries = [...merged.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const total = entries.reduce((s, [, w]) => s + w, 0)
  // floor shares + remainders
  const shares = entries.map(([account, w]) => {
    const exact = (pool * w) / total
    const floor = Math.floor(exact)
    return { account, floor, rem: exact - floor }
  })
  let leftover = pool - shares.reduce((s, x) => s + x.floor, 0)
  // largest remainder first; ties by account name (already name-sorted, so a
  // stable sort on remainder keeps name order within ties)
  const byRem = [...shares].sort((a, b) => b.rem - a.rem || (a.account < b.account ? -1 : 1))
  for (const s of byRem) {
    if (leftover <= 0) break
    s.floor += 1
    leftover -= 1
  }
  if (leftover !== 0) throw new Error(`largest-remainder invariant broken: ${leftover} cents unassigned`)
  return shares.filter(s => s.floor > 0).map(s => ({ account: s.account, cents: s.floor }))
}

/** POLICY V1: split one attributed revenue pool between the house, the world's
 *  owner, and the node authors (engagement-weighted). Exact by construction:
 *  house and owner are computed largest-remainder over the three buckets, and
 *  the authors' bucket is largest-remainder over the authors. Edge laws:
 *  · no authors → their 30% goes to the OWNER (they built everything themselves)
 *  · owner also among authors → they simply earn both roles (merged at the end)
 *  Returns allocations summing EXACTLY to `pool`. */
export function splitRevenueV1(
  pool: number,
  houseAccount: string,
  ownerAccount: string,
  authors: Weighted[],
): Allocation[] {
  assertCents(pool, 'pool')
  const liveAuthors = authors.filter(a => Number.isFinite(a.weight) && a.weight > 0)
  // bucket split — three fixed weights (authors bucket only if any authors)
  const buckets = splitPoolCents(pool, [
    { account: '__house', weight: HOUSE_BPS },
    { account: '__owner', weight: OWNER_BPS + (liveAuthors.length === 0 ? AUTHORS_BPS : 0) },
    ...(liveAuthors.length > 0 ? [{ account: '__authors', weight: AUTHORS_BPS }] : []),
  ])
  const bucketOf = (name: string) => buckets.find(b => b.account === name)?.cents ?? 0
  const out = new Map<string, number>()
  const add = (account: string, cents: number) => { if (cents > 0) out.set(account, (out.get(account) ?? 0) + cents) }
  add(houseAccount, bucketOf('__house'))
  add(ownerAccount, bucketOf('__owner'))
  const authorPool = bucketOf('__authors')
  if (authorPool > 0) for (const a of splitPoolCents(authorPool, liveAuthors)) add(a.account, a.cents)
  const result = [...out.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([account, cents]) => ({ account, cents }))
  const sum = result.reduce((s, r) => s + r.cents, 0)
  if (sum !== pool) throw new Error(`split invariant broken: allocated ${sum} of ${pool}`)
  return result
}

// ── the journal reducer — pure bookkeeping over entry streams (used by tests
//    and reconciliation): balances by account, and the zero-sum invariant ──

export interface JournalEntry { debit: string; credit: string; cents: number }

/** Balances after applying entries: credit adds, debit subtracts. The sum of
 *  ALL balances is always exactly 0 — double entry by construction. */
export function applyEntries(entries: JournalEntry[]): Map<string, number> {
  const bal = new Map<string, number>()
  for (const e of entries) {
    assertCents(e.cents, 'entry.cents')
    if (!e.debit || !e.credit || e.debit === e.credit) throw new Error('entry needs distinct debit and credit accounts')
    bal.set(e.debit, (bal.get(e.debit) ?? 0) - e.cents)
    bal.set(e.credit, (bal.get(e.credit) ?? 0) + e.cents)
  }
  return bal
}

/** The books balance iff all balances sum to zero (they must, always). */
export function booksBalance(entries: JournalEntry[]): boolean {
  let sum = 0
  for (const v of applyEntries(entries).values()) sum += v
  return sum === 0
}
