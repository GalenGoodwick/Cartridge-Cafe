import { describe, it, expect } from 'vitest'
import { can, type WorldContext, type Role, type WorldView, type WorldKind } from '@/lib/worldContext'

/** Guards the ALTER removal: an owner on their own LIVE space must resolve to
 *  `branchToEdit` (CONNECT AI routes through a branch), and the old live-edit
 *  capability `alterLive` must no longer exist. */
const ctx = (over: Partial<WorldContext> & { role: Role; kind: WorldKind; view: WorldView }): WorldContext => ({
  surface: 'world',
  identity: { base: 'LIGHTHOUSE', slug: 'lighthouse', loaded: 'LIGHTHOUSE' },
  lineage: null,
  ...over,
})

describe('branchToEdit capability (ALTER removed)', () => {
  it('is granted to the owner of their own live space', () => {
    expect(can(ctx({ role: 'ownerSpace', kind: 'space', view: 'live' }), 'branchToEdit')).toBe(true)
  })

  it('is denied to a non-owner, on a branch, or on a non-live view', () => {
    expect(can(ctx({ role: 'juror', kind: 'space', view: 'live' }), 'branchToEdit')).toBe(false)
    expect(can(ctx({ role: 'ownerBranch', kind: 'branch', view: 'branchHead' }), 'branchToEdit')).toBe(false)
    expect(can(ctx({ role: 'ownerSpace', kind: 'space', view: 'version' }), 'branchToEdit')).toBe(false)
  })

  it('no longer exposes the old alterLive capability', () => {
    // @ts-expect-error alterLive was removed — editing a live world now branches
    expect(can(ctx({ role: 'ownerSpace', kind: 'space', view: 'live' }), 'alterLive')).toBe(false)
  })
})
