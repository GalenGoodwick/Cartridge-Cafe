const P = JSON.parse(Deno.readTextFileSync('/tmp/shipyard-parts.json'))
const fn = new Function('sim', 'dt', P.hook)
const tree = [{ parent: -1, edge: -1, part: 1 }]
for (const e of [2, 2, 1, 2, 2]) tree.push({ parent: tree.length - 1, edge: e, part: 1 })
const wd = { __pd: { tree, sel: 0, rev: 1, t: 0 } }
const edges = {}
const sim = { worldData: wd, edge(id, c) { const was = !!edges[id]; edges[id] = !!c; return !!c && !was } }
const tick = (down, extra = {}) => { wd.mouse_x = 256; wd.mouse_y = 256; wd.mouse_down = down; wd.input = { pointer: { x: 256, y: 256, down } }; Object.assign(wd, extra); fn(sim, 1 / 30) }
tick(false)
console.log('sealed diamond:', wd.__pd.holesL.map(h => h.shape), '| flash:', wd.__pd.flash > 0)
// ctrl-click the LAST tile (find its uv, click there with key_control)
const D = wd.__pd
let mx = 0, my = 0, ex = 1
for (const t of D.tilesL) { mx += t.cx; my += t.cy } mx /= D.tilesL.length; my /= D.tilesL.length
for (const t of D.tilesL) ex = Math.max(ex, Math.hypot(t.cx - mx, t.cy - my) + 1.2)
const S = Math.min(0.12, 0.80 / ex)
const last = D.tilesL[D.tilesL.length - 1]
const ux = (last.cx - mx) * S, uy = (last.cy - my) * S
const px = (ux + 1) * 256, py = (uy + 1) * 256
wd.mouse_x = px; wd.mouse_y = py; wd.input = { pointer: { x: px, y: py, down: true } }; wd.mouse_down = true; wd.key_control = true
fn(sim, 1 / 30)
wd.mouse_down = false; wd.key_control = false; wd.input.pointer.down = false
fn(sim, 1 / 30)
console.log('after ctrl-click delete: tiles', wd.__pd.tree.length, '| holes now:', (wd.__pd.holesL || []).map(h => h.shape).join(',') || 'NONE (re-opened ✓)', '| sealed:', JSON.stringify(wd.__pd.sealed))
if (wd.__pd.tree.length !== 5 || (wd.__pd.holesL || []).length !== 0) Deno.exit(1)
console.log('delete-reopens: PASS')
