// tideglass.hook — game-logic assertions for the tideglass step hook, run by
// scripts/hook-check.mjs against the mock-sim harness. Example + real test:
// the spanner-gated hatch, the gear-leaves-the-satchel rule (the dupe bug), the
// kiln bloom, and the thicketBurn-gated kiln passage.
//   node scripts/hook-check.mjs --slug tideglass --spec scripts/specs/tideglass.hook.mjs
export default function ({ runWorld, hookCode, asserter }) {
  const { eq } = asserter
  const G = w => w.save().tg

  // ── HATCH: descends to the engine only with the SPANNER HELD ──
  {
    const w = runWorld(hookCode); const g = G(w)
    g.view = 9; g.inv.spanner = true; g.held = 0        // owned but not held
    w.settle(); w.click(432, 256)
    eq('hatch: spanner owned but not held → stays on deck', G(w).view, 9)
  }
  {
    const w = runWorld(hookCode); const g = G(w)
    g.view = 9; g.inv.spanner = true; g.held = 1        // holding it
    w.settle(); w.click(432, 256)
    eq('hatch: spanner HELD → descends to the engine (view 10)', G(w).view, 10)
  }

  // ── GEAR leaves the satchel when seated (the dupe bug) ──
  {
    const w = runWorld(hookCode); const g = G(w)
    g.view = 10; g.inv.gear8 = true; g.held = 2; g.seats = [0, 0, 0]
    w.settle(); w.click(176, 256)
    eq('gear: seated → seat holds it', G(w).seats[0], 2)
    eq('gear: seated → hand emptied', G(w).held, 0)
    const seated = G(w).seats.indexOf(2) >= 0
    eq('gear: seated → gone from the satchel (invMask bit clear)', (g.inv.gear8 && !seated) ? 2 : 0, 0)
  }

  // ── KILN bloom + thicketBurn-gated passage ──
  {
    const w = runWorld(hookCode); const g = G(w)
    g.view = 14; g.kilnBloom = 0
    w.settle(); w.click(256, 290)
    eq('kiln: click the mouth → glass blooms', G(w).kilnBloom, 1)
  }
  {
    const w = runWorld(hookCode); const g = G(w)
    g.view = 12; g.thicketBurn = 0
    w.settle(); w.click(487, 256)
    eq('kiln passage: thicket unburned → stays in thicket', G(w).view, 12)
  }
  {
    const w = runWorld(hookCode); const g = G(w)
    g.view = 12; g.thicketBurn = 1
    w.settle(); w.click(487, 256)
    eq('kiln passage: thicket burned → walks to the kiln (view 14)', G(w).view, 14)
  }

  // ── GEARS: no gear on the shore; the cave plank yields the useful 8t; the
  //    unused 16t is gone; the pearl gets its own slot (Galen, Jul 31) ──
  {
    const w = runWorld(hookCode); const g = G(w)
    g.view = 0; g.tideLevel = 0.05; g.inv.gear8 = false
    w.settle(); w.click(140, 414)
    eq('shore: no gear pickup there anymore', G(w).inv.gear8 || false, false)
  }
  {
    const w = runWorld(hookCode); const g = G(w)
    g.view = 8; g.inv.gear8 = false
    w.settle(); w.click(150, 420)
    eq('cave plank: yields the useful 8t gear now', G(w).inv.gear8, true)
    eq('cave plank: the unused 16t is never granted', G(w).inv.gear16 || false, false)
  }

  // ── THE TIDE VALVE: the freed sluice wheel drives the tide (Galen, Jul 31) ──
  {
    const w = runWorld(hookCode); const g = G(w)
    g.view = 11; g.inv.gear20 = true; g.held = 0
    w.settle(); w.click(346, 250)
    eq('valve: freed wheel clicked → sluice OPEN', G(w).sluiceOpen, 1)
    w.click(346, 250)
    eq('valve: clicked again → sluice CLOSED', G(w).sluiceOpen, 0)
  }
  {
    const w = runWorld(hookCode); const g = G(w)
    g.inv.gear20 = true; g.sluiceOpen = 1
    for (let i = 0; i < 500; i++) w.tick()
    eq('tide: valve open → the island drains low', G(w).tideLevel < 0.2, true)
    G(w).sluiceOpen = 0
    for (let i = 0; i < 500; i++) w.tick()
    eq('tide: valve closed → the sea stands high again', G(w).tideLevel > 0.5, true)
  }
  // ── THE DROWNED BELL + PEARL: combo B's payoff needs low water ──
  {
    const w = runWorld(hookCode); const g = G(w)
    g.view = 13                                        // flooded (valve closed)
    for (let i = 0; i < 500; i++) w.tick()
    w.click(256, 316)
    eq('bell: flooded → a muffled deny, no toll', G(w).bellRung, 0)
  }
  {
    const w = runWorld(hookCode); const g = G(w)
    g.view = 13; g.inv.gear20 = true; g.sluiceOpen = 1  // drained
    for (let i = 0; i < 500; i++) w.tick()
    w.click(256, 266)
    eq('pearl: before the toll → nothing', G(w).pearl, 0)
    w.click(256, 316)
    eq('bell: drained → THE TOLL', G(w).bellRung, 1)
    w.click(256, 266)
    eq('pearl: after the toll → taken', G(w).pearl, 1)
  }

  // ── THE FINALE CHAIN: pearl → cave socket → crystal → the helm goes live ──
  {
    const w = runWorld(hookCode); const g = G(w)
    g.view = 8; g.pearl = 0
    w.settle(); w.click(256, 300)
    eq('socket: no pearl → stays empty', G(w).pearlSet, 0)
    eq('socket: no pearl → crystal stays dark', G(w).crystalPowered, 0)
  }
  {
    const w = runWorld(hookCode); const g = G(w)
    g.view = 8; g.pearl = 1                             // carrying the pearl
    w.settle(); w.click(256, 300)
    eq('socket: seat the pearl → socket set', G(w).pearlSet, 1)
    eq('socket: seat the pearl → the beam powers the crystal', G(w).crystalPowered, 1)
  }
  {
    const w = runWorld(hookCode); const g = G(w)
    // a genuinely solved engine (engineOK is recomputed each tick from the seats)
    g.view = 9; g.inv.gear8 = true; g.inv.gear12 = true; g.inv.gear20 = true; g.seats = [2, 3, 5]
    g.crystalPowered = 0; g.act = 0
    w.settle()
    eq('helm: seats [2,4,3] → engine reads OK', G(w).engineOK, 1)
    w.click(256, 120)
    eq('helm: gears in but crystal dark → the wheel will not turn', G(w).fly, 0)
    G(w).crystalPowered = 1
    w.click(256, 120)
    eq('helm: gears in AND crystal lit → take the wheel, FLY', G(w).fly, 1)
    eq('helm: flying → Act I complete (act advances)', G(w).act >= 2, true)
  }
}
