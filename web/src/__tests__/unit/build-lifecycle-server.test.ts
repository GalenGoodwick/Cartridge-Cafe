import { describe, it, expect } from 'vitest'
import { worldFactsFromSnapshot, serverChecks, stampResults, evaluateFromSnapshot, worldRevision, type SnapshotLike } from '@/app/engine/build-lifecycle-server'

const gameSpec = { name: 'Comet', brief: 'catch comets', target: 'desktop', gameplay: { primitives: [{ kind: 'scoring' }, { kind: 'winCondition', when: 'reachScore', target: 20 }] } }

const gameSnap: SnapshotLike = {
  fields: [{ name: 'paddle', visualTypeName: 'solid' }, { name: 'ball', visualTypeName: 'glow' }],
  stepHooks: [{ code: 'const wd=sim.worldData; if(wd.input.pressed.space) wd.__score=(wd.__score||0)+1;' }],
  visualTypes: [{ name: 'solid', wgsl: 'fn visual_solid(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f { return col; }' },
                { name: 'glow', wgsl: 'fn visual_glow(uv: vec2f, sdf: f32, col: vec4f, time: f32, p: vec4f, behind: vec4f) -> vec4f { return col; }' }],
  worldData: { __bridge_rev: 7, spec: gameSpec },
}

describe('build-lifecycle-server — snapshot → lifecycle', () => {
  it('derives facts: interactive game (hooks read input + gameplay), fields have visuals', () => {
    const f = worldFactsFromSnapshot(gameSnap)
    expect(f).toEqual({ fieldCount: 2, hookCount: 1, hasVisual: true, interactive: true })
  })

  it('serverChecks passes hook-syntax + shader-compile for a clean world (at the current rev)', () => {
    const r = serverChecks(gameSnap)
    const byCheck = Object.fromEntries(r.map(c => [c.check, c]))
    expect(byCheck['hook-syntax'].status).toBe('passed')
    expect(byCheck['shader-compile'].status).toBe('passed')
    expect(r.every(c => c.revision === worldRevision(gameSnap))).toBe(true)
  })

  it('serverChecks fails hook-syntax on a syntax error and shader on a non-defining visual', () => {
    const bad: SnapshotLike = {
      fields: [{ name: 'p', visualTypeName: 'bogus' }],
      stepHooks: [{ code: 'const x = (' }], // syntax error
      visualTypes: [{ name: 'bogus', wgsl: '@fragment fn main(){}' }], // no fn visual_bogus
      worldData: { __bridge_rev: 1 },
    }
    const byCheck = Object.fromEntries(serverChecks(bad).map(c => [c.check, c]))
    expect(byCheck['hook-syntax'].status).toBe('failed')
    expect(byCheck['shader-compile'].status).toBe('failed')
  })

  it('ACCEPTANCE: an interactive game with only server checks is NOT ready (needs the eye)', () => {
    // server can prove it compiles/renders-shape, but input + acceptance scenarios
    // + restart need the browser — so it can't be certified from the server alone.
    const evalr = evaluateFromSnapshot(gameSnap, serverChecks(gameSnap))
    expect(evalr.ready).toBe(false)
    expect(evalr.outstanding.map(o => o.check)).toEqual(expect.arrayContaining(['input-response', 'p-win']))
  })

  it('with the eye supplying the browser checks at the current rev → ready', () => {
    const browser = stampResults(gameSnap, [
      { check: 'render-frame', status: 'passed', environment: 'browser-webgpu' },
      { check: 'input-response', status: 'passed', environment: 'playthrough' },
      { check: 'p-score', status: 'passed', environment: 'playthrough' },
      { check: 'p-win', status: 'passed', environment: 'playthrough' },
      { check: 'restart', status: 'passed', environment: 'playthrough' }, // winCondition ⇒ restart required
    ])
    const evalr = evaluateFromSnapshot(gameSnap, [...serverChecks(gameSnap), ...browser])
    expect(evalr.ready).toBe(true)
    expect(evalr.stage).toBe('ready')
  })

  it('stampResults tags evidence with the CURRENT revision (a stale browser result cannot claim a new rev)', () => {
    const stamped = stampResults(gameSnap, [{ check: 'render-frame', status: 'passed', revision: '3', environment: 'browser' }])
    expect(stamped[0].revision).toBe(worldRevision(gameSnap)) // forced to current rev, not the caller's claim
  })
})
