// THE STAGED BIRTH gates (Galen Sep 6: "the trunk of the tree") — unit proof
// that imagination-before-code is enforced exactly as designed, and that
// legacy worlds pass untouched. Pure lib + the store chokepoint.
import { describe, it, expect } from 'vitest'
import { isStaged, lookFor, lookWarning, isInteractive, planRefusal, briefDoneGates, appendJournal, noteWarning } from '@/lib/staged-birth'
import { composeBirthSnapshot } from '@/lib/world-create'
import { applyCommandToSnapshotObject } from '@/app/api/engine/space-store'
import type { SceneSnapshot } from '@/app/engine/types'

const stagedWd = (extra: Record<string, unknown> = {}) => ({ __stagedBirth: 1, ...extra })

describe('birth stamp', () => {
  it('blank births carry the law + born-strict', () => {
    const snap = composeBirthSnapshot({}) as { worldData: Record<string, unknown> }
    expect(snap.worldData.__stagedBirth).toBe(1)
    expect(snap.worldData.__nodeStrict).toBe(true)
  })
  it('snapshot-override births (forks) keep their source untouched', () => {
    const snap = composeBirthSnapshot({ snapshot: { fields: [], worldData: {} } as never }) as { worldData: Record<string, unknown> }
    expect(snap.worldData.__stagedBirth).toBeUndefined()
  })
})

describe('looks (stage 2)', () => {
  const wd = stagedWd({ looks: { ball: 'a drop of crema, cream-gold, dragging a caramel comet-tail', moment_hit: 'the ring vents a steam torus' } })
  it('fuzzy-matches element names to looks', () => {
    expect(lookFor('ball', wd)).toContain('crema')
    expect(lookFor('Ball', wd)).toContain('crema')
    expect(lookFor('the_ball', wd)).toContain('crema')     // name contains key
    expect(lookFor('gauge', wd)).toBeNull()
  })
  it('warns for lookless elements on staged worlds only', () => {
    expect(lookWarning('gauge', wd)).toContain('LOOK MISSING')
    expect(lookWarning('ball', wd)).toBeNull()
    expect(lookWarning('gauge', { looks: {} })).toBeNull()         // legacy: silent
  })
})

describe('interactivity detection (stage 3)', () => {
  it('reads input signatures out of hook code', () => {
    expect(isInteractive([{ code: 'const l = wd.key_left' }])).toBe(true)
    expect(isInteractive([{ code: 'const p = wd.input.pointer' }])).toBe(true)
    expect(isInteractive([{ code: 'wd.gpuUniforms = [1]' }])).toBe(false)
    expect(isInteractive([], { touchControls: 'stick' })).toBe(true)
  })
})

describe('plans (stage 4)', () => {
  it('refuses code on plan-less nodes, staged worlds only', () => {
    const wd = stagedWd({ __nodes: { rules: { id: 'rules' } } })
    expect(planRefusal('rules', wd)).toContain('PLAN MISSING')
    expect(planRefusal('rules', wd)).toContain('register_node')     // the refusal teaches
    expect(planRefusal('rules', { __nodes: {} })).toBeNull()        // legacy: free
  })
  it('a real plan opens the gate; a token gesture does not', () => {
    const ok = stagedWd({ __nodes: { rules: { plan: 'owns ball physics state; reads flipper angles from __pcP; writes gpuUniforms 0-31; per tick: integrate, collide, score' } } })
    expect(planRefusal('rules', ok)).toBeNull()
    const thin = stagedWd({ __nodes: { rules: { plan: 'does stuff' } } })
    expect(planRefusal('rules', thin)).toContain('PLAN MISSING')
  })
})

describe('richly historic nodes', () => {
  it('journal accumulates and caps', () => {
    let node: Record<string, unknown> = {}
    for (let i = 0; i < 35; i++) node = { ...node, journal: appendJournal(node, { at: i, note: `change ${i}` }) }
    const j = node.journal as Array<{ note: string }>
    expect(j.length).toBe(30)
    expect(j[j.length - 1].note).toBe('change 34')
  })
  it('push without note warns on staged worlds', () => {
    expect(noteWarning('rules', stagedWd(), undefined)).toContain('NO NOTE')
    expect(noteWarning('rules', stagedWd(), 'arch kick made physical')).toBeNull()
    expect(noteWarning('rules', {}, undefined)).toBeNull()
  })
})

describe('brief_done verdict (the hard gate)', () => {
  const base = {
    worldData: stagedWd({
      looks: { boiler: 'roast-black glass chamber with a breathing red heater below' },
      __nodes: { rules: { plan: 'owns physics; reads input; writes uniforms; per tick integrates and scores the ball' } },
    }),
    fields: [{ name: 'Boiler', visualTypeName: 'percolator' }],
    stepHooks: [{ hookId: 'rules', code: 'const l = wd.key_left' }],
  }
  it('passes a fully staged world and returns the confess checklist', () => {
    const v = briefDoneGates({ ...base, worldData: { ...base.worldData, design: 'hold two levers to keep a crema ball alive; aim at three portafilter bumpers for mg; risk: outlanes past the guides; escalation: past 4000mg the machine shakes, changing every shot' } })
    expect(v.errors).toEqual([])
    expect(v.checklist.boiler).toBe('UNEXAMINED')
  })
  it('refuses lookless skinned fields', () => {
    const v = briefDoneGates({ ...base, fields: [{ name: 'Gauge', visualTypeName: 'gauge_v' }], worldData: { ...base.worldData, design: 'x'.repeat(80) } })
    expect(v.errors.join()).toContain('LOOKS MISSING')
  })
  it('refuses interactive worlds without design', () => {
    const v = briefDoneGates(base)
    expect(v.errors.join()).toContain('DESIGN MISSING')
  })
  it('refuses coded nodes without plans', () => {
    const wd = { ...base.worldData, design: 'x'.repeat(80), __nodes: {} }
    const v = briefDoneGates({ ...base, worldData: wd })
    expect(v.errors.join()).toContain('PLANS MISSING')
  })
  it('legacy worlds sail through untouched', () => {
    const v = briefDoneGates({ worldData: {}, fields: [{ name: 'X', visualTypeName: 'y' }], stepHooks: [{ hookId: 'h', code: 'wd.key_a' }] })
    expect(v.errors).toEqual([])
  })
  it('looksVerified entries fill the checklist', () => {
    const v = briefDoneGates({ ...base, worldData: { ...base.worldData, design: 'x'.repeat(80), looksVerified: { boiler: 'frame 2: heater breathes, glass reads dark — yes' } } })
    expect(v.checklist.boiler).toContain('heater breathes')
  })
})

describe('the store chokepoint (integration)', () => {
  const mkSnap = (wd: Record<string, unknown>): SceneSnapshot =>
    ({ fields: [], worldData: wd, stepHooks: [], visualTypes: [], interactionEffects: [] } as unknown as SceneSnapshot)
  it('hook push on a staged world is refused until the node has a plan, then lands', () => {
    const snap = mkSnap(stagedWd({ __nodes: {} }))
    const refused = applyCommandToSnapshotObject(snap, { type: 'update_step_hook', hookId: 'rules', code: 'wd.x = 1' })
    expect(refused.ok).toBe(false)
    expect(String(refused.error)).toContain('PLAN MISSING')
    applyCommandToSnapshotObject(snap, { type: 'register_node', id: 'rules', node: { plan: 'owns nothing yet; reads nothing; writes wd.x; per tick sets a test flag for this unit test' } })
    const landed = applyCommandToSnapshotObject(snap, { type: 'update_step_hook', hookId: 'rules', code: 'wd.x = 1', note: 'first landing of the test organ' })
    expect(landed.error).toBeUndefined()
    const nodes = (snap.worldData as Record<string, unknown>).__nodes as Record<string, { journal?: Array<{ note: string }> }>
    expect(nodes.rules.journal?.[0]?.note).toBe('first landing of the test organ')
  })
  it('legacy world hook push lands without any plan', () => {
    const snap = mkSnap({})
    const landed = applyCommandToSnapshotObject(snap, { type: 'add_step_hook', hookId: 'free', code: 'wd.y = 2' })
    expect(landed.error).toBeUndefined()
  })
  it('create_field warns lookless on staged worlds', () => {
    const snap = mkSnap(stagedWd({ looks: {} }))
    const r = applyCommandToSnapshotObject(snap, { type: 'create_field', name: 'Gauge', visualType: 'g', x: 10, y: 10 })
    expect(String(r.lookWarning ?? '')).toContain('LOOK MISSING')
  })
})
