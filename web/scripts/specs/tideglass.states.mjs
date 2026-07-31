// tideglass.states — forced render states for scripts/render-local.mjs. Each is
// (save) => void, where `save` is the hook's persisted save root; tideglass keeps
// its game state at save.tg. The hook then packs the whiteboard uniforms.
//   node scripts/render-local.mjs --slug tideglass --setup scripts/specs/tideglass.states.mjs --state kiln-bloom
const at = fn => save => { const G = save.tg; if (G) fn(G) }
export default {
  'kiln-bloom': at(G => { G.view = 14; G.kilnBloom = 1 }),
  'kiln-seed': at(G => { G.view = 14; G.kilnBloom = 0 }),
  'engine': at(G => { G.view = 10; G.inv.gear8 = true; G.inv.gear12 = true; G.inv.gear16 = true; G.seats = [2, 4, 3] }),
  'deck': at(G => { G.view = 9; G.inv.spanner = true }),
  'deck-flight': at(G => { G.view = 9; G.inv.spanner = true; G.engineOK = 1; G.act = 2; G.fly = 1 }),
  'mirror': at(G => { G.view = 11; G.inv.gear20 = true }),
  'shore': at(G => { G.view = 0 }),
  'drowned-flooded': at(G => { G.view = 13; G.tideLevel = 0.65 }),
  'drowned-drained': at(G => { G.view = 13; G.inv.gear20 = true; G.sluiceOpen = 1; G.tideLevel = 0.05 }),
  'drowned-pearl': at(G => { G.view = 13; G.inv.gear20 = true; G.sluiceOpen = 1; G.tideLevel = 0.05; G.bellRung = 1 }),
  'mirror-valve-open': at(G => { G.view = 11; G.inv.gear20 = true; G.sluiceOpen = 1; G.tideLevel = 0.05 }),
  'shore-lowtide': at(G => { G.view = 0; G.inv.gear20 = true; G.sluiceOpen = 1; G.tideLevel = 0.05 }),
  'deck-hatch': at(G => { G.view = 9; G.inv.spanner = true; G.held = 1 }),
}
