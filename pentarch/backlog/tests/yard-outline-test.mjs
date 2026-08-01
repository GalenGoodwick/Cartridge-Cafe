const P = JSON.parse(Deno.readTextFileSync('/tmp/shipyard-parts.json'))
const fn = new Function('sim', 'dt', P.hook)
const tree = [{ parent: -1, edge: -1, part: 1 }]
for (const e of [2, 2, 1, 2, 2]) tree.push({ parent: tree.length - 1, edge: e, part: 1 })
const wd = { __pd: { tree, sel: 0, rev: 1, t: 0 }, mouse_x: 256, mouse_y: 256, input: { pointer: { x: 256, y: 256, down: false } } }
const edges = {}
fn({ worldData: wd, edge(id, c) { const w = !!edges[id]; edges[id] = !!c; return !!c && !w } }, 1 / 30)
const pop = wd.gpuPopulation
let outlines = 0, hasLen = true
for (let i = 0; i < pop.length; i += 4) { const w = pop[i + 3]; if (w >= 76 && w < 81) { outlines++; if (w % 1 <= 0) hasLen = false } }
const nv = wd.__pd.holesL[0].poly.length
console.log(`diamond outline segments: ${outlines} (poly has ${nv} verts) ${outlines === nv && hasLen ? '✓ true shape published' : '✗'}`)
if (outlines !== nv || !hasLen) Deno.exit(1)
