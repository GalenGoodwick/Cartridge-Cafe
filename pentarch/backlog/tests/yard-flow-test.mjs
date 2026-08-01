const P = JSON.parse(Deno.readTextFileSync('/tmp/shipyard-parts.json'))
const fn = new Function('sim', 'dt', P.hook)
const mkSim = (wd) => { const edges = {}; return { worldData: wd, rand: Math.random, edge(id, c) { const w = !!edges[id]; edges[id] = !!c; return !!c && !w } } }
// LOCAL: battle pad → finder → click room → __joinRoom + design carried
{
  const wd = { __pd: { tree: [{ parent: -1, edge: -1, part: 1 }, { parent: 0, edge: 2, part: 3 }], sel: 0, rev: 1, t: 0 }, __lobby: { rooms: [{ room: 'alpha', players: 1, capacity: 6, started: false }] } }
  const sim = mkSim(wd)
  const click = (ux, uy) => { wd.mouse_x = (ux + 1) * 256; wd.mouse_y = (uy + 1) * 256; wd.input = { pointer: { x: wd.mouse_x, y: wd.mouse_y, down: true } }; wd.mouse_down = true; fn(sim, 1/30); wd.mouse_down = false; wd.input.pointer.down = false; fn(sim, 1/30) }
  fn(sim, 1/30)
  click(0.8, -0.85)
  console.log(wd.__pd.screen === 'finder' ? '✓ battle pad opens finder' : '✗ finder')
  click(0, -0.45)
  console.log(wd.__joinRoom === 'alpha' && typeof wd.__sendDesign === 'string' ? '✓ click joins alpha + carries design' : '✗ join')
}
// ROOM: war room seats + host start + battle ships from design
{
  const design = JSON.stringify([{ parent: -1, edge: -1, part: 1 }, { parent: 0, edge: 2, part: 4 }, { parent: 1, edge: 2, part: 3 }])
  const wd = { players: [{ seat: 0, mouse_x: 256, mouse_y: 256, mouse_down: false, design }, { seat: 1, mouse_x: 300, mouse_y: 300, design }] }
  const sim = mkSim(wd)
  fn(sim, 1/30)
  const hudTxt = wd.hud.map(x => x.text).join(' | ')
  console.log(hudTxt.includes('WAR ROOM') && hudTxt.includes('hull ready (3 tiles)') && hudTxt.includes('★HOST') ? '✓ war room seats + readiness + host' : '✗ war room')
  // host clicks START (center zone y≈0.55)
  wd.players[0].mouse_x = 256; wd.players[0].mouse_y = (0.55 + 1) * 256; wd.players[0].mouse_down = true
  fn(sim, 1/30)
  console.log(wd.__started ? '✓ host START ignites battle' : '✗ start')
  wd.players[0].mouse_down = false
  fn(sim, 1/30); fn(sim, 1/30)
  const ships = Object.values(wd.__pw.ships)
  console.log(ships.length === 2 && ships[0].tiles.length === 3 ? '✓ designed hulls sail (3 tiles each)' : `✗ ships ${ships.length} tiles ${ships[0] && ships[0].tiles.length}`)
  if (!wd.__started || ships.length !== 2) Deno.exit(1)
}
