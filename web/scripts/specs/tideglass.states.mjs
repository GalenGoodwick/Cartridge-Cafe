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
  'cave-carry': at(G => { G.view = 8; G.pearl = 1; G.pearlSet = 0 }),         // carrying the pearl, socket empty
  'cave-powered': at(G => { G.view = 8; G.pearl = 1; G.pearlSet = 1; G.crystalPowered = 1 }),  // seated → beam fires
  'cave-night': at(G => { G.view = 8; G.pearl = 1; G.pearlSet = 1 }),        // check the moon in the mouth
  'shore-crystal-off': at(G => { G.view = 0; G.dawn = 1; G.crystalPowered = 0 }),  // airship in sky, keel crystal dark
  'shore-crystal-on': at(G => { G.view = 0; G.dawn = 1; G.crystalPowered = 1 }),   // beam lit → crystal glows
  'deck-live': at(G => { G.view = 9; G.inv.gear8 = true; G.inv.gear12 = true; G.inv.gear20 = true; G.seats = [2, 3, 5]; G.crystalPowered = 1 }),  // helm takeable
  'deck-nopower': at(G => { G.view = 9; G.inv.gear8 = true; G.inv.gear12 = true; G.inv.gear20 = true; G.seats = [2, 3, 5]; G.crystalPowered = 0 }),  // gears in, crystal dark
  'sluice-moon': at(G => { G.view = 11; G.inv.gear20 = true }),
  'shore-owngear': at(G => { G.view = 0; G.inv.gear16 = true; G.inv.gear8 = true }),
  'satchel-pearl': at(G => { G.view = 0; G.dawn = 1; G.inv.gear8 = true; G.inv.gear12 = true; G.inv.gear20 = true; G.pearl = 1; G.pearlSet = 0 }),
}
