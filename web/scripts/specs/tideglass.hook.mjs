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
}
