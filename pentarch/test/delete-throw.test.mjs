// delete-throw — the "double-click delete throws 'cannot read part of undefined'
// and deletes more than one" bug (Jul 31). Root cause: the layout cache (D.tilesL)
// is built at the TOP of the tick from the old tree; the delete handler shortens
// D.tree LATER the same tick; then the publish loop iterated the stale (longer,
// reindexed) tile list against the shorter tree → undefined.part throw + phantom
// tiles. Fix: re-run doLayout() after input, before publish. This guards it.
// Run: node --test pentarch/test/delete-throw.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const hookSrc = readFileSync(new URL('../base/hook.js', import.meta.url), 'utf8')
// strip the outer try/catch so a real throw is not swallowed by the self-heal
const naked = hookSrc.replace(/^try \{/, '').replace(/\} catch \(e\) \{[\s\S]*\}\s*$/, '')

const mk = () => {
  const sim = { worldData: {}, __e: {}, edge(k, v) { const w = !!this.__e[k]; this.__e[k] = !!v; return !!v && !w } }
  const hook = new Function('sim', 'dt', naked)
  return { sim, tick: (n = 1) => { for (let i = 0; i < n; i++) hook(sim, 1 / 60) } }
}
const tf = (d) => { const t = d.tilesL; let mx = 0, my = 0, ex = 1; for (const x of t) { mx += x.cx; my += x.cy } mx /= t.length; my /= t.length; for (const x of t) ex = Math.max(ex, Math.hypot(x.cx - mx, x.cy - my) + 1.2); return { mx, my, S: Math.min(0.12, 0.80 / ex) } }
const clickTile = (sim, tick, d, i) => { const { mx, my, S } = tf(d); const t = d.tilesL[i]; sim.worldData.mouse_x = ((t.cx - mx) * S + 1) * 256; sim.worldData.mouse_y = ((t.cy - my) * S + 1) * 256; sim.worldData.mouse_down = true; tick(); sim.worldData.mouse_down = false; tick() }

test('double-click delete never throws, and pop always matches the tree', () => {
  // reproduce many geometries (the greedy-adjacency builds that forced the throw)
  for (let trial = 0; trial < 12; trial++) {
    const { sim, tick } = mk(); tick(3); const d = () => sim.worldData.__pd
    for (let n = 0; n < 9; n++) {
      const g = d().ghostsL; if (!g.length) break
      const tiles = d().tilesL; let bK = 0, bD = 1e9
      for (let k = 0; k < g.length; k++) { let m = 1e9; for (const t of tiles) { const dd = Math.hypot(g[k].g.cx - t.cx, g[k].g.cy - t.cy); if (dd > 0.1 && dd < m) m = dd } const s = m + ((k + trial) % 3) * 0.01; if (s < bD) { bD = s; bK = k } }
      const gg = g[bK].g; const { mx, my, S } = tf(d()); sim.worldData.mouse_x = ((gg.cx - mx) * S + 1) * 256; sim.worldData.mouse_y = ((gg.cy - my) * S + 1) * 256
      sim.worldData.mouse_down = true; tick(); sim.worldData.mouse_down = false; tick()
    }
    // delete every non-core tile by double-click; each must not throw and must
    // leave the published population length == tree length (no phantom tiles)
    while (d().tree.length > 1) {
      const i = 1
      assert.doesNotThrow(() => { clickTile(sim, tick, d(), i); clickTile(sim, tick, d(), i) }, `trial ${trial}: delete threw`)
      const pop = sim.worldData.gpuPopulation || []
      // count PART tiles in the pop (codes <100 are tiles; core=200/300) — must equal tree length
      const tileEnts = []
      for (let e = 0; e < pop.length; e += 4) { const c = pop[e + 3]; const kind = ((c % 100) + 100) % 100; if (kind < 50 || c === 200 || c === 300) tileEnts.push(c) }
      assert.equal(tileEnts.length, d().tree.length, `trial ${trial}: pop tiles (${tileEnts.length}) != tree (${d().tree.length})`)
      // the CORE must always be present and unique
      assert.equal(tileEnts.filter(c => c === 200 || c === 300).length, 1, 'exactly one core published')
    }
  }
})
