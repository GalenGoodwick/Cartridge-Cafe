import { describe, it, expect } from 'vitest'
import {
  normalizeBuildSpec, buildSpecFromCreateBody, specToBirthParams, specIsPublic, specToWorldData,
  type BuildSpec,
} from '@/lib/build-spec'

// Item 2 of the reliability program — the shared BuildSpec contract. These pin the
// two acceptance properties at the contract level: every spec field is preserved,
// and equivalent UI vs MCP requests map to equivalent birth inputs.

describe('normalizeBuildSpec — defaults + validation', () => {
  it('fills safe defaults for a bare prompt (target universal, visibility private, no acceptance)', () => {
    const s = normalizeBuildSpec({ name: 'Pinball', brief: 'a pinball game' })
    expect(s).toMatchObject({ name: 'Pinball', brief: 'a pinball game', target: 'universal', visibility: 'private', acceptance: [] })
    expect(s.gameplay).toBeUndefined()
    expect(s.presentation).toBeUndefined()
  })

  it('is idempotent: normalize(normalize(x)) deep-equals normalize(x)', () => {
    const raw = {
      name: 'Boss Rush', brief: 'fight three bosses', target: 'mobile', visibility: 'public',
      gameplay: { coreLoop: 'dodge + shoot', controls: { left: 'move left', space: 'fire' }, progression: 'harder bosses', winCondition: 'beat all 3', restartBehavior: 'R restarts' },
      presentation: { vision: 'neon arena', references: ['nier'] },
      acceptance: [{ id: 'a', description: 'boss 2 spawns', verification: 'playthrough' }],
    }
    const once = normalizeBuildSpec(raw)
    const twice = normalizeBuildSpec(once)
    expect(twice).toEqual(once)
  })

  it('preserves every gameplay / presentation / acceptance field', () => {
    const s = normalizeBuildSpec({
      name: 'X', brief: 'b', target: 'desktop', visibility: 'public',
      gameplay: { coreLoop: 'loop', controls: { a: 'left', d: 'right' }, progression: 'levels', winCondition: 'win', loseCondition: 'lose', restartBehavior: 'restart' },
      presentation: { vision: 'a mood', references: ['ref1', 'ref2'] },
      acceptance: [
        { id: 'c1', description: 'flippers actuate', verification: 'playthrough' },
        { description: 'renders a frame', verification: 'render' }, // id defaulted
      ],
    })
    // win/lose are now PRIMITIVES (legacy strings fold in), not required fields
    expect(s.gameplay).toEqual({
      coreLoop: 'loop', controls: { a: 'left', d: 'right' }, progression: 'levels', restartBehavior: 'restart',
      primitives: [{ kind: 'winCondition', note: 'win' }, { kind: 'loseCondition', note: 'lose' }],
    })
    expect(s.presentation).toEqual({ vision: 'a mood', references: ['ref1', 'ref2'] })
    expect(s.acceptance).toEqual([
      { id: 'c1', description: 'flippers actuate', verification: 'playthrough' },
      { id: 'ac2', description: 'renders a frame', verification: 'render' },
    ])
  })

  it('rejects junk: bad target/visibility/verification fall back; description-less checks dropped', () => {
    const s = normalizeBuildSpec({
      name: 'Y', brief: 'b', target: 'holographic', visibility: 'secret',
      acceptance: [{ id: 'x', description: '', verification: 'render' }, { description: 'ok', verification: 'telepathy' }],
    })
    expect(s.target).toBe('universal')
    expect(s.visibility).toBe('private')
    expect(s.acceptance).toEqual([{ id: 'ac1', description: 'ok', verification: 'human' }])
  })
})

describe('mappers — one rule for every door', () => {
  it('specToBirthParams: mobile is born portrait, others default square', () => {
    expect(specToBirthParams(normalizeBuildSpec({ target: 'mobile' }))).toEqual({ deviceConfig: 'mobile', gridW: 576, gridH: 1024, gridSize: 1024 })
    expect(specToBirthParams(normalizeBuildSpec({ target: 'desktop' }))).toEqual({})
    expect(specToBirthParams(normalizeBuildSpec({ target: 'universal' }))).toEqual({})
  })

  it('specIsPublic: public only when spec says so AND owner has no IP-shield', () => {
    const pub = normalizeBuildSpec({ visibility: 'public' })
    const priv = normalizeBuildSpec({ visibility: 'private' })
    expect(specIsPublic(pub, false)).toBe(true)
    expect(specIsPublic(pub, true)).toBe(false) // shield forces private
    expect(specIsPublic(priv, false)).toBe(false)
  })

  it('specToWorldData: brief→creation_brief, vision mirror, fit facet, full spec preserved', () => {
    const s = normalizeBuildSpec({ name: 'N', brief: 'the brief', target: 'mobile', presentation: { vision: 'the vision' } })
    const wd = specToWorldData(s, { by: 'user_1', at: 1000 })
    expect(wd.creation_brief).toEqual({ prompt: 'the brief', by: 'user_1', at: 1000 })
    expect(wd.vision).toBe('the vision')
    expect(wd.fit).toBe('mobile')
    expect(wd.spec).toEqual(s)
  })

  it('universal target writes no fit facet', () => {
    const wd = specToWorldData(normalizeBuildSpec({ brief: 'b', target: 'universal' }), { by: 'u', at: 1 })
    expect('fit' in wd).toBe(false)
  })
})

describe('PARITY — equivalent UI and MCP requests produce equivalent birth inputs', () => {
  // The same logical world, phrased two ways: the Create-UI legacy body (targets/
  // access) and a canonical MCP BuildSpec. Both must normalize identically and thus
  // birth identically — the item-2 acceptance.
  const uiBody = { name: 'Flip City', brief: 'pinball in a city', targets: 'mobile', access: 'open' }
  const mcpSpec = { name: 'Flip City', brief: 'pinball in a city', target: 'mobile', visibility: 'public' }

  it('the two bodies normalize to the same BuildSpec', () => {
    const fromUi = buildSpecFromCreateBody(uiBody)
    const fromMcp = normalizeBuildSpec(mcpSpec)
    expect(fromUi).toEqual(fromMcp)
  })

  it('and therefore to the same birth params / visibility / worldData', () => {
    const a = buildSpecFromCreateBody(uiBody)
    const b = normalizeBuildSpec(mcpSpec)
    const ctx = { by: 'user_1', at: 42 }
    expect(specToBirthParams(a)).toEqual(specToBirthParams(b))
    expect(specIsPublic(a, false)).toEqual(specIsPublic(b, false))
    expect(specToWorldData(a, ctx)).toEqual(specToWorldData(b, ctx))
  })

  it('a spec round-trips through worldData.spec unchanged (item-3 lifecycle can read it back)', () => {
    const spec: BuildSpec = normalizeBuildSpec(mcpSpec)
    const wd = specToWorldData(spec, { by: 'u', at: 1 })
    expect(normalizeBuildSpec(wd.spec)).toEqual(spec)
  })
})
