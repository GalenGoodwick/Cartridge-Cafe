import { describe, it, expect } from 'vitest'
import {
  parseBranchScene,
  branchLineKey,
  latestBranchPerLine,
  branchOriginMarker,
  forkNameFor,
} from '@/lib/branch-to-fork'

/** Guards the branch→fork back-fill: the parser that turns a legacy branch
 *  scene name (`BASE ⑂ handle[ · label] · vN`) into the parts the migration
 *  needs to mint an owned fork. Grammar taken from api/engine/scene/route.ts. */
describe('parseBranchScene', () => {
  it('parses a plain branch: BASE ⑂ handle · vN', () => {
    expect(parseBranchScene('cinderfell ⑂ thepeoplesbourgeois · v1')).toEqual({
      scene: 'cinderfell ⑂ thepeoplesbourgeois · v1',
      base: 'cinderfell', handle: 'thepeoplesbourgeois', label: null, version: 1,
    })
  })

  it('parses a labelled branch: BASE ⑂ handle · label · vN', () => {
    expect(parseBranchScene('cinderfell ⑂ thepeoplesbourgeois · better-doggo-base · v3')).toEqual({
      scene: 'cinderfell ⑂ thepeoplesbourgeois · better-doggo-base · v3',
      base: 'cinderfell', handle: 'thepeoplesbourgeois', label: 'better-doggo-base', version: 3,
    })
  })

  it('keeps a multi-segment label intact', () => {
    const p = parseBranchScene('SKYWELL ⑂ mara · night · variant two · v12')
    expect(p?.label).toBe('night · variant two')
    expect(p?.version).toBe(12)
  })

  it('preserves a base name that itself contains spaces/caps', () => {
    expect(parseBranchScene('NOCTURNE DISTRICT ⑂ rook · v2')?.base).toBe('NOCTURNE DISTRICT')
  })

  it('rejects non-branch names', () => {
    expect(parseBranchScene('cinderfell')).toBeNull()          // a plain world
    expect(parseBranchScene('cinderfell ⑂ mara')).toBeNull()   // a branch with no version
    expect(parseBranchScene('')).toBeNull()
    // @ts-expect-error — defends the runtime guard against a non-string
    expect(parseBranchScene(null)).toBeNull()
  })
})

describe('latestBranchPerLine', () => {
  it('collapses versions of one line to the highest, keeps distinct lines apart', () => {
    const scenes = [
      'cinderfell ⑂ mara · v1',
      'cinderfell ⑂ mara · v2',
      'cinderfell ⑂ mara · v3',            // same line → only v3 survives
      'cinderfell ⑂ mara · sketch · v1',   // different label → its own line
      'cinderfell ⑂ rook · v1',            // different handle → its own line
      'skywell ⑂ mara · v1',               // different base → its own line
      'cinderfell',                         // not a branch → dropped
    ]
    const out = latestBranchPerLine(scenes)
    expect(out).toHaveLength(4)
    const mara = out.find(p => p.base === 'cinderfell' && p.handle === 'mara' && p.label === null)
    expect(mara?.version).toBe(3)
    expect(out.some(p => p.label === 'sketch')).toBe(true)
    expect(out.some(p => p.handle === 'rook')).toBe(true)
    expect(out.some(p => p.base === 'skywell')).toBe(true)
  })

  it('is order-independent for picking the latest version', () => {
    const a = latestBranchPerLine(['w ⑂ u · v2', 'w ⑂ u · v1'])
    const b = latestBranchPerLine(['w ⑂ u · v1', 'w ⑂ u · v2'])
    expect(a[0].version).toBe(2)
    expect(b[0].version).toBe(2)
  })
})

describe('branchLineKey / branchOriginMarker', () => {
  it('the line key separates label variants; the origin marker ignores label+version (idempotency)', () => {
    const v1 = parseBranchScene('cinderfell ⑂ mara · v1')!
    const v2 = parseBranchScene('cinderfell ⑂ mara · v2')!
    const labelled = parseBranchScene('cinderfell ⑂ mara · sketch · v1')!
    // same line across versions → same key; a labelled variant → different key
    expect(branchLineKey(v1)).toBe(branchLineKey(v2))
    expect(branchLineKey(v1)).not.toBe(branchLineKey(labelled))
    // the origin marker is base+handle only, so a re-run finds the same fork
    expect(branchOriginMarker(v1)).toBe('cinderfell ⑂ mara')
    expect(branchOriginMarker(labelled)).toBe('cinderfell ⑂ mara')
  })
})

describe('forkNameFor', () => {
  it('uses the brancher label when present, else a base remix suffix', () => {
    expect(forkNameFor(parseBranchScene('cinderfell ⑂ mara · better-doggo-base · v1')!)).toBe('better-doggo-base')
    expect(forkNameFor(parseBranchScene('cinderfell ⑂ mara · v1')!)).toBe('cinderfell (fork)')
  })

  it('clamps to 60 chars', () => {
    const long = 'x'.repeat(90)
    expect(forkNameFor(parseBranchScene(`base ⑂ mara · ${long} · v1`)!).length).toBe(60)
  })
})
