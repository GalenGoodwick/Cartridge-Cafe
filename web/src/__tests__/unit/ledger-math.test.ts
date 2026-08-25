// The creator ledger's split engine, tested to the standard Galen set:
// "totally automated with perfect bookkeeping and attributions." Perfect here
// is checkable: cent-exact pools, deterministic replay, zero-sum books.
import { describe, it, expect } from 'vitest'
import {
  splitPoolCents, splitRevenueV1, applyEntries, booksBalance,
  HOUSE_BPS, OWNER_BPS, AUTHORS_BPS,
} from '@/lib/ledger-math'

// deterministic PRNG (no Math.random in tests — reproducible fuzz)
function lcg(seed: number) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
}

describe('splitPoolCents — largest-remainder exactness', () => {
  it('always allocates EXACTLY the pool (fuzz: 500 random pools/weights)', () => {
    const rnd = lcg(42)
    for (let i = 0; i < 500; i++) {
      const pool = Math.floor(rnd() * 1_000_000)
      const n = 1 + Math.floor(rnd() * 9)
      const weights = Array.from({ length: n }, (_, k) => ({ account: `a${k}`, weight: rnd() * 10 }))
      const out = splitPoolCents(pool, weights)
      const sum = out.reduce((s, a) => s + a.cents, 0)
      expect(sum).toBe(pool === 0 ? 0 : pool)
    }
  })

  it('is deterministic — same inputs, byte-identical output', () => {
    const weights = [
      { account: 'zed', weight: 1 / 3 }, { account: 'amy', weight: 1 / 3 }, { account: 'moe', weight: 1 / 3 },
    ]
    const a = splitPoolCents(1000, weights)
    const b = splitPoolCents(1000, weights)
    expect(a).toEqual(b)
  })

  it('breaks remainder ties by account name (stable, auditable)', () => {
    // 100 cents / 3 equal weights → 33/33/33 + 1 leftover → alphabetically first
    const out = splitPoolCents(100, [
      { account: 'zed', weight: 1 }, { account: 'amy', weight: 1 }, { account: 'moe', weight: 1 },
    ])
    expect(out).toEqual([
      { account: 'amy', cents: 34 }, { account: 'moe', cents: 33 }, { account: 'zed', cents: 33 },
    ])
  })

  it('merges duplicate accounts before splitting', () => {
    const out = splitPoolCents(100, [
      { account: 'a', weight: 1 }, { account: 'a', weight: 1 }, { account: 'b', weight: 2 },
    ])
    expect(out).toEqual([{ account: 'a', cents: 50 }, { account: 'b', cents: 50 }])
  })

  it('drops zero/negative/NaN weights; empty effective set → []', () => {
    expect(splitPoolCents(100, [{ account: 'a', weight: 0 }, { account: 'b', weight: -3 }, { account: 'c', weight: NaN }])).toEqual([])
    expect(splitPoolCents(100, [])).toEqual([])
  })

  it('refuses non-integer and negative pools', () => {
    expect(() => splitPoolCents(10.5, [{ account: 'a', weight: 1 }])).toThrow()
    expect(() => splitPoolCents(-1, [{ account: 'a', weight: 1 }])).toThrow()
  })

  it('one-cent pool goes to exactly one account (the heaviest)', () => {
    const out = splitPoolCents(1, [{ account: 'small', weight: 1 }, { account: 'big', weight: 99 }])
    expect(out).toEqual([{ account: 'big', cents: 1 }])
  })
})

describe('splitRevenueV1 — the 30/40/30 policy', () => {
  it('policy constants sum to the whole pool', () => {
    expect(HOUSE_BPS + OWNER_BPS + AUTHORS_BPS).toBe(10000)
  })

  it('splits a clean pool 30/40/30 (single author)', () => {
    const out = splitRevenueV1(1000, 'house', 'creator:own', [{ account: 'creator:auth', weight: 1 }])
    expect(out).toEqual([
      { account: 'creator:auth', cents: 300 },
      { account: 'creator:own', cents: 400 },
      { account: 'house', cents: 300 },
    ])
  })

  it('no authors → their 30% flows to the owner (70/30)', () => {
    const out = splitRevenueV1(1000, 'house', 'creator:own', [])
    expect(out).toEqual([
      { account: 'creator:own', cents: 700 },
      { account: 'house', cents: 300 },
    ])
  })

  it('owner who also authored earns both roles, merged', () => {
    const out = splitRevenueV1(1000, 'house', 'creator:own', [{ account: 'creator:own', weight: 1 }])
    expect(out).toEqual([
      { account: 'creator:own', cents: 700 },   // 400 owner + 300 author
      { account: 'house', cents: 300 },
    ])
  })

  it('author shares follow engagement weights, cent-exact', () => {
    const out = splitRevenueV1(1000, 'house', 'creator:own', [
      { account: 'creator:a', weight: 3 }, { account: 'creator:b', weight: 1 },
    ])
    // authors bucket = 300 → 225 / 75
    expect(out.find(x => x.account === 'creator:a')?.cents).toBe(225)
    expect(out.find(x => x.account === 'creator:b')?.cents).toBe(75)
  })

  it('ALWAYS sums exactly to the pool (fuzz: awkward pools × author counts)', () => {
    const rnd = lcg(7)
    for (let i = 0; i < 300; i++) {
      const pool = 1 + Math.floor(rnd() * 99_999)
      const n = Math.floor(rnd() * 7)
      const authors = Array.from({ length: n }, (_, k) => ({ account: `creator:${k}`, weight: rnd() * 5 + 0.01 }))
      const out = splitRevenueV1(pool, 'house', 'creator:owner', authors)
      expect(out.reduce((s, a) => s + a.cents, 0)).toBe(pool)
    }
  })

  it('is deterministic across replays', () => {
    const authors = [{ account: 'creator:x', weight: 0.7 }, { account: 'creator:y', weight: 0.3 }]
    expect(splitRevenueV1(12345, 'house', 'creator:o', authors))
      .toEqual(splitRevenueV1(12345, 'house', 'creator:o', authors))
  })
})

describe('the journal — double-entry invariants', () => {
  it('books ALWAYS balance to zero (fuzz over random entry streams)', () => {
    const rnd = lcg(99)
    for (let i = 0; i < 100; i++) {
      const n = 1 + Math.floor(rnd() * 50)
      const entries = Array.from({ length: n }, () => ({
        debit: `acct${Math.floor(rnd() * 5)}`,
        credit: `acct${5 + Math.floor(rnd() * 5)}`,
        cents: 1 + Math.floor(rnd() * 10_000),
      }))
      expect(booksBalance(entries)).toBe(true)
    }
  })

  it('a booked charge + its v1 split leaves the pool at exactly zero', () => {
    const pool = 'world:tideglass:pool'
    const allocs = splitRevenueV1(4999, 'house', 'creator:galen', [
      { account: 'creator:fable', weight: 2 }, { account: 'creator:opus', weight: 1 },
    ])
    const entries = [
      { debit: 'external:stripe', credit: pool, cents: 4999 },
      ...allocs.map(a => ({ debit: pool, credit: a.account, cents: a.cents })),
    ]
    const bal = applyEntries(entries)
    expect(bal.get(pool)).toBe(0)                       // nothing stranded, nothing minted
    expect(bal.get('external:stripe')).toBe(-4999)      // external outflow = the charge
    expect(booksBalance(entries)).toBe(true)
  })

  it('a reversal restores balances exactly (clawback model)', () => {
    const fwd = [{ debit: 'external:stripe', credit: 'creator:a', cents: 500 }]
    const rev = [{ debit: 'creator:a', credit: 'external:stripe', cents: 500 }]
    const bal = applyEntries([...fwd, ...rev])
    expect(bal.get('creator:a')).toBe(0)
    expect(bal.get('external:stripe')).toBe(0)
  })

  it('rejects malformed entries (same account both sides; fractional cents)', () => {
    expect(() => applyEntries([{ debit: 'a', credit: 'a', cents: 100 }])).toThrow()
    expect(() => applyEntries([{ debit: 'a', credit: 'b', cents: 1.5 }])).toThrow()
  })
})
