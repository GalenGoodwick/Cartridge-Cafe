// energy2.mjs — PENTARCH power grid: generation → batteries → consumers, with
// the brownout rule. Render-free; consumed by battle (per-tick) and the
// designer (power-budget readout). DESIGN-ship-systems.md §3.
//
// The design axis this creates: batteries buffer BURSTS (alpha strikes beyond
// generation), but sustained deficit browns the ship out — weapons at half
// rate, thrusters at 70%. Glass cannon = big weapons + small gen + big banks.

/** gridOf(tiles) — pull the power grid from a laid-out ship.
 *  Part fields: gen (P/s), batCap, batRate (max charge/discharge P/s). */
export function gridOf(tiles) {
  let gen = 0, batCap = 0, batRate = 0
  for (const t of tiles) {
    const p = t.part
    if (!p) continue
    gen += p.gen || 0
    batCap += p.batCap || 0
    batRate += p.batRate || 0
  }
  return { gen, batCap, batRate }
}

/** newBank(grid) — battery state, boots full (ships launch charged). */
export const newBank = (grid) => ({ charge: grid.batCap })

export const BROWNOUT_ENTER = 0.02   // bank fraction below which brownout latches
export const BROWNOUT_EXIT = 0.25    // …and the recovery fraction that clears it
// hysteresis: without it the ship strobes in/out of brownout every tick at the
// boundary (the classic flicker); enter low, exit only after real recovery.

/** tick(grid, bank, demand, dt) — one power tick.
 *  demand: P/s requested by consumers this tick (weapons + thrusters).
 *  Returns { supplied (0..1 fraction of demand met), brownout } and mutates bank.
 *  Order: gen covers demand first; shortfall draws the bank (≤ batRate);
 *  surplus charges the bank (≤ batRate). */
export function tick(grid, bank, demand, dt) {
  const genE = grid.gen * dt
  const needE = Math.max(0, demand) * dt
  let supplied = 0
  if (needE <= genE) {
    supplied = 1
    // surplus charges the bank, rate-limited
    const room = grid.batCap - bank.charge
    bank.charge += Math.min(room, Math.min(genE - needE, grid.batRate * dt))
  } else {
    const short = needE - genE
    const draw = Math.min(short, grid.batRate * dt, bank.charge)
    bank.charge -= draw
    supplied = needE > 0 ? (genE + draw) / needE : 1
  }
  // brownout latch with hysteresis on bank fraction (or no storage at all)
  const frac = grid.batCap > 0 ? bank.charge / grid.batCap : 0
  if (bank.brown) { if (frac >= BROWNOUT_EXIT) bank.brown = false }
  else if (supplied < 1 - 1e-9 && frac <= BROWNOUT_ENTER) bank.brown = true
  return { supplied, brownout: !!bank.brown }
}

/** brownout multipliers — the whole rule in one place */
export const BROWN_GUN = 0.5     // weapons fire at half rate
export const BROWN_THRUST = 0.7  // thrusters at 70%

/** budget(tiles, consumers) — the DESIGNER readout: can this ship sustain its
 *  own appetite? consumers: [{name, drain}] steady-state P/s.
 *  → { gen, drain, margin, burstSeconds } — burstSeconds = how long full
 *  appetite runs on batteries alone once gen is exceeded (Infinity if gen covers). */
export function budget(tiles, consumers) {
  const grid = gridOf(tiles)
  const drain = consumers.reduce((a, c) => a + (c.drain || 0), 0)
  const margin = grid.gen - drain
  // time until the bank empties at the actual draw rate (rate-capped); if the
  // rate can't even cover the shortfall the ship browns out DURING the burst —
  // fullBurst says whether the burst runs at full power
  const short = Math.max(0, -margin)
  const draw = Math.min(short, grid.batRate)
  const burstSeconds = short === 0 ? Infinity : (draw > 0 ? grid.batCap / draw : 0)
  return { gen: grid.gen, drain, margin, burstSeconds, fullBurst: short === 0 || grid.batRate >= short }
}
