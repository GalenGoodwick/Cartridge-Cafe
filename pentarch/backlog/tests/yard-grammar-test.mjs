// The hook must recognize the SAME shapes the exhaustive hunt proved.
const P = JSON.parse(Deno.readTextFileSync('/tmp/shipyard-parts.json'))
const fn = new Function('sim', 'dt', P.hook)
const SEQS = {
  diamond: [2, 2, 1, 2, 2],
  moon:    [2, 2, 1, 3, 2, 2, 2, 1, 3],
  star:    [2, 2, 1, 3, 1, 3, 2, 1, 3],
  bay:     [2, 2, 1, 3, 1, 3, 1],
}
let pass = 0, fail = 0
for (const [want, seq] of Object.entries(SEQS)) {
  const tree = [{ parent: -1, edge: -1, part: 1 }]
  for (const e of seq) tree.push({ parent: tree.length - 1, edge: e, part: 1 })
  const wd = { __pd: { tree, sel: 0, rev: 1, t: 0 } }
  const edges = {}
  const sim = { worldData: wd, edge(id, c) { const was = !!edges[id]; edges[id] = !!c; return !!c && !was } }
  wd.mouse_x = 256; wd.mouse_y = 256; wd.mouse_down = false; wd.input = { pointer: { x: 256, y: 256, down: false } }
  fn(sim, 1 / 30)
  const got = (wd.__pd.holesL || []).map(h => h.shape)
  const ok = got.includes(want)
  if (ok) pass++; else fail++
  console.log(`${ok ? '✓' : '✗'} seq[${seq.join(',')}] → holes [${got.join(',') || 'none'}] (want ${want})  sealed-fanfare: ${wd.__play_sound ? 'yes' : 'no'}`)
}
console.log(`\n${pass}/${pass + fail} shapes recognized by the live hook`)
if (fail) Deno.exit(1)
