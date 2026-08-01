const P = JSON.parse(Deno.readTextFileSync('/tmp/shipyard-parts.json'))
const fn = new Function('sim', 'dt', P.hook)
const run = (parts, seq) => {
  const tree = [{ parent: -1, edge: -1, part: parts[0] }]
  seq.forEach((e, i) => tree.push({ parent: tree.length - 1, edge: e, part: parts[i + 1] ?? 1 }))
  const wd = { __pd: { tree, sel: 0, rev: 1, t: 0 }, mouse_x: 256, mouse_y: 256, input: { pointer: { x: 256, y: 256, down: false } } }
  const edges = {}
  fn({ worldData: wd, edge(id, c) { const w = !!edges[id]; edges[id] = !!c; return !!c && !w } }, 1 / 30)
  return wd.hud.map(x => x.text).join(' | ')
}
// sealed diamond of 6 hulls → +15% HP visible
const a = run([1, 1, 1, 1, 1, 1], [2, 2, 1, 2, 2])
console.log(a.includes('+15%') ? '✓ diamond pays +15% HP' : '✗ no diamond bonus', '|', a.match(/MASS [^·]+· SPD [^·]+· HP \S+ \S*/)?.[0] || '')
// two guns, no gen → brownout warning + halved dps
const b = run([1, 3, 3], [2, 2])
console.log(b.includes('BROWNOUT') && b.includes('DPS 6') ? '✓ brownout halves guns' : '✗ brownout wrong', '|', b.match(/DPS \d+ · PWR \S+/)?.[0])
if (!a.includes('+15%') || !b.includes('BROWNOUT')) Deno.exit(1)
