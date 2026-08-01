// menu.test — THE MENU scene, proven by DRIVING the assembled hook (harness),
// not by asserting a string. The menu is the DISPATCH `else` fall-through, so a
// fresh world (no `wd.__scene`, no room) runs it. We tick real frames and watch
// the entity pool (wd.gpuPopulation) + wd.__scene, exactly as the engine would.
//   node --test pentarch/test/menu.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshSim, uvpx } from './harness.mjs'
import { MENU_SRC, SRC } from '../mod-menu.mjs'

// gpuPopulation is a flat [x,y,a,code, …]; regroup into entities the shader decodes.
function ents(wd) {
  const p = wd.gpuPopulation || []
  const out = []
  for (let i = 0; i + 3 < p.length; i += 4) out.push({ x: p[i], y: p[i + 1], a: p[i + 2], code: p[i + 3] })
  return out
}

// ── the export contract: build.mjs reads SRC; MENU_SRC is the declared name ──
test('menu exports the same String.raw block as SRC and MENU_SRC', () => {
  assert.equal(typeof MENU_SRC, 'string')
  assert.ok(MENU_SRC.length > 0)
  assert.equal(SRC, MENU_SRC, 'SRC (build consumes) === MENU_SRC (contract export)')
})

// ── the title + PLAY button render into the pool on the default (menu) scene ──
test('menu renders the title plate and the PLAY button', () => {
  const { wd, tick } = freshSim()               // no seed → wd.__scene unset → menu
  tick(...uvpx(0.5, 0.5), false)                // pointer off every control, no click

  const e = ents(wd)
  const title = e.find(x => x.code === 320 && Math.abs(x.y - 0.55) < 0.02)
  assert.ok(title, 'a title panel (code 320) renders high-centre')

  const play = e.find(x => Math.trunc(x.code) === 306)   // PLAY = chrome button id 6
  assert.ok(play, 'the PLAY button (code 306) renders')
  assert.ok(Math.abs(play.x - 0.0) < 1e-6, 'PLAY is centred')
  assert.ok(Math.abs(play.y - 0.12) < 1e-6, 'PLAY sits below the title')

  // the persistent corner pads are present too (design id 10, fleet id 11)
  assert.ok(e.some(x => Math.trunc(x.code) === 310), 'design corner pad renders')
  assert.ok(e.some(x => Math.trunc(x.code) === 311), 'fleet corner pad renders')
})

// ── clicking PLAY opens the DESIGNER (CONTRACT §3: wd.__scene = 'designer') ──
test('clicking PLAY sets wd.__scene to designer', () => {
  const { wd, tick } = freshSim()
  assert.equal(wd.__scene, undefined, 'starts on the menu (no scene set)')
  // click at the PLAY centre. uvpx flips y (toUV negates), so target (0, +0.12) is uvpx(0, -0.12).
  tick(...uvpx(0, -0.12), true)
  assert.equal(wd.__scene, 'designer', 'PLAY jumped to the designer')
})

// ── PLAY does not fire when the pointer is elsewhere (no accidental nav) ──
test('a click away from PLAY leaves the menu scene unchanged', () => {
  const { wd, tick } = freshSim()
  tick(...uvpx(-0.5, 0.05), true)               // click empty space, not over any control
  assert.notEqual(wd.__scene, 'designer', 'no jump without hitting PLAY')
})

// ── the design corner pad also opens the DESIGNER (persistent chrome nav) ──
test('clicking the design corner pad opens the designer', () => {
  const { wd, tick } = freshSim()
  // design pad is at CH.designX=-0.90, CH.padY=-0.90; uvpx flips y → uvpx(-0.90, 0.90)
  tick(...uvpx(-0.90, 0.90), true)
  assert.equal(wd.__scene, 'designer', 'design pad jumped to the designer')
})

// ── the top-bar finder tab jumps to the FINDER ──
test('clicking the finder tab jumps to the finder', () => {
  const { wd, tick } = freshSim()
  // finder tab is CH.tabX[1]=-0.66 at CH.barY=0.90; flip y → uvpx(-0.66, -0.90)
  tick(...uvpx(-0.66, -0.90), true)
  assert.equal(wd.__scene, 'finder', 'finder tab jumped to the finder')
})

// ── berths summary: 3 plates under the title; a saved berth reads taller ──
test('berths summary draws a plate per fleet slot; saved berths read taller', () => {
  const fract = a => a - Math.floor(a)          // chrome packs a rect half-height into fract(a)
  const { wd, tick } = freshSim({ __fleet: [[{ parent: -1, edge: -1, part: 1 }], null, null] })
  tick(...uvpx(0.5, 0.5), false)                // no click; just render

  const berths = ents(wd)
    .filter(x => x.code === 320 && Math.abs(x.y + 0.32) < 0.03)   // the 3 panels at y≈-0.32
    .sort((a, b) => a.x - b.x)
  assert.equal(berths.length, 3, 'three berth plates')
  // slot 0 is filled ⇒ its plate is taller than the two empty slots
  assert.ok(fract(berths[0].a) > fract(berths[1].a), 'saved berth taller than empty')
  assert.ok(Math.abs(fract(berths[1].a) - fract(berths[2].a)) < 1e-6, 'the two empty berths match')
})
