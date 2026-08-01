// specials-menu — clicking a sealed shape (diamond/moon/bay/star) opens a
// drawn side menu (chrome panel/buttons) to pick which special fills it,
// overriding that shape's default automatic bonus (Galen, Jul 31: "clicking
// the diamond/etc opens up a side menu with things to select to fill in").
// Run: node --test pentarch/test/specials-menu.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const hookSrc = readFileSync(new URL('../base/hook.js', import.meta.url), 'utf8')
const mk = () => {
  const sim = { worldData: {}, __e: {}, edge(k, v) { const w = !!this.__e[k]; this.__e[k] = !!v; return !!v && !w } }
  const hook = new Function('sim', 'dt', hookSrc)
  return { sim, tick: (n = 1) => { for (let i = 0; i < n; i++) hook(sim, 1 / 60) }, d: () => sim.worldData.__pd }
}
const clickUV = (c, ux, uy) => {
  c.sim.worldData.mouse_x = (ux + 1) * 256; c.sim.worldData.mouse_y = (uy + 1) * 256
  c.sim.worldData.mouse_down = true; c.tick(); c.sim.worldData.mouse_down = false; c.tick()
}
const toUV = (D, x, y) => {
  const tiles = D.tilesL; let mx = 0, my = 0, ex = 1
  for (const t of tiles) { mx += t.cx; my += t.cy } mx /= tiles.length; my /= tiles.length
  for (const t of tiles) ex = Math.max(ex, Math.hypot(t.cx - mx, t.cy - my) + 1.2)
  const S = Math.min(0.12, 0.80 / ex)
  return { x: (x - mx) * S, y: (y - my) * S }
}
// the 10-rosette (9 tiles chained off edge 2 each) — hull.test.mjs's proven bay-sealer
const buildRosette = (c) => {
  c.tick(3); const d = c.d()
  for (let i = 0; i < 9; i++) d.tree.push({ parent: d.tree.length - 1, edge: 2, part: 1 })
  d.rev++; c.tick(2)
  return d
}

test('clicking a sealed shape opens the specials menu', () => {
  const c = mk(); const d = buildRosette(c)
  const bay = (d.holesL || []).find(h => h.shape !== 'gap')
  assert.ok(bay, 'the rosette sealed a shape')
  assert.equal(bay.shape, 'bay')
  const p = toUV(d, bay.x, bay.y)
  clickUV(c, p.x, p.y)
  assert.ok(d.specialsMenu, 'menu opened')
  assert.equal(d.specialsMenu.kind, 'bay')
})

test('picking an option sets the choice; picking again changes it; it persists into battle stats', () => {
  const c = mk(); const d = buildRosette(c)
  const bay = d.holesL.find(h => h.shape !== 'gap')
  const p = toUV(d, bay.x, bay.y)
  clickUV(c, p.x, p.y)                                      // open
  assert.ok(d.specialsMenu)
  const menuUV = { x: d.specialsMenu.ux, y: d.specialsMenu.uy }
  // click the SECOND option (MEND, index 1 → oy = uy + 0.10 + 1*0.09)
  clickUV(c, menuUV.x, menuUV.y + 0.10 + 1 * 0.09)
  assert.equal(d.specialsMenu, null, 'menu closes after picking')
  assert.equal(Object.values(d.shapeChoices)[0], 'mend', 'the picked option was recorded (only one sealed shape here)')
  // enter battle and confirm the unit reflects MEND (regen), not the default hangar
  c.sim.worldData.key_b = true; c.tick(); c.sim.worldData.key_b = false; c.tick(); c.tick(3)
  const u = d.bt.unit
  assert.ok(u.regenRate > 0, 'MEND wired into the battle unit')
  assert.equal(u.hangars, 0, 'default HANGAR bonus was overridden by the choice')
})

test('a click elsewhere while the menu is open closes it without picking', () => {
  const c = mk(); const d = buildRosette(c)
  const bay = d.holesL.find(h => h.shape !== 'gap')
  const p = toUV(d, bay.x, bay.y)
  clickUV(c, p.x, p.y)
  assert.ok(d.specialsMenu)
  clickUV(c, 0.9, -0.9)                                     // far corner, not a menu button
  assert.equal(d.specialsMenu, null, 'menu closed')
  assert.ok(!d.shapeChoices || !Object.keys(d.shapeChoices).length, 'no choice was recorded')
})
