// ledger — the DB half of the creator ledger (DESIGN-creator-ledger.md): an
// append-only double-entry journal over prisma.ledgerEntry. All math lives in
// ledger-math (pure, unit-tested); this layer adds exactly two guarantees:
//   1. IMMUTABILITY — postings only ever INSERT; corrections are reversing rows.
//   2. IDEMPOTENCY — every row keys to a unique `ref`; replaying the same
//      external event (Stripe retries fire at-least-once) inserts nothing.
// ACTIVATION GATE (Galen's record): nothing here moves real money — it books
// what already happened. Payout execution (rung 3, Stripe Connect) is a
// separate, Galen-gated layer.
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { SPLIT_POLICY_V1, splitRevenueV1, type Weighted } from './ledger-math'

// account name vocabulary — one place, so strings can't drift
export const ACCT = {
  external: 'external:stripe',                       // money's origin (outside world)
  house: 'house',                                     // the cafe's cut
  pool: (slug: string) => `world:${slug}:pool`,       // a charge parked for split
  creator: (userId: string) => `creator:${userId}`,   // accrued, unpaid earnings
}

let ensured = false
/** Self-create the LedgerEntry table on prod (the BuildJob pattern — additive,
 *  idempotent, matches the Prisma model column-for-column). */
export async function ensureLedgerTable(): Promise<void> {
  if (ensured) return
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "LedgerEntry" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "debit" TEXT NOT NULL,
    "credit" TEXT NOT NULL,
    "cents" INTEGER NOT NULL,
    "policy" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
  )`)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "LedgerEntry_ref_key" ON "LedgerEntry"("ref")`)
  for (const col of ['debit', 'credit', 'kind']) {
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "LedgerEntry_${col}_idx" ON "LedgerEntry"("${col}")`)
  }
  ensured = true
}

export interface Posting {
  ref: string
  kind: 'charge' | 'split' | 'payout' | 'reversal'
  debit: string
  credit: string
  cents: number
  policy?: string
  meta?: Prisma.InputJsonValue
}

/** Append one row. Returns false when `ref` already exists (idempotent replay).
 *  Rows are never updated — this is the ONLY write this module performs. */
export async function post(p: Posting): Promise<boolean> {
  if (!Number.isInteger(p.cents) || p.cents <= 0) throw new Error(`posting cents must be a positive integer, got ${p.cents}`)
  if (p.debit === p.credit) throw new Error('posting needs distinct accounts')
  await ensureLedgerTable()
  try {
    await prisma.ledgerEntry.create({ data: { ...p } })
    return true
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false
    throw e
  }
}

/** Book an attributed revenue event END-TO-END, idempotently: the charge lands
 *  in the world's pool, then the pool splits (policy v1) to house / owner /
 *  authors. `eventId` is the external idempotency root (Stripe event id) — the
 *  whole group replays as a no-op. Returns how many rows were newly written. */
export async function bookAttributedCharge(opts: {
  eventId: string
  slug: string
  cents: number
  ownerUserId: string
  authors: Weighted[]          // account = creator userId; weight = engagement
  note?: string
}): Promise<number> {
  const { eventId, slug, cents, ownerUserId, authors, note } = opts
  const pool = ACCT.pool(slug)
  let wrote = 0
  if (await post({
    ref: `${eventId}:charge`, kind: 'charge', debit: ACCT.external, credit: pool, cents,
    meta: { slug, stripeEventId: eventId, ...(note ? { note } : {}) },
  })) wrote++
  const allocs = splitRevenueV1(
    cents, ACCT.house, ACCT.creator(ownerUserId),
    authors.map(a => ({ account: ACCT.creator(a.account), weight: a.weight })),
  )
  for (const a of allocs) {
    if (await post({
      ref: `${eventId}:split:${a.account}`, kind: 'split', debit: pool, credit: a.account,
      cents: a.cents, policy: SPLIT_POLICY_V1, meta: { slug, stripeEventId: eventId },
    })) wrote++
  }
  return wrote
}

/** Book un-attributed platform revenue (worldgen, memberships): straight to the
 *  house — every dollar in the till appears in the books, no exceptions. */
export async function bookHouseCharge(eventId: string, cents: number, note: string): Promise<boolean> {
  return post({
    ref: `${eventId}:charge`, kind: 'charge', debit: ACCT.external, credit: ACCT.house, cents,
    meta: { stripeEventId: eventId, note },
  })
}

/** An account's balance: credits − debits. */
export async function balanceOf(account: string): Promise<number> {
  await ensureLedgerTable()
  const [cr, db] = await Promise.all([
    prisma.ledgerEntry.aggregate({ where: { credit: account }, _sum: { cents: true } }),
    prisma.ledgerEntry.aggregate({ where: { debit: account }, _sum: { cents: true } }),
  ])
  return (cr._sum.cents ?? 0) - (db._sum.cents ?? 0)
}

/** RECONCILIATION. Double-entry makes global debits≡credits true by
 *  construction (each row is both), so the MEANINGFUL invariants are:
 *  1. NO POOL RESIDUE — every world pool balances to zero (a nonzero pool = a
 *     charge that was never fully split: incomplete booking).
 *  2. EXTERNAL OUTFLOW = everything held inside (house + creators + pools) —
 *     the number to check against Stripe's own balance for rung-3 payouts. */
export async function reconcile(): Promise<{
  ok: boolean
  poolsWithResidue: Array<{ account: string; cents: number }>
  externalOutflowCents: number
}> {
  await ensureLedgerTable()
  const rows = await prisma.ledgerEntry.findMany({ select: { debit: true, credit: true, cents: true } })
  const bal = new Map<string, number>()
  for (const r of rows) {
    bal.set(r.debit, (bal.get(r.debit) ?? 0) - r.cents)
    bal.set(r.credit, (bal.get(r.credit) ?? 0) + r.cents)
  }
  const poolsWithResidue = [...bal.entries()]
    .filter(([a, c]) => a.startsWith('world:') && a.endsWith(':pool') && c !== 0)
    .map(([account, cents]) => ({ account, cents }))
  return {
    ok: poolsWithResidue.length === 0,
    poolsWithResidue,
    externalOutflowCents: -(bal.get(ACCT.external) ?? 0),
  }
}

/** Every creator balance (accrued, unpaid) — the "you've earned $X" read. */
export async function creatorBalances(): Promise<Array<{ userId: string; cents: number }>> {
  await ensureLedgerTable()
  const rows = await prisma.ledgerEntry.groupBy({
    by: ['credit'], where: { credit: { startsWith: 'creator:' } }, _sum: { cents: true },
  })
  const debits = await prisma.ledgerEntry.groupBy({
    by: ['debit'], where: { debit: { startsWith: 'creator:' } }, _sum: { cents: true },
  })
  const out = new Map<string, number>()
  for (const r of rows) out.set(r.credit, (out.get(r.credit) ?? 0) + (r._sum.cents ?? 0))
  for (const d of debits) out.set(d.debit, (out.get(d.debit) ?? 0) - (d._sum.cents ?? 0))
  return [...out.entries()]
    .map(([acct, cents]) => ({ userId: acct.slice('creator:'.length), cents }))
    .filter(x => x.cents !== 0)
    .sort((a, b) => b.cents - a.cents)
}
