import { describe, expect, it, vi } from 'vitest'

// prisma is imported by world-create at module load but composeBirthSnapshot is
// pure — stub the import so it stays inert.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { composeBirthSnapshot } from '@/lib/world-create'

type Snap = { fields?: unknown[]; worldData?: Record<string, unknown>; worldParams?: Record<string, unknown> }

/** BORN STRICT, LEGACY-NEUTRAL (node-runtime ship rung). The node law
 *  (worldData.__nodeStrict → rung-E strike/bench/tell enforcement) turns ON at
 *  birth for worlds born blank, and ONLY for worlds born blank — a snapshot
 *  birth (fork, brew-with-cartridge, generate BASE) must pass through with its
 *  source's declaration untouched, or forking a working legacy world would
 *  bench its hooks on day one. */
describe('born strict — new worlds carry the node law from frame one', () => {
  it('a blank birth is born strict', () => {
    const snap = composeBirthSnapshot({}) as Snap
    expect(snap.worldData?.__nodeStrict).toBe(true)
    expect(snap.fields).toEqual([])
  })

  it('a worldData birth (creation_brief) keeps the brief AND is born strict', () => {
    const snap = composeBirthSnapshot({ worldData: { creation_brief: 'a tide garden' } }) as Snap
    expect(snap.worldData?.creation_brief).toBe('a tide garden')
    expect(snap.worldData?.__nodeStrict).toBe(true)
  })

  it('a snapshot birth (fork/brew/BASE) is untouched — no strict injected', () => {
    const source = { fields: [{ name: 'ember' }], worldData: { title: 'legacy world' } }
    const snap = composeBirthSnapshot({ snapshot: source }) as Snap
    expect(snap).toBe(source)                       // pass-through, not a reshaped copy
    expect(snap.worldData?.__nodeStrict).toBeUndefined()
  })

  it('a snapshot birth that already declares strict keeps it', () => {
    const source = { fields: [], worldData: { __nodeStrict: true } }
    const snap = composeBirthSnapshot({ snapshot: source }) as Snap
    expect(snap.worldData?.__nodeStrict).toBe(true)
  })

  it('birth-time grid shape still merges on the strict path (mobile birth)', () => {
    const snap = composeBirthSnapshot({ worldParams: { deviceConfig: 'mobile', gridW: 576, gridH: 1024 } }) as Snap
    expect(snap.worldData?.__nodeStrict).toBe(true)
    expect(snap.worldParams).toMatchObject({ deviceConfig: 'mobile', gridW: 576, gridH: 1024 })
  })

  it("a snapshot's own params still win over birth params (unchanged behavior)", () => {
    const source = { fields: [], worldParams: { gridW: 999 } }
    const snap = composeBirthSnapshot({ snapshot: source, worldParams: { gridW: 576, gridH: 1024 } }) as Snap
    expect(snap.worldParams?.gridW).toBe(999)
    expect(snap.worldParams?.gridH).toBe(1024)      // additive merge under the snapshot's own
    expect(snap.worldData?.__nodeStrict).toBeUndefined()
  })
})
