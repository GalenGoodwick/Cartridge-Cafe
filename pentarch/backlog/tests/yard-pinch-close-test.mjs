// FIND a point-to-point enclosure (vertex-touch closure, no edge re-touch)
// by searching branched designs, then assert the hook detects its hole.
const P = JSON.parse(Deno.readTextFileSync('/tmp/shipyard-parts.json'))
const fn = new Function('sim', 'dt', P.hook)
const AP = 1 / (2 * Math.tan(Math.PI / 5)), CR = 1 / (2 * Math.sin(Math.PI / 5)), ST = 2 * Math.PI / 5
const ena = (t, e) => t.th + Math.PI / 2 + (e + 0.5) * ST
const attach = (t, e) => { const n = ena(t, e); return { cx: t.cx + 2 * AP * Math.cos(n), cy: t.cy + 2 * AP * Math.sin(n), th: n + Math.PI / 2 - Math.PI / 5 } }
const verts = (t) => { const o = []; for (let k = 0; k < 5; k++) { const a = t.th + Math.PI / 2 + k * ST; o.push({ x: t.cx + CR * Math.cos(a), y: t.cy + CR * Math.sin(a) }) } return o }
const runHook = (tree) => {
  const wd = { __pd: { tree, sel: 0, rev: 1, t: 0 }, mouse_x: 256, mouse_y: 256, input: { pointer: { x: 256, y: 256, down: false } } }
  const edges = {}
  fn({ worldData: wd, edge(id, c) { const w = !!edges[id]; edges[id] = !!c; return !!c && !w } }, 1 / 30)
  return wd.__pd
}
// deterministic scan of two-armed designs off one base: arm A then arm B
let foundCase = null
outer:
for (const a1 of [1, 2, 3]) for (const a2 of [1, 2, 3]) for (const b1 of [2, 3, 4]) for (const b2 of [1, 2, 3]) for (const b3 of [1, 2, 3]) {
  const tree = [{ parent: -1, edge: -1, part: 1 },
    { parent: 0, edge: 1, part: 1 }, { parent: 1, edge: a1, part: 1 }, { parent: 2, edge: a2, part: 1 },
    { parent: 0, edge: 3, part: 1 }, { parent: 4, edge: b1, part: 1 }, { parent: 5, edge: b2, part: 1 }, { parent: 6, edge: b3, part: 1 }]
  const D = runHook(tree)
  if (!D || !D.tilesL || D.tilesL.length !== 8) continue
  // does a vertex of the LAST tile coincide with a vertex of arm A's tip, with NO edge contact between them?
  const tA = D.tilesL[3], tB = D.tilesL[7]
  let vTouch = false
  for (const va of verts(tA)) for (const vb of verts(tB)) if (Math.hypot(va.x - vb.x, va.y - vb.y) < 1e-3) vTouch = true
  let eTouch = false
  for (let ei = 0; ei < 5; ei++) for (let ej = 0; ej < 5; ej++) {
    const na = ena(tA, ei), nb = ena(tB, ej)
    const ma = { x: tA.cx + AP * Math.cos(na), y: tA.cy + AP * Math.sin(na) }, mb = { x: tB.cx + AP * Math.cos(nb), y: tB.cy + AP * Math.sin(nb) }
    if (Math.hypot(ma.x - mb.x, ma.y - mb.y) < 1e-3) eTouch = true
  }
  if (vTouch && !eTouch && (D.holesL || []).length >= 1) { foundCase = { arms: [a1, a2, b1, b2, b3], holes: D.holesL.map(x => x.shape) }; break outer }
}
if (foundCase) console.log(`✓ point-to-point enclosure DETECTED: arms [${foundCase.arms}] → holes [${foundCase.holes}]`)
else { console.log('✗ no vertex-closure hole detected across the scan'); Deno.exit(1) }
