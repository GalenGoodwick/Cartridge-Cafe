// DOCKSTAR ACCOUNTING (W2+W4) — the triage law, unit-proven before it gates
// anything live: bay empty + ledger complete + no ghosts + real targets.
import { describe, it, expect } from 'vitest'
import { checkTriage, primsInSnapshot, nodeIds, nodeGreenChecks } from '@/lib/dockstar'

const world = (over: Record<string, unknown> = {}) => ({
  stepHooks: [
    { id: 'player', code: '' }, { id: 'world', code: '' }, { id: 'uplink', code: '' },
    { id: 'prim-fps-walk', code: '' },
  ],
  fields: [{ id: 'backdrop' }, { id: 'prim-room' }],
  worldData: {
    dockstarBay: { v: 1, born: [
      { id: 'prim-fps-walk', kind: 'hook', role: 'movement' },
      { id: 'prim-room', kind: 'field', role: 'geometry' },
      { id: 'prim-orbit-cam', kind: 'hook', role: 'camera style' },
    ] },
    triage: [],
    ...over,
  },
})

describe('dockstar accounting', () => {
  it('charts: prims and nodes split correctly', () => {
    const s = world()
    expect(primsInSnapshot(s).map(p => p.id).sort()).toEqual(['prim-fps-walk', 'prim-room'])
    expect(nodeIds(s)).toEqual(['player', 'world', 'uplink'])
    expect(nodeGreenChecks(s)).toContain('node-green:player')
  })

  it('non-dockstar world: the law does not apply', () => {
    expect(checkTriage({ stepHooks: [], fields: [], worldData: {} })).toBeNull()
  })

  it('untriaged prims = leftovers, absent-with-no-entry = unaccounted', () => {
    const v = checkTriage(world())!
    expect(v.ok).toBe(false)
    expect(v.leftovers.sort()).toEqual(['prim-fps-walk', 'prim-room'])
    expect(v.unaccounted).toEqual(['prim-orbit-cam'])   // born, gone, no ledger entry
  })

  it('a complete honest triage passes', () => {
    const s = world({ triage: [
      { prim: 'prim-fps-walk', fate: 'moved', to: 'player' },
      { prim: 'prim-room', fate: 'moved', to: 'world' },
      { prim: 'prim-orbit-cam', fate: 'deleted', reason: 'fixed camera fits the vision' },
    ] })
    s.stepHooks = s.stepHooks.filter(h => h.id !== 'prim-fps-walk')
    s.fields = s.fields.filter(f => f.id !== 'prim-room')
    const v = checkTriage(s)!
    expect(v.ok).toBe(true)
    expect(v.counts).toEqual({ born: 3, moved: 2, deleted: 1, remaining: 0 })
  })

  it('ledger cannot invent history (ghosts) or name unreal targets', () => {
    const s = world({ triage: [
      { prim: 'prim-never-born', fate: 'deleted', reason: 'x' },
      { prim: 'prim-orbit-cam', fate: 'moved', to: 'no-such-node' },
    ] })
    const v = checkTriage(s)!
    expect(v.ok).toBe(false)
    expect(v.ghosts).toEqual(['prim-never-born'])
    expect(v.badTargets).toEqual(['prim-orbit-cam → no-such-node'])
  })

  it('re-triage supersedes: last ledger entry wins', () => {
    const s = world({ triage: [
      { prim: 'prim-orbit-cam', fate: 'moved', to: 'no-such-node' },
      { prim: 'prim-orbit-cam', fate: 'deleted', reason: 'superseded' },
    ] })
    const v = checkTriage(s)!
    expect(v.badTargets).toEqual([])
    expect(v.counts.deleted).toBe(1)
  })
})
