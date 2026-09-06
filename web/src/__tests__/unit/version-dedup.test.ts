import { describe, expect, it } from 'vitest'

// NO IDENTICAL SAVE POINTS (Galen, Sep 5) — the one dedup law behind all
// three doors (save-point POST · pre-restore auto-save · flag freeze).
// Pure helper, real logic, no mocks.

import { findIdenticalVersion } from '@/lib/version-dedup'

const snapA = { fields: [{ id: 'f1', x: 1 }], worldData: { title: 'A' } }
const snapB = { fields: [{ id: 'f1', x: 2 }], worldData: { title: 'A' } }

describe('version dedup — identical to ANYTHING that exists = no new version', () => {
  it('matches a byte-identical snapshot anywhere in history, not just latest', () => {
    const versions = [
      { version: 3, snapshot: snapB },
      { version: 2, snapshot: structuredClone(snapA) },   // deep-equal copy, older rung
      { version: 1, snapshot: { fields: [] } },
    ]
    const hit = findIdenticalVersion(versions, structuredClone(snapA))
    expect(hit?.version).toBe(2)
  })

  it('the spam case: re-saving the state just saved matches the newest rung first', () => {
    const versions = [
      { version: 5, snapshot: structuredClone(snapA) },
      { version: 4, snapshot: structuredClone(snapA) },   // (pre-law duplicate)
    ]
    expect(findIdenticalVersion(versions, structuredClone(snapA))?.version).toBe(5)
  })

  it('a REAL change is never deduped — one field moved is a new point', () => {
    expect(findIdenticalVersion([{ version: 1, snapshot: snapA }], snapB)).toBeNull()
  })

  it('empty history → null (first save always lands)', () => {
    expect(findIdenticalVersion([], snapA)).toBeNull()
  })

  it('identity is BYTE identity: key order counts (same serializer upstream)', () => {
    // documents the deliberate limit — {a,b} vs {b,a} are different bytes.
    const v = [{ version: 1, snapshot: { a: 1, b: 2 } }]
    expect(findIdenticalVersion(v, { b: 2, a: 1 })).toBeNull()
  })

  it('null/undefined snapshots compare safely', () => {
    const v = [{ version: 1, snapshot: null }]
    expect(findIdenticalVersion(v, null)?.version).toBe(1)
    expect(findIdenticalVersion(v, undefined)).toBeNull()
  })
})
