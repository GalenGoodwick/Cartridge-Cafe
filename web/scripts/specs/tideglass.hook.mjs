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
    eq('helm: the wheel starts THE CROSSING (finale cinematic)', G(w).flyCine > 0, true)
  }

  // ── THE CROSSING: plays ~10s, holds on the Act I card, tap dismisses ──
  {
    const w = runWorld(hookCode); const g = G(w)
    g.view = 9; g.inv.gear8 = true; g.inv.gear12 = true; g.inv.gear20 = true; g.seats = [2, 3, 5]
    g.crystalPowered = 1; g.act = 0
    w.settle(); w.click(256, 120)
    for (let i = 0; i < 300; i++) w.tick()               // ~5s in
    const mid = G(w).flyCine
    eq('crossing: mid-flight, the clock is running', mid > 0.1 && mid < 1, true)
    w.click(256, 256)                                     // clicks pass like wind mid-flight
    eq('crossing: mid-flight tap does not dismiss', G(w).flyCine > 0, true)
    eq('crossing: mid-flight tap moves no view', G(w).view, 9)
    for (let i = 0; i < 600; i++) w.tick()               // past 10s → the card holds
    eq('crossing: the card HOLDS at 1', G(w).flyCine, 1)
    w.click(256, 256)                                     // the tap on the card
    eq('card: a tap returns the deck', G(w).flyCine, 0)
    eq('card: still on the deck, act 2', G(w).view === 9 && G(w).act >= 2, true)
    w.click(256, 120)                                     // the helm again
    eq('card: the wheel ALWAYS flies — the crossing replays', G(w).flyCine > 0, true)
    eq('card: a replay does not advance the act again', G(w).act, 2)
  }

  // ── R-RESET: __fresh wipes THIS world's save branch only — and holds the door
  //    shut against the late server-restore clobber (Galen, Jul 31) ──
  {
    const w = runWorld(hookCode); const g = G(w)
    g.act = 2; g.view = 9; g.inv.spanner = true; g.t = 900   // an old run: deep clock
    w.wd.save.other = { keep: 1 }                            // a NEIGHBOUR save branch
    w.wd.__fresh = true
    w.tick()
    eq('reset: __fresh → the old run is wiped (view back to shore)', G(w).view, 0)
    eq('reset: __fresh → act back to 1', G(w).act, 1)
    eq('reset: __fresh → inventory empty', G(w).inv.spanner, false)
    eq('reset: only tideglass is wiped — the neighbour save survives', w.wd.save.other.keep, 1)
    // the server restore lands ~1s later and re-injects the OLD run
    for (let i = 0; i < 60; i++) w.tick()
    w.wd.save.tg = { v: 2, view: 9, t: 900, act: 2, fade: 0 }
    w.tick(); w.tick()
    eq('reset: a restored old run inside the window is wiped too', G(w).view, 0)
    // fresh progress made inside the window SURVIVES (its clock is young)
    w.settle(); w.click(487, 256)                            // shore → gate
    for (let i = 0; i < 120; i++) w.tick()
    eq('reset: fresh progress inside the window survives', G(w).view, 1)
    for (let i = 0; i < 800; i++) w.tick()                   // ride past the 12s window
    eq('reset: the fresh run STILL stands once the window closes', G(w).view, 1)
    eq('reset: window closes to exactly 0 and stays (deletion would not round-trip)', w.wd.__tgWipe, 0)
  }
  {
    const w = runWorld(hookCode); const g = G(w)
    g.act = 2; g.view = 9; g.t = 900                          // NO __fresh: a normal session
    for (let i = 0; i < 30; i++) w.tick()
    eq('no reset: a normal session never wipes the save', G(w).view, 9)
  }
  // ── SNAPSHOT POLLUTION (the "random resets", Jul 31): a live capture leaked
  //    __tgWipe/__tgFreshSeen/__fresh into the world snapshot, so every player
  //    inherited an open wipe window + a pre-set latch. The hook must shrug both off. ──
  {
    const w = runWorld(hookCode); const g = G(w)
    g.act = 2; g.view = 9; g.t = 900
    w.wd.__tgWipe = 0.0013; w.wd.__tgFreshSeen = 1            // inherited poison, NO __fresh
    for (let i = 0; i < 30; i++) w.tick()
    eq('pollution: an inherited stale window never wipes a veteran save', G(w).view, 9)
    eq('pollution: the stale latch is cleared by a normal session', w.wd.__tgFreshSeen, 0)
    w.wd.__fresh = true                                        // ...so the NEXT legit R still lands
    w.tick()
    eq('pollution: R after a poisoned load still resets', G(w).view, 0)
  }
  {
    const w = runWorld(hookCode); const g = G(w)
    g.view = 9; g.t = 900
    w.wd.__fresh = true; w.tick()                              // reset session: window armed
    for (let i = 0; i < 800; i++) w.tick()                     // ride past the 12s window
    eq('window: decays to exactly 0 and STAYS (a deletion would not round-trip)', w.wd.__tgWipe, 0)
  }

  // ── GRANDFATHER: a save that flew Act I before the pearl-beam existed keeps
  //    its power — the wheel it earned still turns (Galen: HELM CLICK) ──
  {
    const w = runWorld(hookCode); const g = G(w)
    g.act = 2; g.crystalPowered = 0; g.view = 9
    g.inv.gear8 = true; g.inv.gear12 = true; g.inv.gear20 = true; g.seats = [2, 3, 5]
    w.settle()
    eq('grandfather: act 2 + dark crystal → power restored', G(w).crystalPowered, 1)
    w.click(256, 120)
    eq('grandfather: the earned wheel FLIES', G(w).flyCine > 0, true)
  }
  {
    const w = runWorld(hookCode); const g = G(w)
    g.act = 1; g.crystalPowered = 0
    w.settle()
    eq('grandfather: a FRESH run stays gated on the pearl chain', G(w).crystalPowered, 0)
  }

  // ── NEW CHEVRONS: the two hidden diegetic doors get nav rows ──
  {
    const w = runWorld(hookCode); const g = G(w)
    g.view = 0; g.dawn = 1
    w.settle(); w.click(108, 128)
    eq('chevron: shore + dawn → board the airship (view 9)', G(w).view, 9)
  }
  {
    const w = runWorld(hookCode); const g = G(w)
    g.view = 0; g.dawn = 0
    w.settle(); w.click(108, 128)
    eq('chevron: no dawn, no airship — the shore holds', G(w).view, 0)
  }
  {
    const w = runWorld(hookCode); const g = G(w)
    g.view = 1; g.dials = [1, 3, 0, 2]; g.notch = 1   // the REAL combo-B state (gate2 is derived per-tick)
    w.settle(); w.click(256, 210)
    eq('chevron: gate + combo set → down into the drowned quarter (view 13)', G(w).view, 13)
  }
  {
    const w = runWorld(hookCode); const g = G(w)
    g.view = 1; g.gate2 = false
    w.settle(); w.click(256, 210)
    eq('chevron: combo unset → the doorway does not open', G(w).view === 13, false)
  }
}
