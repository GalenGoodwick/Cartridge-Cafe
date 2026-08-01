const P = JSON.parse(Deno.readTextFileSync('/tmp/shipyard-parts.json'))
const fn = new Function('sim', 'dt', P.hook)
const mk = (seq) => { const t = [{ parent: -1, edge: -1, part: 1 }]; for (const e of seq) t.push({ parent: t.length - 1, edge: e, part: 1 }); return t }
const setup = (tree) => {
  const wd = { __pd: { tree, sel: 0, rev: 1, t: 0 } }
  const edges = {}
  const sim = { worldData: wd, edge(id, c) { const w = !!edges[id]; edges[id] = !!c; return !!c && !w } }
  const clickAt = (ux, uy, extra = {}) => { const px = (ux + 1) * 256, py = (uy + 1) * 256; wd.mouse_x = px; wd.mouse_y = py; Object.assign(wd, extra); wd.input = { pointer: { x: px, y: py, down: true } }; wd.mouse_down = true; fn(sim, 1/30); wd.mouse_down = false; for (const k of Object.keys(extra)) wd[k] = false; wd.input.pointer.down = false; fn(sim, 1/30) }
  fn(sim, 1/30)
  return { wd, clickAt }
}
const tileUV = (wd, i) => { const D = wd.__pd; let mx=0,my=0,ex=1; for (const t of D.tilesL){mx+=t.cx;my+=t.cy} mx/=D.tilesL.length;my/=D.tilesL.length; for (const t of D.tilesL) ex=Math.max(ex,Math.hypot(t.cx-mx,t.cy-my)+1.2); const S=Math.min(0.12,0.80/ex); const t=D.tilesL[i]; return [(t.cx-mx)*S,(t.cy-my)*S] }
// RING: delete a middle link → the loop reroutes, only 1 tile dies
{
  const { wd, clickAt } = setup(mk([2, 2, 2, 2, 2, 2, 2, 2, 2]))   // the 10-rosette
  clickAt(...tileUV(wd, 5), { key_x: true })
  console.log(wd.__pd.tree.length === 9 ? '✓ ring survives a cut (9 remain — route through the loop)' : `✗ ring collapsed (${wd.__pd.tree.length})`)
  if (wd.__pd.tree.length !== 9) Deno.exit(1)
}
// OPEN CHAIN: delete the middle → downstream truly orphaned, dies
{
  const { wd, clickAt } = setup(mk([2, 2, 2, 2]))
  clickAt(...tileUV(wd, 2), { key_x: true })
  console.log(wd.__pd.tree.length === 2 ? '✓ chain cut orphans downstream (2 remain)' : `✗ (${wd.__pd.tree.length})`)
  if (wd.__pd.tree.length !== 2) Deno.exit(1)
}
