const P = JSON.parse(Deno.readTextFileSync('/tmp/shipyard-parts.json'))
const fn = new Function('sim', 'dt', P.hook)
const tree = [{ parent: -1, edge: -1, part: 1 }, { parent: 0, edge: 2, part: 1 }]
const wd = { __pd: { tree, sel: 0, rev: 1, t: 0 } }
const edges = {}
const sim = { worldData: wd, edge(id, c) { const w = !!edges[id]; edges[id] = !!c; return !!c && !w } }
const clickAt = (ux, uy) => { const px = (ux + 1) * 256, py = (uy + 1) * 256; wd.mouse_x = px; wd.mouse_y = py; wd.input = { pointer: { x: px, y: py, down: true } }; wd.mouse_down = true; fn(sim, 1/30); wd.mouse_down = false; wd.input.pointer.down = false; fn(sim, 1/30) }
clickAt(0.78, 0.86)
console.log(wd.__pd.delMode ? '✓ toggle arms' : '✗ toggle failed')
// find tile 1 uv and click it → should DELETE
const D = wd.__pd
let mx=0,my=0,ex=1; for (const t of D.tilesL){mx+=t.cx;my+=t.cy} mx/=D.tilesL.length;my/=D.tilesL.length
for (const t of D.tilesL) ex=Math.max(ex,Math.hypot(t.cx-mx,t.cy-my)+1.2)
const S=Math.min(0.12,0.80/ex); const t1=D.tilesL[1]
clickAt((t1.cx-mx)*S,(t1.cy-my)*S)
console.log(wd.__pd.tree.length === 1 ? '✓ delMode click deletes' : '✗ delete failed (tree ' + wd.__pd.tree.length + ')')
clickAt(0.78, 0.86)
console.log(!wd.__pd.delMode ? '✓ toggle disarms' : '✗ disarm failed')
if (wd.__pd.tree.length !== 1) Deno.exit(1)
