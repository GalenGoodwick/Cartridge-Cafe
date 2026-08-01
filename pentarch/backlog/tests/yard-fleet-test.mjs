const P = JSON.parse(Deno.readTextFileSync('/tmp/shipyard-parts.json'))
const fn = new Function('sim', 'dt', P.hook)
const tree = [{ parent: -1, edge: -1, part: 1 }, { parent: 0, edge: 2, part: 3 }]
const wd = { __pd: { tree, sel: 0, rev: 1, t: 0 }, mouse_x: 256, mouse_y: 256, input: { pointer: { x: 256, y: 256, down: false } } }
const edges = {}
const sim = { worldData: wd, edge(id, c) { const w = !!edges[id]; edges[id] = !!c; return !!c && !w } }
const key = (k) => { wd['key_' + k] = true; fn(sim, 1/30); wd['key_' + k] = false; fn(sim, 1/30) }
fn(sim, 1/30)
key('2'); key('s')
console.log(wd.fleet[2] && wd.fleet[2].tree.length === 2 && wd.fleet[2].cost === 40 ? '✓ saved to berth 2 (cost 40)' : '✗ save failed')
wd.__pd.tree = [{ parent: -1, edge: -1, part: 1 }]; wd.__pd.rev++      // wreck the design
fn(sim, 1/30)
key('l')
console.log(wd.__pd.tree.length === 2 && wd.__pd.tree[1].part === 3 ? '✓ loaded back (gun intact)' : '✗ load failed')
if (!wd.fleet[2] || wd.__pd.tree.length !== 2) Deno.exit(1)
