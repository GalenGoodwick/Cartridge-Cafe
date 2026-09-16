// PHASE DOCKS — the walk-through test: a GAME goes creation P0→P8 with gates
// refusing then passing; an EDIT on a shipped world docks straight into TUNE.
import { describe, it, expect } from 'vitest'
import { PHASE_ORDER, canDock, verbAllowed, gateUntrue, processOf } from '@/lib/phase-docks'

const world = (wd: Record<string, unknown>) => ({ worldData: wd })
const ev = (pairs: Array<[string, string]>) => new Map(pairs.map(([c, s]) => [c, { status: s }]))

describe('phase docks — creation walks, edit jumps', () => {
  it('a fresh world is CREATION; a shipped world is EDIT', () => {
    expect(processOf(world({}))).toBe('creation')
    expect(processOf(world({ brief_done: true }))).toBe('edit')
    expect(processOf(world({ __build: { readyRevision: 'abc' } }))).toBe('edit')
  })

  it('creation cannot skip ahead of an unpassed gate', () => {
    const w = world({ __phase: { id: 'vision', mode: 'creation', dockedAt: 1, passed: [] } })
    expect(canDock('behavior', w).ok).toBe(false)
    expect(canDock('behavior', w).error).toContain('earns forward')
    expect(canDock('vision', w).ok).toBe(true)
  })

  it('creation moves forward exactly one earned phase at a time; backward free', () => {
    const w = world({ __phase: { id: 'space', mode: 'creation', dockedAt: 1, passed: ['vision', 'imagine', 'frame'] } })
    expect(canDock('space', w).ok).toBe(true)    // the next unearned
    expect(canDock('vision', w).ok).toBe(true)   // backward free
    expect(canDock('look', w).ok).toBe(false)    // space not passed yet
  })

  it('earned progress survives undock (the Neo walk bug): parked passes count', () => {
    const w = world({ __phasePassed: ['vision'] })   // undocked, vision earned
    expect(canDock('imagine', w).ok).toBe(true)      // next unearned
    expect(canDock('frame', w).ok).toBe(false)       // still cannot skip
  })

  it('EDIT docks any phase directly — the targeted re-entry', () => {
    const w = world({ brief_done: true })
    expect(canDock('tune', w).ok).toBe(true)
    expect(canDock('look', w).ok).toBe(true)
  })

  it('verbs are refused outside their phase, with the teaching line', () => {
    const w = world({ __phase: { id: 'look', mode: 'creation', dockedAt: 1, passed: [] } })
    const r = verbAllowed('add_step_hook', w)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('docked in LOOK')
    expect(r.error).toContain('BEHAVIOR')
    expect(verbAllowed('define_visual', w).ok).toBe(true)
    expect(verbAllowed('read_guide', w).ok).toBe(true)      // always-on
  })

  it('undocked worlds keep every existing flow (opt-in)', () => {
    expect(verbAllowed('add_step_hook', world({})).ok).toBe(true)
  })

  it('THE GAME WALK: each gate refuses until its truth exists, then passes', () => {
    // VISION: refused empty, passes once declared
    expect(gateUntrue('vision', ev([]), {})[0]).toContain('vision-declared')
    expect(gateUntrue('vision', ev([]), { visionDeclared: true })).toEqual([])
    // IMAGINE: the dream must exist, raw + layered, before geometry
    expect(gateUntrue('imagine', ev([]), {})[0]).toContain('imagine-declared')
    expect(gateUntrue('imagine', ev([]), { imagineDeclared: true })).toEqual([])
    // LOOK: needs the real-tab visual gate + compile
    expect(gateUntrue('look', ev([['shader-compile', 'passed']]), {})).toEqual(['visual-gate: missing'])
    expect(gateUntrue('look', ev([['visual-gate', 'passed'], ['shader-compile', 'passed']]), {})).toEqual([])
    // TUNE: a real responsive play
    expect(gateUntrue('tune', ev([]), {})).toEqual(['input-response: missing'])
    // PROOF: performance always; triage/no-live-bugs only when applicable
    expect(gateUntrue('proof', ev([['performance', 'passed']]), { dockstar: false, liveBugStamp: false })).toEqual([])
    expect(gateUntrue('proof', ev([['performance', 'passed']]), { dockstar: true }))
      .toEqual(['triage-complete: missing'])
    expect(gateUntrue('proof', ev([['performance', 'unavailable']]), {})).toEqual(['performance: unavailable'])
    // TEND: no exit gate
    expect(gateUntrue('tend', ev([]), {})).toEqual([])
    // the spine is ten stages
    expect(PHASE_ORDER).toHaveLength(11)
  })
})
