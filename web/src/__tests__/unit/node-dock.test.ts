import { describe, it, expect } from 'vitest'
import {
  appendNodeRev, capWorldHistory, historyMeta, findRevertTarget, markRevBad,
  shouldAutoRevert, feedAppend, NODE_HIST_MIN_KEEP, QUARANTINE_ERR_THRESHOLD,
  FEED_CAP, type NodeHist, type FeedLine,
} from '@/lib/node-dock'

/** Guards the co-build dock core: per-node version chains (size-budgeted,
 *  in-snapshot), revert-target selection, quarantine policy, and the feed ring. */
const rev = (n: number, code: string, at = n, by = 'b1'): Parameters<typeof appendNodeRev>[2] =>
  ({ rev: n, code, at, by })

describe('appendNodeRev', () => {
  it('appends versions oldest→newest', () => {
    const h: NodeHist = {}
    appendNodeRev(h, 'tide', rev(1, 'a'))
    appendNodeRev(h, 'tide', rev(2, 'b'))
    expect(h.tide.map(r => r.rev)).toEqual([1, 2])
  })

  it('dedupes an identical re-push (refreshes timestamp, keeps chain length)', () => {
    const h: NodeHist = {}
    appendNodeRev(h, 'tide', rev(1, 'same', 10))
    appendNodeRev(h, 'tide', { rev: 2, code: 'same', at: 99, by: 'b1', note: 'again' })
    expect(h.tide).toHaveLength(1)
    expect(h.tide[0].at).toBe(99)
    expect(h.tide[0].note).toBe('again')
  })

  it('enforces the per-node byte budget but always keeps MIN_KEEP revs', () => {
    const h: NodeHist = {}
    const big = 'x'.repeat(60 * 1024)          // two of these bust the 96KB budget
    appendNodeRev(h, 'shader', rev(1, big))
    appendNodeRev(h, 'shader', rev(2, big + 'y'))
    appendNodeRev(h, 'shader', rev(3, big + 'z'))
    expect(h.shader.length).toBe(NODE_HIST_MIN_KEEP)          // trimmed to the floor
    expect(h.shader.map(r => r.rev)).toEqual([2, 3])          // oldest evicted first
  })
})

describe('capWorldHistory', () => {
  it('evicts the globally oldest evictable rev, never a node’s newest', () => {
    const h: NodeHist = {}
    const chunk = 'x'.repeat(90 * 1024)
    // ~540KB across 6 revs on 3 nodes → must evict down under 512KB
    // (distinct code per rev — identical code would hit the dedupe path instead)
    appendNodeRev(h, 'a', rev(1, chunk + 'a1', 1)); appendNodeRev(h, 'a', rev(2, chunk + 'a2', 50))
    appendNodeRev(h, 'b', rev(1, chunk + 'b1', 2)); appendNodeRev(h, 'b', rev(2, chunk + 'b2', 60))
    appendNodeRev(h, 'c', rev(1, chunk + 'c1', 3)); appendNodeRev(h, 'c', rev(2, chunk + 'c2', 70))
    capWorldHistory(h)
    const total = Object.values(h).flat().reduce((s, r) => s + r.code.length, 0)
    expect(total).toBeLessThanOrEqual(512 * 1024)
    // every node still has its newest
    expect(h.a[h.a.length - 1].rev).toBe(2)
    expect(h.b[h.b.length - 1].rev).toBe(2)
    expect(h.c[h.c.length - 1].rev).toBe(2)
    // the oldest (a@1, at=1) went first
    expect(h.a.find(r => r.rev === 1)).toBeUndefined()
  })
})

describe('findRevertTarget / markRevBad', () => {
  it('picks the newest good rev, skipping bad ones and the rev being avoided', () => {
    const h: NodeHist = {}
    appendNodeRev(h, 'tide', rev(1, 'v1'))
    appendNodeRev(h, 'tide', rev(2, 'v2'))
    appendNodeRev(h, 'tide', rev(3, 'v3-broken'))
    expect(findRevertTarget(h, 'tide', 3)?.rev).toBe(2)
    markRevBad(h, 'tide', 2)                                   // v2 also turns out bad
    expect(findRevertTarget(h, 'tide', 3)?.rev).toBe(1)
    markRevBad(h, 'tide', 1)
    expect(findRevertTarget(h, 'tide', 3)).toBeNull()          // nothing good left
  })

  it('historyMeta exposes rev metadata without code bodies', () => {
    const h: NodeHist = {}
    appendNodeRev(h, 'tide', { rev: 1, code: 'abc', at: 5, by: 'b1', note: 'first' })
    const m = historyMeta(h, 'tide')
    expect(m).toEqual([{ rev: 1, at: 5, by: 'b1', note: 'first', bad: false, codeBytes: 3 }])
    expect(JSON.stringify(m)).not.toContain('abc')
  })
})

describe('quarantine policy + feed ring', () => {
  it('auto-revert triggers at the error threshold, not before', () => {
    expect(shouldAutoRevert(QUARANTINE_ERR_THRESHOLD - 1)).toBe(false)
    expect(shouldAutoRevert(QUARANTINE_ERR_THRESHOLD)).toBe(true)
  })

  it('the feed ring caps at FEED_CAP newest lines and clamps line length', () => {
    let ring: FeedLine[] = []
    for (let i = 0; i < FEED_CAP + 10; i++) {
      ring = feedAppend(ring, { at: i, by: 'b1', kind: 'status', text: 'line ' + i })
    }
    expect(ring).toHaveLength(FEED_CAP)
    expect(ring[0].text).toBe('line 10')                       // oldest 10 evicted
    ring = feedAppend(ring, { at: 999, by: 'b1', kind: 'status', text: 'y'.repeat(600) })
    expect(ring[ring.length - 1].text).toHaveLength(500)
  })
})
