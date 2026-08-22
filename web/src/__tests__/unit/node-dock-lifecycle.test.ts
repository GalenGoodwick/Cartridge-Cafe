import { describe, it, expect } from 'vitest'
import { applyCommandToSnapshotObject } from '@/app/api/engine/space-store'
import type { SceneSnapshot } from '@/app/engine/types'
import type { NodeHist } from '@/lib/node-dock'

/** The co-build dock lifecycle, end to end through the REAL command switch:
 *  dock → work → undock(submit) versions the node; a second builder is gated
 *  while held and free after; a bad rev reverts to last-good WITHOUT touching
 *  any other node. This is the per-node answer to world-level quarantine. */
const world = (): SceneSnapshot => ({
  name: 'w', fields: [], worldParams: {}, worldData: {},
  stepHooks: [], interactionRules: [], interactionEffects: [],
  visualTypes: [], modules: [], timestamp: 0,
} as unknown as SceneSnapshot)

const A = 'builder-a', B = 'builder-b'
const t0 = 1_000_000
const apply = (snap: SceneSnapshot, cmd: Record<string, unknown>) =>
  applyCommandToSnapshotObject(snap, cmd) as Record<string, unknown>

describe('dock → submit → history', () => {
  it('dock claims the node and returns history + code; undock(submit) lands a new version and releases', () => {
    const s = world()
    const d1 = apply(s, { type: 'dock_node', id: 'tide', __holder: A, __now: t0 })
    expect(d1.ok).toBe(true)
    expect((d1.node as { holder?: string }).holder).toBe(A)
    expect(d1.history).toEqual([])                     // fresh node, no versions yet

    const u1 = apply(s, { type: 'undock_node', id: 'tide', code: 'u[0]=1 // v-one', note: 'first tide', __holder: A, __now: t0 + 1000 })
    expect(u1.ok).toBe(true)
    expect(u1.submitted).toBe(true)
    const wd = s.worldData as Record<string, unknown>
    const nodes = wd.__nodes as Record<string, { holder?: string; rev?: number }>
    expect(nodes.tide.holder).toBeUndefined()          // released on undock
    const hist = wd.__nodeHist as NodeHist
    expect(hist.tide).toHaveLength(1)
    expect(hist.tide[0].by).toBe(A)
    expect(hist.tide[0].note).toBe('first tide')
    expect(s.stepHooks.find(h => h.id === 'tide')?.code).toContain('v-one')
  })

  it('a held node refuses a second builder; abandon-undock frees it', () => {
    const s = world()
    apply(s, { type: 'dock_node', id: 'tide', __holder: A, __now: t0 })
    const dB = apply(s, { type: 'dock_node', id: 'tide', __holder: B, __now: t0 + 5000 })
    expect(dB.ok).toBe(false)
    expect(String(dB.error)).toContain('HELD')
    // A abandons (undock without code): no version lands, hold clears
    const ab = apply(s, { type: 'undock_node', id: 'tide', __holder: A, __now: t0 + 6000 })
    expect(ab.ok).toBe(true)
    expect(ab.submitted).toBeUndefined()
    const dB2 = apply(s, { type: 'dock_node', id: 'tide', __holder: B, __now: t0 + 7000 })
    expect(dB2.ok).toBe(true)
  })
})

describe('node_revert — per-node healing', () => {
  it('reverts to last-good, marks the bad rev, and leaves other nodes untouched', () => {
    const s = world()
    // two nodes; harbor gets three versions, the last one "broken"
    apply(s, { type: 'add_step_hook', hookId: 'sky', code: 'u[9]=1 // sky-fine', __holder: B, __now: t0 })
    apply(s, { type: 'add_step_hook', hookId: 'harbor', code: 'u[0]=1 // good-one', __holder: A, __now: t0 + 1 })
    apply(s, { type: 'add_step_hook', hookId: 'harbor', code: 'u[0]=2 // good-two', __holder: A, __now: t0 + 2 })
    apply(s, { type: 'add_step_hook', hookId: 'harbor', code: 'u[0]=3 // broken!!', __holder: A, __now: t0 + 3 })

    const wd = s.worldData as Record<string, unknown>
    const badRev = Number((wd.__nodes as Record<string, { rev?: number }>).harbor.rev)
    const rv = apply(s, { type: 'node_revert', id: 'harbor', __holder: A, __now: t0 + 4 })
    expect(rv.ok).toBe(true)
    expect(s.stepHooks.find(h => h.id === 'harbor')?.code).toContain('good-two')   // healed to last-good
    expect(s.stepHooks.find(h => h.id === 'sky')?.code).toContain('sky-fine')      // neighbor untouched

    const hist = wd.__nodeHist as NodeHist
    expect(hist.harbor.find(r => r.rev === badRev)?.bad).toBe(true)                // bad rev marked
    expect(rv.markedBad).toBe(badRev)
    // history is append-only: the revert landed as a NEW rev carrying old code
    expect(hist.harbor[hist.harbor.length - 1].note).toContain('reverted to rev')
  })

  it('reverting a node held fresh by someone else is refused', () => {
    const s = world()
    apply(s, { type: 'add_step_hook', hookId: 'harbor', code: 'v1', __holder: A, __now: t0 })
    apply(s, { type: 'add_step_hook', hookId: 'harbor', code: 'v2', __holder: A, __now: t0 + 1 })
    const rv = apply(s, { type: 'node_revert', id: 'harbor', __holder: B, __now: t0 + 2 })
    expect(rv.ok).toBe(false)
    expect(String(rv.error)).toContain('HELD')
  })

  it('with nothing good in history, revert refuses instead of guessing', () => {
    const s = world()
    apply(s, { type: 'add_step_hook', hookId: 'solo', code: 'only-rev', __holder: A, __now: t0 })
    const rv = apply(s, { type: 'node_revert', id: 'solo', __holder: A, __now: t0 + 1 })
    expect(rv.ok).toBe(false)
    expect(String(rv.error)).toContain('no good version')
  })
})
