import { describe, it, expect } from 'vitest'
import { requiredChecks, currentEvidence, evaluateBuild, type ValidationResult, type WorldFacts } from '@/app/engine/build-lifecycle'
import { normalizeBuildSpec } from '@/lib/build-spec'

// Item 3 — completion is EARNED by evidence bound to the current revision, not
// asserted by a flag. These pin the acceptance properties: a rendered background
// alone can't ready an interactive game; a hook edit (new revision) invalidates a
// prior playthrough; GPU-unavailable is never a pass.

const facts = (o: Partial<WorldFacts>): WorldFacts => ({ fieldCount: 0, hookCount: 0, hasVisual: false, interactive: false, ...o })
const ev = (revision: string, check: string, status: ValidationResult['status'], env = 'test'): ValidationResult =>
  ({ revision, check, status, environment: env, details: [] })

const gameSpec = normalizeBuildSpec({
  name: 'Comet', brief: 'catch comets', target: 'desktop',
  gameplay: { primitives: [{ kind: 'scoring' }, { kind: 'lives', start: 3 }, { kind: 'winCondition', when: 'reachScore', target: 20 }] },
})

describe('build lifecycle — required checks', () => {
  it('a render-only world needs shader-compile + render-frame', () => {
    expect(requiredChecks(undefined, facts({ fieldCount: 3, hasVisual: true }))).toEqual(['shader-compile', 'render-frame'])
  })

  it('an interactive game additionally needs input, its acceptance scenarios, and restart', () => {
    const req = requiredChecks(gameSpec, facts({ fieldCount: 3, hookCount: 1, hasVisual: true, interactive: true }))
    expect(req).toEqual(expect.arrayContaining(['shader-compile', 'render-frame', 'hook-syntax', 'input-response', 'restart']))
    // acceptance ids from the drawn primitives (scoring/lives/win)
    expect(req).toEqual(expect.arrayContaining(['p-score', 'p-lives', 'p-win']))
  })

  it('performance is required only when a target is declared', () => {
    expect(requiredChecks(undefined, facts({ fieldCount: 1, hasVisual: true }))).not.toContain('performance')
    expect(requiredChecks(undefined, facts({ fieldCount: 1, hasVisual: true, perfTargetMs: 16 }))).toContain('performance')
  })
})

describe('build lifecycle — evaluate', () => {
  const gameFacts = facts({ fieldCount: 3, hookCount: 1, hasVisual: true, interactive: true })

  it('ACCEPTANCE: a rendered background alone cannot make an interactive game ready', () => {
    // only render evidence — no input, no acceptance scenarios
    const e = [ev('5', 'shader-compile', 'passed'), ev('5', 'render-frame', 'passed'), ev('5', 'hook-syntax', 'passed')]
    const r = evaluateBuild({ spec: gameSpec, facts: gameFacts, revision: '5', evidence: e })
    expect(r.ready).toBe(false)
    expect(r.stage).toBe('validating')
    expect(r.outstanding.map(o => o.check)).toEqual(expect.arrayContaining(['input-response', 'p-win', 'restart']))
  })

  it('all required checks passed for the current revision → ready', () => {
    const req = requiredChecks(gameSpec, gameFacts)
    const e = req.map(c => ev('5', c, 'passed'))
    const r = evaluateBuild({ spec: gameSpec, facts: gameFacts, revision: '5', evidence: e })
    expect(r.ready).toBe(true)
    expect(r.stage).toBe('ready')
    expect(r.outstanding).toEqual([])
  })

  it('ACCEPTANCE: a hook edit (new revision) invalidates a prior passing playthrough', () => {
    const req = requiredChecks(gameSpec, gameFacts)
    const oldEvidence = req.map(c => ev('5', c, 'passed')) // fully passed at rev 5
    // author edits a hook → revision is now 6; the rev-5 evidence no longer counts
    const r = evaluateBuild({ spec: gameSpec, facts: gameFacts, revision: '6', evidence: oldEvidence })
    expect(r.ready).toBe(false)
    expect(r.outstanding.every(o => o.status === 'missing')).toBe(true)
  })

  it('ACCEPTANCE: unavailable is never a pass (GPU down ≠ done)', () => {
    const req = requiredChecks(gameSpec, gameFacts)
    const e = req.map(c => ev('5', c, c === 'render-frame' ? 'unavailable' : 'passed'))
    const r = evaluateBuild({ spec: gameSpec, facts: gameFacts, revision: '5', evidence: e })
    expect(r.ready).toBe(false)
    expect(r.outstanding).toEqual([{ check: 'render-frame', status: 'unavailable' }])
  })

  it('a failed check → needs_changes', () => {
    const req = requiredChecks(gameSpec, gameFacts)
    const e = req.map(c => ev('5', c, c === 'input-response' ? 'failed' : 'passed'))
    const r = evaluateBuild({ spec: gameSpec, facts: gameFacts, revision: '5', evidence: e })
    expect(r.stage).toBe('needs_changes')
  })

  it('stage derivation: empty → draft, content-no-evidence → building', () => {
    expect(evaluateBuild({ facts: facts({}), revision: '1', evidence: [] }).stage).toBe('draft')
    expect(evaluateBuild({ facts: facts({ fieldCount: 2, hasVisual: true }), revision: '1', evidence: [] }).stage).toBe('building')
  })

  it('currentEvidence: latest run wins, prior revisions dropped', () => {
    const e = [ev('5', 'render-frame', 'passed'), ev('5', 'render-frame', 'failed'), ev('4', 'render-frame', 'passed')]
    const cur = currentEvidence(e, '5')
    expect(cur.get('render-frame')!.status).toBe('failed') // last write at rev 5
    expect(currentEvidence(e, '4').get('render-frame')!.status).toBe('passed')
  })
})
