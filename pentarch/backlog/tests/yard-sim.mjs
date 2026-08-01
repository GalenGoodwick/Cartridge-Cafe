// Local truth: run the shipyard hook against a fake sim, script the exact
// clicks the playtest made, watch what the design tree does.
const P = JSON.parse(Deno.readTextFileSync('/tmp/shipyard-parts.json'))
const fn = new Function('sim', 'dt', P.hook)
const wd = {}
const edges = {}
const sim = { worldData: wd, edge(id, c) { const was = !!edges[id]; edges[id] = !!c; return !!c && !was } }
const tick = (mx, my, down) => { wd.mouse_x = mx; wd.mouse_y = my; wd.mouse_down = down; wd.input = { pointer: { x: mx, y: my, down } }; fn(sim, 1 / 30) }
const uvpx = (ux, uy) => [(ux + 1) * 256, (uy + 1) * 256]
// idle
tick(...uvpx(0.24, 0), false)
console.log('after hover: tree', wd.__pd.tree.length, '| ghosts', wd.__pd.ghostsL.length)
// click at the ghost spot
tick(...uvpx(0.24, 0), true); tick(...uvpx(0.24, 0), false)
console.log('after click1: tree', wd.__pd.tree.length, 'sel', wd.__pd.sel)
// palette GUN at (0, 0.86)
tick(...uvpx(0.0, 0.86), true); tick(...uvpx(0.0, 0.86), false)
console.log('after palette: parts', wd.__pd.tree.map(t => t.part))
// two more growth clicks
tick(...uvpx(0.42, -0.14), true); tick(...uvpx(0.42, -0.14), false)
tick(...uvpx(0.28, -0.34), true); tick(...uvpx(0.28, -0.34), false)
console.log('after grows: tree', wd.__pd.tree.length, '| voids', wd.__pd.voidsL.length, '| pop entries', wd.gpuPopulation.length / 4)
