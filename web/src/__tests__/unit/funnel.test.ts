import { describe, it, expect } from 'vitest'
import { pct, computeFunnel, worldVirality } from '@/lib/funnel'

describe('pct', () => {
  it('is 0 on a zero denominator (no visitors yet)', () => {
    expect(pct(0, 0)).toBe(0)
    expect(pct(5, 0)).toBe(0)
    expect(pct(3, -1)).toBe(0)
  })
  it('rounds to one decimal', () => {
    expect(pct(1, 3)).toBe(33.3)   // 33.333… → 33.3
    expect(pct(2, 3)).toBe(66.7)   // 66.666… → 66.7
    expect(pct(1, 8)).toBe(12.5)
  })
  it('is 100 when everyone converts and 0 when none do', () => {
    expect(pct(10, 10)).toBe(100)
    expect(pct(0, 10)).toBe(0)
  })
})

describe('computeFunnel', () => {
  it('derives play/edit/publish rates against visitors', () => {
    const f = computeFunnel({ visitors: 200, players: 120, editors: 40, publishers: 10, mcpLogins: 7, shares: 15 })
    expect(f.playRate).toBe(60)     // 120/200
    expect(f.editRate).toBe(20)     // 40/200
    expect(f.publishRate).toBe(5)   // 10/200
    // raw counts pass through untouched
    expect(f.mcpLogins).toBe(7)
    expect(f.shares).toBe(15)
  })
  it('never divides by zero on an empty window', () => {
    const f = computeFunnel({ visitors: 0, players: 0, editors: 0, publishers: 0, mcpLogins: 0, shares: 0 })
    expect(f.playRate).toBe(0)
    expect(f.editRate).toBe(0)
    expect(f.publishRate).toBe(0)
  })
})

describe('worldVirality', () => {
  it('computes new visitors per share (k) and guards zero shares', () => {
    const out = worldVirality([
      { path: '/space/a', shares: 4, newcomers: 8 },   // k=2
      { path: '/space/b', shares: 0, newcomers: 3 },   // k=0 (no shares recorded)
      { path: '/space/c', shares: 5, newcomers: 20 },  // k=4
    ])
    // sorted by newcomers desc: c(20), a(8), b(3)
    expect(out.map(w => w.path)).toEqual(['/space/c', '/space/a', '/space/b'])
    expect(out[0].k).toBe(4)
    expect(out[1].k).toBe(2)
    expect(out[2].k).toBe(0)
  })
})
