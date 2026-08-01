const P = JSON.parse(Deno.readTextFileSync('/tmp/shipyard-parts.json'))
const fn = new Function('sim', 'dt', P.hook)
const run = (seq) => {
  const tree = [{ parent: -1, edge: -1, part: 1 }]
  for (const e of seq) tree.push({ parent: tree.length - 1, edge: e, part: 1 })
  const wd = { __pd: { tree, sel: 0, rev: 1, t: 0 }, mouse_x: 256, mouse_y: 256, input: { pointer: { x: 256, y: 256, down: false } } }
  const edges = {}
  fn({ worldData: wd, edge(id, c) { const was = !!edges[id]; edges[id] = !!c; return !!c && !was } }, 1 / 30)
  return wd.__pd
}
// almost-diamond (one tile short): its 2 pinch wedges must merge to ONE
const d = run([2, 2, 1, 2])
console.log('almost-diamond (point-sealed): holes', (d.holesL || []).length, '| pinches', (d.voidsL || []).length, ((d.holesL || []).length === 1 && (d.voidsL || []).length === 0) ? '✓ vertex-closure encloses' : '✗')
// sealed diamond: 1 VOID (the hole), pinches 0 (absorbed)
const s = run([2, 2, 1, 2, 2])
console.log('sealed diamond: holes', s.holesL.length, '| pinches', (s.voidsL || []).length, (s.holesL.length === 1 && (s.voidsL || []).length === 0) ? '✓ one void, absorbed' : '✗')
if ((d.holesL || []).length !== 1 || s.holesL.length !== 1 || (s.voidsL || []).length !== 0) Deno.exit(1)

// WHERE are the sealed-diamond pinches? (are they hole corners, or real outer notches?)
const s2 = run([2, 2, 1, 2, 2])
const hh = s2.holesL[0]
for (const v of s2.voidsL || []) {
  console.log(`pinch at (${v.x.toFixed(2)}, ${v.y.toFixed(2)}) — dist from hole centroid ${(Math.hypot(v.x - hh.x, v.y - hh.y)).toFixed(2)} (hole extent r=${hh.r.toFixed(2)})`)
}
