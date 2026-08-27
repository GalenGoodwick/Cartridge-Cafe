import { describe, it, expect } from 'vitest'
import { validateWorldDoc, worldDocOk, worldDocFacets, defaultFit, type WorldDoc } from '@/app/engine/world-config'
import type { UiGridDoc } from '@/app/engine/ui-grid'

// A tiny layout so the validator has real region ids to check ui/fit against.
const layout: UiGridDoc = {
  regions: [
    { id: 'game.stage', layer: 'game', anchor: { vx: [0, 1], vy: [0.08, 0.94] }, z: 0 },
    { id: 'chrome.topbar', layer: 'cafe', anchor: { vx: [0, 1], vy: [0, 0.08] }, z: 60 },
  ],
}

const base = (over: Partial<WorldDoc> = {}): WorldDoc => ({
  id: 'w1', name: 'World One',
  render: { kind: 'raymarch3d' },
  layout,
  ...over,
})

describe('WorldDoc validator — facet consistency', () => {
  it('a well-formed doc across facets is consistent', () => {
    const doc = base({
      ui: { 'chrome.topbar': { as: 'blocks', blocks: [] } },
      fit: { 'game.stage': { aspect: 'cover' }, 'chrome.topbar': defaultFit('contain') },
      input: { touch: 'stick+buttons', clickTargets: ['menu'] },
    })
    expect(validateWorldDoc(doc)).toEqual([])
    expect(worldDocOk(doc)).toBe(true)
  })

  it('catches ui/fit facets that target a region NOT in layout (the core bug)', () => {
    const doc = base({
      ui: { 'chrome.ghost': { as: 'nodes', tree: {} } },
      fit: { 'game.ghost': { aspect: 'cover' } },
    })
    const errs = validateWorldDoc(doc)
    expect(errs.some(e => /ui targets region 'chrome.ghost'/.test(e))).toBe(true)
    expect(errs.some(e => /fit targets region 'game.ghost'/.test(e))).toBe(true)
    expect(worldDocOk(doc)).toBe(false)
  })

  it('rejects an unknown render kind and an unknown aspect policy', () => {
    // @ts-expect-error — deliberately invalid kind
    expect(validateWorldDoc(base({ render: { kind: 'hologram' } })).some(e => /render.kind/.test(e))).toBe(true)
    // @ts-expect-error — deliberately invalid aspect
    expect(validateWorldDoc(base({ fit: { 'game.stage': { aspect: 'wonky' } } })).some(e => /aspect/.test(e))).toBe(true)
  })

  it('rejects an inverted viewport window that could never match', () => {
    const doc = base({ fit: { 'game.stage': { aspect: 'cover', when: { minW: 900, maxW: 400 } } } })
    expect(validateWorldDoc(doc).some(e => /minW > maxW/.test(e))).toBe(true)
  })

  it('worldDocFacets lists exactly the declared facets', () => {
    expect(worldDocFacets(base())).toEqual(['render', 'layout'])
    expect(worldDocFacets(base({ ui: { 'chrome.topbar': { as: 'blocks', blocks: [] } }, input: { touch: 'stick' } })))
      .toEqual(['render', 'layout', 'ui', 'input'])
  })
})
