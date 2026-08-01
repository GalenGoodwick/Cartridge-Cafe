// stale-heal — the frame law (build-base.mjs): a persisted __pd from an OLDER
// hook generation must NEVER leave a dead black yard. This is the regression
// test for "we lost the core in design mode" (Jul 31): stale state + silent
// catch = hook throws every tick, publishes nothing, palette still paints
// (hardcoded in the shader) — the world LOOKS half-alive while the hook is dead.
// Run: node --test pentarch/test/stale-heal.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const hookSrc = readFileSync(new URL('../base/hook.js', import.meta.url), 'utf8')
const hook = new Function('sim', 'dt', hookSrc)

const mkSim = (pd) => ({
  worldData: pd === undefined ? {} : { __pd: JSON.parse(JSON.stringify(pd)) },
  __e: {},
  edge(k, v) { const was = !!this.__e[k]; this.__e[k] = !!v; return !!v && !was },
})
const tick = (sim, n = 1) => { for (let i = 0; i < n; i++) hook(sim, 1 / 60) }
const coreCode = (sim) => (sim.worldData.gpuPopulation || [])[3]

// the exact live killer: rev==layoutRev persisted WITHOUT the layout cache —
// old hooks threw "tiles is not iterable" forever
const STALE_SHAPES = {
  'layout cache missing': { tree: [{ parent: -1, edge: -1, part: 1 }], sel: 0, rev: 3, layoutRev: 3, t: 9 },
  'pre-version state (no v)': { tree: [{ parent: -1, edge: -1, part: 1 }], sel: 0, rev: 0, t: 0 },
  'old battle shape': { tree: [{ parent: -1, edge: -1, part: 1 }, { parent: 0, edge: 2, part: 4 }], sel: 1, rev: 2, t: 5, mode: 'battle', bt: { oldShape: true } },
  'garbage': { anything: true },
}

for (const [name, pd] of Object.entries(STALE_SHAPES)) {
  test(`stale __pd (${name}) self-heals to a live yard with the core`, () => {
    const sim = mkSim(pd)
    tick(sim, 3)
    assert.equal(sim.worldData.__pd.v, hookSrc.match(/const HOOK_V = (\d+)/)[1] | 0, 'state re-stamped')
    assert.equal(coreCode(sim), 300, 'core publishes (selected HELM = 300)')
    assert.ok((sim.worldData.hud || []).some(h => h.id === 'yt'), 'yard HUD alive')
  })
}

test('fresh boot still stamps v and publishes the core', () => {
  const sim = mkSim()
  tick(sim, 2)
  assert.equal(coreCode(sim), 300)
})

test('a mid-tick throw surfaces RECOVERED on the HUD, never a silent blank', () => {
  const sim = mkSim()
  tick(sim, 2)
  // sabotage the layout cache to force a throw inside the yard body
  sim.worldData.__pd.tilesL = null
  sim.worldData.__pd.layoutRev = sim.worldData.__pd.rev   // pretend cache is fresh
  tick(sim, 1)
  assert.ok((sim.worldData.hud || []).some(h => h.id === 'err' && /RECOVERED/.test(h.text)), 'error shown')
  tick(sim, 2)                                            // soft heal: relayout forced
  assert.equal(coreCode(sim), 300, 'yard back alive after healing')
})
