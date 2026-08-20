import { describe, it, expect } from 'vitest'
import { can, type WorldContext, type Role, type WorldView, type WorldKind } from '@/lib/worldContext'

/** Guards the branch→fork transition: the branch-to-edit detour is RETIRED.
 *  An owner's AI edits their live space directly — the version system (save
 *  points / SET MAIN) is the history and safety net — so neither the old
 *  `alterLive` nor the interim `branchToEdit` capability may exist. The owner
 *  still holds the direct-edit capabilities (mintKey / setHead / worldTools). */
const ctx = (over: Partial<WorldContext> & { role: Role; kind: WorldKind; view: WorldView }): WorldContext => ({
  surface: 'world',
  identity: { base: 'LIGHTHOUSE', slug: 'lighthouse', loaded: 'LIGHTHOUSE' },
  lineage: null,
  ...over,
})

describe('branch-to-edit retired (fork paradigm)', () => {
  it('branchToEdit is no longer a capability', () => {
    // @ts-expect-error branchToEdit was removed — an owner's AI edits the live space directly
    expect(can(ctx({ role: 'ownerSpace', kind: 'space', view: 'live' }), 'branchToEdit')).toBe(false)
  })

  it('the old alterLive capability is still gone too', () => {
    // @ts-expect-error alterLive was removed long before the fork transition
    expect(can(ctx({ role: 'ownerSpace', kind: 'space', view: 'live' }), 'alterLive')).toBe(false)
  })

  it('the owner keeps the direct-edit surface: mintKey + setHead + worldTools on their live space', () => {
    const live = ctx({ role: 'ownerSpace', kind: 'space', view: 'live' })
    expect(can(live, 'mintKey')).toBe(true)     // CONNECT AI mints the space key directly
    expect(can(live, 'setHead')).toBe(true)     // versions: crown a save point / restore
    expect(can(live, 'worldTools')).toBe(true)
  })

  it('a read-only version view still grants no mutations', () => {
    const versionView = ctx({ role: 'ownerSpace', kind: 'space', view: 'version' })
    expect(can(versionView, 'setHead')).toBe(false)
    expect(can(versionView, 'editLaw')).toBe(false)
  })
})
