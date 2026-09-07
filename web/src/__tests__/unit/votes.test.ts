import { describe, it, expect } from 'vitest'
import { readVoteDoc, toggleVote, voteCount, voteLiftedRecency, VOTE_LIFT_MS } from '@/lib/votes'

// ♥ UPVOTES — the pure core, tested before ship (the proper-always law).

describe('readVoteDoc — never trust stored shape', () => {
  it('reads a well-formed doc through', () => {
    expect(readVoteDoc({ up: { 'u:1': 100, 'v-abc': 200 } })).toEqual({ up: { 'u:1': 100, 'v-abc': 200 } })
  })
  it('empties on null / undefined / junk / arrays', () => {
    expect(readVoteDoc(null)).toEqual({ up: {} })
    expect(readVoteDoc(undefined)).toEqual({ up: {} })
    expect(readVoteDoc('vandalism')).toEqual({ up: {} })
    expect(readVoteDoc({ up: [1, 2] })).toEqual({ up: {} })
  })
  it('drops non-numeric and non-finite stamps, keeps the rest', () => {
    expect(readVoteDoc({ up: { a: 1, b: 'no', c: NaN, d: Infinity, e: 2 } })).toEqual({ up: { a: 1, e: 2 } })
  })
})

describe('toggleVote — one vote per voter, cast ⇄ withdraw', () => {
  it('casts when absent', () => {
    const r = toggleVote({ up: {} }, 'u:1', 500)
    expect(r).toMatchObject({ count: 1, mine: true })
    expect(r.doc.up['u:1']).toBe(500)
  })
  it('withdraws when present — and only MY entry moves', () => {
    const r = toggleVote({ up: { 'u:1': 1, 'v-x': 2 } }, 'u:1', 500)
    expect(r).toMatchObject({ count: 1, mine: false })
    expect(r.doc.up).toEqual({ 'v-x': 2 })
  })
  it('never mutates the input doc (RMW safety)', () => {
    const doc = { up: { 'u:1': 1 } }
    toggleVote(doc, 'u:1', 9)
    toggleVote(doc, 'u:2', 9)
    expect(doc).toEqual({ up: { 'u:1': 1 } })
  })
  it('double-toggle round-trips to the start', () => {
    const once = toggleVote({ up: {} }, 'v-a', 10)
    const twice = toggleVote(once.doc, 'v-a', 20)
    expect(voteCount(twice.doc)).toBe(0)
    expect(twice.mine).toBe(false)
  })
})

describe('voteLiftedRecency — the shelf blend (never votes-alone)', () => {
  it('is plain recency at zero votes', () => {
    expect(voteLiftedRecency(1234, 0)).toBe(1234)
  })
  it('one vote outranks anything less than VOTE_LIFT_MS fresher', () => {
    const older = voteLiftedRecency(1_000_000, 1)
    const fresher = voteLiftedRecency(1_000_000 + VOTE_LIFT_MS - 1, 0)
    expect(older).toBeGreaterThan(fresher)
  })
  it('…but NOT anything more than VOTE_LIFT_MS fresher — recency still lives', () => {
    const older = voteLiftedRecency(1_000_000, 1)
    const muchFresher = voteLiftedRecency(1_000_000 + VOTE_LIFT_MS + 1, 0)
    expect(muchFresher).toBeGreaterThan(older)
  })
  it('negative vote counts never lift (defensive floor)', () => {
    expect(voteLiftedRecency(1234, -5)).toBe(1234)
  })
})
