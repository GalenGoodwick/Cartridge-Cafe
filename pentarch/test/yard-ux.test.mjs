// yard-ux — click-priority laws added Jul 31: cycling the selected tile, fast
// double-click still deletes, click-on-nothing deselects, and M's gimbal bonus
// actually reaches the arcade flight stats. Run: node --test pentarch/test/yard-ux.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const hookSrc = readFileSync(new URL('../base/hook.js', import.meta.url), 'utf8')
const mk = () => {
  const sim = { worldData: {}, __e: {}, edge(k, v) { const w = !!this.__e[k]; this.__e[k] = !!v; return !!v && !w } }
  const hook = new Function('sim', 'dt', hookSrc)
  return { sim, tick: (n = 1) => { for (let i = 0; i < n; i++) hook(sim, 1 / 60) }, d: () => sim.worldData.__pd }
}
const growAtGhost = (c, k) => {
  const D = c.d(), tiles = D.tilesL; let mx = 0, my = 0, ex = 1
  for (const t of tiles) { mx += t.cx; my += t.cy } mx /= tiles.length; my /= tiles.length
  for (const t of tiles) ex = Math.max(ex, Math.hypot(t.cx - mx, t.cy - my) + 1.2)
  const S = Math.min(0.12, 0.80 / ex), g = D.ghostsL[k].g
  c.sim.worldData.mouse_x = ((g.cx - mx) * S + 1) * 256; c.sim.worldData.mouse_y = ((g.cy - my) * S + 1) * 256
  c.sim.worldData.mouse_down = true; c.tick(); c.sim.worldData.mouse_down = false; c.tick()
}
const clickTile = (c, i, gap = 1) => {
  const D = c.d(), tiles = D.tilesL; let mx = 0, my = 0, ex = 1
  for (const t of tiles) { mx += t.cx; my += t.cy } mx /= tiles.length; my /= tiles.length
  for (const t of tiles) ex = Math.max(ex, Math.hypot(t.cx - mx, t.cy - my) + 1.2)
  const S = Math.min(0.12, 0.80 / ex), t = tiles[i]
  c.sim.worldData.mouse_x = ((t.cx - mx) * S + 1) * 256; c.sim.worldData.mouse_y = ((t.cy - my) * S + 1) * 256
  c.sim.worldData.mouse_down = true; c.tick(); c.sim.worldData.mouse_down = false; c.tick(gap)
}
const clickUV = (c, ux, uy) => {
  c.sim.worldData.mouse_x = (ux + 1) * 256; c.sim.worldData.mouse_y = (uy + 1) * 256
  c.sim.worldData.mouse_down = true; c.tick(); c.sim.worldData.mouse_down = false; c.tick()
}

test('a slower re-click on the ALREADY-selected tile cycles its variant', () => {
  const c = mk(); c.tick(3); growAtGhost(c, 0)
  c.d().tree[1].part = 3                                    // GUN
  clickTile(c, 1, 30)                                        // select (already grown-selected) — first engage cycles once
  const p1 = c.d().tree[1].part
  clickTile(c, 1, 30)                                        // slow re-click → cycle again
  assert.notEqual(c.d().tree[1].part, p1, 'part changed on the slow re-click')
  assert.equal(c.d().tree.length, 2, 'tile was NOT deleted by the slow re-click')
})

test('a fast double-click on a tile still deletes it', () => {
  const c = mk(); c.tick(3); growAtGhost(c, 0); growAtGhost(c, 0)
  c.d().sel = -1
  const before = c.d().tree.length
  clickTile(c, 1, 1); clickTile(c, 1, 1)                     // fast: select then re-click within a couple frames
  assert.equal(c.d().tree.length, before - 1, 'fast double-click deleted the tile')
})

test('clicking on nothing deselects the tile AND clears the brush', () => {
  const c = mk(); c.tick(3); growAtGhost(c, 0)
  clickTile(c, 1, 1)
  assert.equal(c.d().sel, 1)
  clickUV(c, 0.9, 0.5)                                       // empty space, no tile/ghost
  assert.equal(c.d().sel, -1, 'deselected')
  assert.equal(c.d().brush, null, 'brush cleared')
})

test("M's gimbal bonus raises an engine's forward accel/vmax", () => {
  const c = mk(); c.tick(3); const d = c.d()
  d.tree.push({ parent: 0, edge: 2, part: 4 }); d.rev++; c.tick(2)
  c.sim.worldData.key_b = true; c.tick(); c.sim.worldData.key_b = false; c.tick()
  const accFixed = d.bt.ARC.acc, vmaxFixed = d.bt.ARC.vmax
  c.sim.worldData.key_b = true; c.tick(); c.sim.worldData.key_b = false; c.tick()   // back to design
  d.sel = 1
  for (let k = 0; k < 2; k++) { c.sim.worldData.key_m = true; c.tick(); c.sim.worldData.key_m = false; c.tick() }  // fixed→swivel→wide
  assert.equal(d.tree[1].m, 2, 'mount tier is wide')
  c.sim.worldData.key_b = true; c.tick(); c.sim.worldData.key_b = false; c.tick()
  assert.ok(d.bt.ARC.acc > accFixed, 'wide mount raises accel')
  assert.ok(d.bt.ARC.vmax > vmaxFixed, 'wide mount raises vmax')
})
