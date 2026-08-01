const P = JSON.parse(Deno.readTextFileSync('/tmp/shipyard-parts.json'))
const fn = new Function('sim', 'dt', P.hook)
const wd = {}; const edges = {}
const sim = { worldData: wd, edge(id, c) { const was = !!edges[id]; edges[id] = !!c; return !!c && !was } }
const tick = (ux, uy, down) => { const mx = (ux + 1) * 256, my = (uy + 1) * 256; wd.mouse_x = mx; wd.mouse_y = my; wd.mouse_down = down; wd.input = { pointer: { x: mx, y: my, down } }; fn(sim, 1 / 30) }
const clicks = []
const click = (ux, uy) => { tick(ux, uy, false); tick(ux, uy, true); tick(ux, uy, false); clicks.push([+ux.toFixed(3), +uy.toFixed(3)]) }
tick(0, 0, false)
// grow 5 tiles: each time, aim at the FIRST legal ghost's current uv position
const AP = 1 / (2 * Math.tan(Math.PI / 5))
for (let n = 0; n < 5; n++) {
  const D = wd.__pd
  const tiles = D.tilesL, ghosts = D.ghostsL
  let mx = 0, my = 0, ex = 1
  for (const t of tiles) { mx += t.cx; my += t.cy } mx /= tiles.length; my /= tiles.length
  for (const t of tiles) ex = Math.max(ex, Math.hypot(t.cx - mx, t.cy - my) + 1.2)
  const S = Math.min(0.17, 0.78 / ex)
  const g = ghosts[n % ghosts.length].g
  click((g.cx - mx) * S, (g.cy - my) * S)
  // set a part on the fresh tile
  const parts = [0, 2, 3, 4, 4]   // ARMOR, GUN, ENGINE, ENGINE (idx into palette 0..4)
  if (n > 0) click(-0.52 + parts[n] * 0.26, 0.86)
}
console.log('final: tiles', wd.__pd.tree.length, 'parts', wd.__pd.tree.map(t => t.part), 'voids', wd.__pd.voidsL.length)
Deno.writeTextFileSync('/tmp/yard-clicks.json', JSON.stringify(clicks))
console.log('clicks scripted:', clicks.length)
