import { describe, it, expect } from 'vitest'
import { checkConformance, carveSet, snapshotIds, type BaseManifest } from '@/lib/base-manifest'

// Base-matrix P2: the manifest cannot lie about the snapshot, and the carve
// set pulls dependents along.

const manifest: BaseManifest = { v: 1, cell: '2d-mobile', entries: [
  { kind: 'hook', id: 'player', role: 'input+movement', removable: 'load-bearing' },
  { kind: 'hook', id: 'physics', role: 'gravity+platforms', removable: 'load-bearing' },
  { kind: 'hook', id: 'entities', role: 'coins+critters', removable: true },
  { kind: 'hook', id: 'rules', role: 'score/lives', removable: true, deps: ['entities'] },
  { kind: 'visual', id: 'base_atmo', role: 'backdrop', removable: 'load-bearing' },
  { kind: 'field', id: 'bg', role: 'backdrop field', removable: 'load-bearing' },
] }

const snap = {
  stepHooks: [{ hookId: 'player' }, { hookId: 'physics' }, { hookId: 'entities' }, { hookId: 'rules' }],
  fields: [{ id: 'bg' }],
  visualTypes: [{ name: 'base_atmo' }],
  modules: [],
}

describe('base manifest (P2)', () => {
  it('a truthful manifest conforms; load-bearing + removable split out', () => {
    const c = checkConformance(snapshotIds(snap), manifest)
    expect(c.ok).toBe(true)
    expect(c.loadBearing).toContain('player')
    expect(c.removable).toEqual(['entities', 'rules'])
  })

  it('an unmapped snapshot node goes red (missing territory)', () => {
    const c = checkConformance(snapshotIds({ ...snap, stepHooks: [...snap.stepHooks, { hookId: 'ghost-fx' }] }), manifest)
    expect(c.ok).toBe(false)
    expect(c.unmapped).toEqual(['hook:ghost-fx'])
  })

  it('a manifest ghost goes red (claims what does not exist)', () => {
    const m2 = { ...manifest, entries: [...manifest.entries, { kind: 'hook' as const, id: 'audio', role: 'sfx', removable: true }] }
    const c = checkConformance(snapshotIds(snap), m2)
    expect(c.ok).toBe(false)
    expect(c.ghosts).toEqual(['hook:audio'])
  })

  it('bad deps go red', () => {
    const m3 = { ...manifest, entries: manifest.entries.map(e => e.id === 'rules' ? { ...e, deps: ['nope'] } : e) }
    expect(checkConformance(snapshotIds(snap), m3).badDeps).toEqual(['rules → nope'])
  })

  it('carveSet pulls transitive dependents (removing entities takes rules too)', () => {
    expect([...carveSet(manifest, 'entities')].sort()).toEqual(['entities', 'rules'])
    expect([...carveSet(manifest, 'rules')]).toEqual(['rules'])
  })
})
