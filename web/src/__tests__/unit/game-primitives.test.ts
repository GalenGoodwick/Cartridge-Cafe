import { describe, it, expect } from 'vitest'
import { normalizeBuildSpec, acceptanceFromSpec } from '@/lib/build-spec'
import { normalizeGamePrimitives, acceptanceFromPrimitives, GAME_PRIMITIVE_KINDS } from '@/app/engine/game-primitives'

// Gameplay is a PALETTE the AI draws from, not a form of requirements. A universal
// environment draws nothing and owes nothing; a game's drawn primitives IMPLY the
// acceptance checks — structure without imposed requirements (Galen, Sep 7).

describe('game primitives — draw from a palette, no requirements', () => {
  it('a universal environment draws no primitives and owes no acceptance', () => {
    const spec = normalizeBuildSpec({ name: 'Zen Pond', brief: 'a calm rippling pond you just watch', target: 'universal' })
    expect(spec.gameplay).toBeUndefined()
    expect(acceptanceFromSpec(spec)).toEqual([]) // nothing imposed
  })

  it('normalizeGamePrimitives keeps known kinds + params, drops unknown', () => {
    const prims = normalizeGamePrimitives([
      { kind: 'scoring', start: 0, per: 'catching a comet' },
      { kind: 'winCondition', when: 'reachScore', target: 20 },
      { kind: 'teleportation', note: 'not a real primitive' }, // dropped
      { kind: 'lives', start: 3, bogusParam: 'ignored' },
    ])
    expect(prims.map(p => p.kind)).toEqual(['scoring', 'winCondition', 'lives'])
    expect(prims[0]).toEqual({ kind: 'scoring', start: 0, per: 'catching a comet' })
    expect(prims[2]).toEqual({ kind: 'lives', start: 3 }) // unknown param stripped
  })

  it('drawn primitives imply acceptance checks; each maps to a verification kind', () => {
    const spec = normalizeBuildSpec({
      name: 'Comet Catcher', brief: 'catch comets', target: 'desktop',
      gameplay: { coreLoop: 'move + catch', primitives: [
        { kind: 'scoring' }, { kind: 'lives', start: 3 },
        { kind: 'winCondition', when: 'reachScore', target: 20 },
        { kind: 'loseCondition', when: 'livesZero' },
      ] },
    })
    const checks = acceptanceFromSpec(spec)
    const ids = checks.map(c => c.id)
    expect(ids).toEqual(expect.arrayContaining(['p-score', 'p-lives', 'p-win', 'p-lose']))
    expect(checks.every(c => ['state', 'render', 'playthrough', 'human'].includes(c.verification))).toBe(true)
    expect(checks.find(c => c.id === 'p-win')!.description).toMatch(/reachScore 20/)
  })

  it('explicit author checks and primitive-derived checks merge (no id collision)', () => {
    const spec = normalizeBuildSpec({
      name: 'G', brief: 'b',
      acceptance: [{ id: 'custom', description: 'the boss music kicks in at wave 3', verification: 'human' }],
      gameplay: { primitives: [{ kind: 'waves', target: 5 }] },
    })
    const checks = acceptanceFromSpec(spec)
    expect(checks.map(c => c.id)).toEqual(['custom', 'p-waves'])
  })

  it('every registered primitive kind produces at least one acceptance check', () => {
    for (const kind of GAME_PRIMITIVE_KINDS) {
      const checks = acceptanceFromPrimitives([{ kind }])
      expect(checks.length, `${kind} implies no acceptance`).toBeGreaterThan(0)
    }
  })
})
