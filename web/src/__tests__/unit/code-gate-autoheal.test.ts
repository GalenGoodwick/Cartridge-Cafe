// co-build rung 2 (Galen's law): a broken push NEVER lands, and a fresh push
// that errors live heals back to the last good version on its own.
import { describe, it, expect } from 'vitest'
import { applyCommandToSnapshotObject, emptySnapshot, noteNodeError, noteShaderError, NODE_ERR_PROBATION_MS } from '@/app/api/engine/space-store'
import type { SceneSnapshot } from '@/app/engine/types'

const NOW = 1_700_000_000_000
const push = (snap: SceneSnapshot, code: string, at = NOW) =>
  applyCommandToSnapshotObject(snap, { type: 'add_step_hook', hookId: 'engine', code, __holder: 'builder-a', __now: at })

describe('THE CODE GATE — a broken push never lands', () => {
  it('empty code is refused; the node stays as it was', () => {
    const snap = emptySnapshot()
    push(snap, 'sim.ok = true')
    const r = push(snap, '   ')
    expect(r.ok).toBe(false)
    expect(String(r.error)).toContain('stays as it was')
    expect(snap.stepHooks[0].code).toBe('sim.ok = true')
  })

  it('a syntax error is refused with the compiler message; last version survives', () => {
    const snap = emptySnapshot()
    push(snap, 'sim.ok = true')
    const r = push(snap, 'if (sim.x { broken')
    expect(r.ok).toBe(false)
    expect(String(r.error)).toContain('does not compile')
    expect(snap.stepHooks[0].code).toBe('sim.ok = true')
  })

  it('a NEW node that never compiles never exists', () => {
    const snap = emptySnapshot()
    const r = applyCommandToSnapshotObject(snap, { type: 'add_step_hook', hookId: 'ghost', code: '((', __holder: 'b', __now: NOW })
    expect(r.ok).toBe(false)
    expect(snap.stepHooks).toHaveLength(0)
    expect((snap.worldData as Record<string, unknown>).__nodeHist ?? {}).not.toHaveProperty('ghost')
  })

  it('valid code lands (the gate is not a wall)', () => {
    const snap = emptySnapshot()
    const r = push(snap, 'sim.worldData.t = (sim.worldData.t ?? 0) + dt')
    expect(r.error).toBeUndefined()
    expect(snap.stepHooks).toHaveLength(1)
  })
})

describe('AUTO-HEAL — live errors revert a fresh push to the last good rev', () => {
  function twoRevWorld(): SceneSnapshot {
    const snap = emptySnapshot()
    push(snap, 'sim.v1 = true', NOW - 60_000)          // rev 1 — the good one
    push(snap, 'sim.v2.explodes.at.runtime', NOW)      // rev 2 — compiles, dies live
    return snap
  }

  it('errors below threshold only count; the code stays', () => {
    const snap = twoRevWorld()
    expect(noteNodeError(snap, 'engine', NOW + 1000)).toEqual({ counted: 1 })
    expect(noteNodeError(snap, 'engine', NOW + 2000)).toEqual({ counted: 2 })
    expect(snap.stepHooks[0].code).toBe('sim.v2.explodes.at.runtime')
  })

  it('the third error auto-reverts to the last good rev and marks the bad one', () => {
    const snap = twoRevWorld()
    noteNodeError(snap, 'engine', NOW + 1000)
    noteNodeError(snap, 'engine', NOW + 2000)
    const out = noteNodeError(snap, 'engine', NOW + 3000)
    expect(out.reverted).toBe(1)
    expect(snap.stepHooks[0].code).toBe('sim.v1 = true')
    const hist = (snap.worldData as Record<string, unknown>).__nodeHist as Record<string, Array<{ rev: number; bad?: true }>>
    expect(hist.engine.find(r => r.rev === 2)?.bad).toBe(true)
  })

  it('a node with NO good ancestor stays put (never stripped)', () => {
    const snap = emptySnapshot()
    push(snap, 'sim.only.rev.errors', NOW)
    for (let i = 1; i <= 3; i++) noteNodeError(snap, 'engine', NOW + i * 1000)
    expect(snap.stepHooks).toHaveLength(1)   // benched by its own errors live, but never lost
  })

  it('an old settled rev is not on probation — errors are noted nowhere', () => {
    const snap = emptySnapshot()
    push(snap, 'sim.old = true', NOW - NODE_ERR_PROBATION_MS - 1000)
    expect(noteNodeError(snap, 'engine', NOW)).toEqual({})
  })

  it('a new rev resets the count', () => {
    const snap = twoRevWorld()
    noteNodeError(snap, 'engine', NOW + 1000)
    noteNodeError(snap, 'engine', NOW + 2000)
    push(snap, 'sim.v3 = "fixed"', NOW + 3000)          // the builder ships a fix
    const out = noteNodeError(snap, 'engine', NOW + 4000)
    expect(out).toEqual({ counted: 1 })                  // fresh rev, fresh count
    expect(snap.stepHooks[0].code).toBe('sim.v3 = "fixed"')
  })
})

describe('VISUALS get the same treatment (rung 2, second half)', () => {
  const vis = (snap: SceneSnapshot, wgsl: string, at = NOW) =>
    applyCommandToSnapshotObject(snap, { type: 'define_visual', name: 'aurora', wgsl, __holder: 'builder-a', __now: at })

  it('empty WGSL never lands — the visual stays', () => {
    const snap = emptySnapshot()
    vis(snap, 'fn visual_aurora() {}')
    const r = vis(snap, '   ')
    expect(r.ok).toBe(false)
    expect(snap.visualTypes[0].wgsl).toBe('fn visual_aurora() {}')
  })

  it('every landed define_visual versions under visual:<name>', () => {
    const snap = emptySnapshot()
    vis(snap, 'fn v1() {}', NOW - 1000)
    vis(snap, 'fn v2() {}', NOW)
    const hist = (snap.worldData as Record<string, unknown>).__nodeHist as Record<string, Array<{ rev: number; code: string }>>
    expect(hist['visual:aurora'].map(r => r.rev)).toEqual([1, 2])
  })

  it('one quarantine report heals a fresh shader to last-good (deterministic compile fail)', () => {
    const snap = emptySnapshot()
    vis(snap, 'fn good() {}', NOW - 1000)
    vis(snap, 'fn broken( {}', NOW)
    const out = noteShaderError(snap, 'visual', 'aurora', NOW + 500)
    expect(out.reverted).toBe(1)
    expect(snap.visualTypes[0].wgsl).toBe('fn good() {}')
    const hist = (snap.worldData as Record<string, unknown>).__nodeHist as Record<string, Array<{ rev: number; bad?: true }>>
    expect(hist['visual:aurora'].find(r => r.rev === 2)?.bad).toBe(true)
  })

  it('a shader with no good ancestor stays (benched live, never stripped)', () => {
    const snap = emptySnapshot()
    vis(snap, 'fn only_broken( {}', NOW)
    const out = noteShaderError(snap, 'visual', 'aurora', NOW + 500)
    expect(out.noAncestor).toBe(true)
    expect(snap.visualTypes).toHaveLength(1)
  })

  it('a settled shader never auto-moves', () => {
    const snap = emptySnapshot()
    vis(snap, 'fn old() {}', NOW - NODE_ERR_PROBATION_MS - 1000)
    expect(noteShaderError(snap, 'visual', 'aurora', NOW)).toEqual({})
  })
})
