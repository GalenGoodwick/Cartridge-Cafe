const P = JSON.parse(Deno.readTextFileSync('/tmp/shipyard-parts.json'))
const fn = new Function('sim', 'dt', P.hook)
const tree = [{ parent: -1, edge: -1, part: 1 }, { parent: 0, edge: 2, part: 1 }]
const wd = { __pd: { tree, sel: 0, rev: 1, t: 0 } }
const edges = {}
const sim = { worldData: wd, edge(id, c) { const w = !!edges[id]; edges[id] = !!c; return !!c && !w } }
const clickAt = (ux, uy) => { const px = (ux + 1) * 256, py = (uy + 1) * 256; wd.mouse_x = px; wd.mouse_y = py; wd.input = { pointer: { x: px, y: py, down: true } }; wd.mouse_down = true; fn(sim, 1/30); wd.mouse_down = false; wd.input.pointer.down = false; fn(sim, 1/30) }
const tileUV = (i) => { const D = wd.__pd; let mx=0,my=0,ex=1; for (const t of D.tilesL){mx+=t.cx;my+=t.cy} mx/=D.tilesL.length;my/=D.tilesL.length; for (const t of D.tilesL) ex=Math.max(ex,Math.hypot(t.cx-mx,t.cy-my)+1.2); const S=Math.min(0.12,0.80/ex); const t=D.tilesL[i]; return [(t.cx-mx)*S,(t.cy-my)*S] }
fn(sim, 1/30)
clickAt(...tileUV(1))                      // single: selects
console.log(wd.__pd.tree.length === 2 && wd.__pd.sel === 1 ? '✓ single click selects' : '✗')
clickAt(...tileUV(1))                      // second within 0.4s: deletes
console.log(wd.__pd.tree.length === 1 ? '✓ double-click deletes' : '✗ (' + wd.__pd.tree.length + ')')
if (wd.__pd.tree.length !== 1) Deno.exit(1)
