// energy2.test — the power-grid laws: gen covers, banks buffer bursts,
// brownout latches with hysteresis (no strobing), budget readout is honest.
// Run: node --test pentarch/test/energy2.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gridOf, newBank, tick, budget, BROWNOUT_EXIT } from '../energy2.mjs'

const t = (part) => ({ cx: 0, cy: 0, th: 0, part })
const GEN = { gen: 10 }
const BAT = { batCap: 20, batRate: 15 }

test('gridOf sums gen and battery stats across tiles', () => {
  const g = gridOf([t(GEN), t(GEN), t(BAT), t(null)])
  assert.deepEqual(g, { gen: 20, batCap: 20, batRate: 15 })
})

test('demand under generation: fully supplied, surplus charges the bank', () => {
  const g = gridOf([t(GEN), t(BAT)])
  const bank = newBank(g); bank.charge = 0   // start empty to watch it charge
  const r = tick(g, bank, 4, 1)              // demand 4 < gen 10
  assert.equal(r.supplied, 1)
  assert.ok(bank.charge > 5.9 && bank.charge <= 6.01, `surplus 6 charged, got ${bank.charge}`)
})

test('burst beyond generation: the bank covers it (alpha strike works)', () => {
  const g = gridOf([t(GEN), t(BAT)])
  const bank = newBank(g)                    // full: 20
  const r = tick(g, bank, 22, 1)             // demand 22, gen 10 → bank pays 12
  assert.equal(r.supplied, 1)
  assert.ok(Math.abs(bank.charge - 8) < 1e-9, `bank 20-12=8, got ${bank.charge}`)
  assert.equal(r.brownout, false)
})

test('sustained deficit drains the bank then browns out; recovery clears it (hysteresis)', () => {
  const g = gridOf([t(GEN), t(BAT)])
  const bank = newBank(g)
  let browned = false
  for (let i = 0; i < 60; i++) { if (tick(g, bank, 25, 0.5).brownout) { browned = true; break } }
  assert.ok(browned, 'sustained 25 P/s vs 10 gen must eventually brown out')
  // still browned at the edge of recovery…
  while (bank.charge < BROWNOUT_EXIT * g.batCap) tick(g, bank, 0, 0.1)
  const r = tick(g, bank, 0, 0.1)
  assert.equal(r.brownout, false, 'clears only after real recovery')
})

test('no strobing: one tick above the enter line does not clear brownout', () => {
  const g = gridOf([t(GEN), t(BAT)])
  const bank = newBank(g); bank.charge = 0; bank.brown = true
  const r = tick(g, bank, 0, 0.05)   // recovers a hair — far below EXIT
  assert.equal(r.brownout, true)
})

test('bank discharge is rate-limited: a huge burst cannot all come out at once', () => {
  const g = gridOf([t(GEN), { cx: 0, cy: 0, th: 0, part: { batCap: 100, batRate: 5 } }])
  const bank = newBank(g)
  const r = tick(g, bank, 40, 1)     // gen 10 + rate-capped 5 = 15 of 40
  assert.ok(Math.abs(r.supplied - 15 / 40) < 1e-9, `supplied ${r.supplied}`)
})

test('budget: covered appetite → infinite burst; deficit → honest countdown', () => {
  const ship = [t(GEN), t(BAT)]
  const ok = budget(ship, [{ name: 'gun', drain: 6 }])
  assert.equal(ok.burstSeconds, Infinity)
  assert.equal(ok.margin, 4)
  const hot = budget(ship, [{ name: 'lance', drain: 20 }])
  assert.ok(Math.abs(hot.burstSeconds - 2) < 1e-9, `20 cap / 10 short = 2s, got ${hot.burstSeconds}`)
  assert.equal(hot.fullBurst, true)
  const starved = budget([t(GEN), { cx: 0, cy: 0, th: 0, part: { batCap: 100, batRate: 3 } }], [{ name: 'lance', drain: 20 }])
  assert.equal(starved.fullBurst, false, 'rate below shortfall = browns out mid-burst')
})

test('no batteries at all: deficit means instant brownout territory', () => {
  const g = gridOf([t(GEN)])
  const bank = newBank(g)
  const r = tick(g, bank, 15, 1)
  assert.ok(r.supplied < 1)
  assert.equal(r.brownout, true, 'nothing buffers — brownout is immediate')
})
