// chrome.test — verifies the PENTARCH visual system exports (chrome.mjs).
// A lib node: green is DERIVED here. `node --test pentarch/test/chrome.test.mjs`.
//
// The two exports are SOURCE STRINGS inlined elsewhere, so this test:
//   1. proves CHROME_PRELUDE parses + runs as PRELUDE JS, and its composed helpers
//      push the right entity codes / positions and hit-test correctly (pure inputs);
//   2. proves CHROME_WGSL declares the primitive fns the shader calls, balanced;
//   3. PINS the encoding both exports share — packWH (JS) ↔ unpack (WGSL) round-trips —
//      the one thing that would silently break a split lib.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { CHROME_WGSL, CHROME_PRELUDE } from '../chrome.mjs'

const here = dirname(fileURLToPath(import.meta.url))

// Instantiate CHROME_PRELUDE the way build.mjs will: as statements in PRELUDE scope,
// with a recording `pushEnt` and a `wd`. Return the helpers + the entity log.
function boot() {
  const pops = []
  const wd = {}
  const pushEnt = (x, y, a, code) => pops.push({ x, y, a, code })
  const names = ['CH', 'CH_PANEL', 'CH_BANNER', 'CH_BTN0', 'chPackWH', 'chHit',
    'panel', 'banner', 'button', 'buttonAt', 'topBar', 'cornerPads',
    'palette', 'statCard', 'listRow', 'reason']
  const make = new Function('pushEnt', 'wd',
    CHROME_PRELUDE + '\nreturn {' + names.join(',') + '};')
  return { api: make(pushEnt, wd), pops, wd }
}

// the WGSL unpack formulas, reimplemented in JS, to pin agreement with chPackWH
const wgslUnpackW = a => Math.floor(a) / 4096.0
const wgslUnpackH = a => a - Math.floor(a)

test('CHROME_PRELUDE parses and exposes the documented helpers', () => {
  const { api } = boot()
  for (const k of ['panel', 'banner', 'button', 'buttonAt', 'topBar',
    'cornerPads', 'palette', 'statCard', 'listRow', 'reason', 'chPackWH', 'chHit'])
    assert.equal(typeof api[k], 'function', 'helper ' + k)
  assert.equal(typeof api.CH, 'object')
  assert.equal(api.CH_PANEL, 320)
  assert.equal(api.CH_BANNER, 321)
  assert.equal(api.CH_BTN0, 300)
})

test('packWH ↔ WGSL unpack round-trips (the two exports agree on encoding)', () => {
  const { api } = boot()
  for (const [hw, hh] of [[0.5, 0.3], [0.062, 0.075], [1.0, 0.0], [0.17, 0.12], [0.995, 0.075]]) {
    const a = api.chPackWH(hw, hh)
    assert.ok(Math.abs(wgslUnpackW(a) - hw) < 1e-3, 'W ' + hw + '/' + hh)
    assert.ok(Math.abs(wgslUnpackH(a) - hh) < 1e-4, 'H ' + hw + '/' + hh)
  }
})

test('packWH clamps out-of-range sizes (no fract overflow into the int field)', () => {
  const { api } = boot()
  const a = api.chPackWH(2.0, 1.5)         // both over range
  assert.equal(wgslUnpackW(a), 1.0)        // halfW clamped to 1
  assert.ok(wgslUnpackH(a) < 1.0)          // halfH stays a valid fract
})

test('panel/banner push their codes with size packed in aux', () => {
  const { api, pops } = boot()
  api.panel(0.1, -0.2, 0.4, 0.3)
  api.banner(0.0, -0.42, 0.2, 0.05)
  assert.equal(pops[0].code, 320)
  assert.equal(pops[0].x, 0.1); assert.equal(pops[0].y, -0.2)
  assert.ok(Math.abs(wgslUnpackW(pops[0].a) - 0.4) < 1e-3)
  assert.ok(Math.abs(wgslUnpackH(pops[0].a) - 0.3) < 1e-4)
  assert.equal(pops[1].code, 321)
})

test('button rides id in the int part and half-width in the fract part', () => {
  const { api, pops } = boot()
  api.button(7, 0.0, 0.0, 0.062, 0.5)
  const c = pops[0].code
  assert.equal(Math.trunc(c), 307, 'id 7 → 300+7')
  assert.ok(Math.abs((c - Math.trunc(c)) - 0.062) < 1e-3, 'half-width in fract')
  assert.equal(pops[0].a, 0.5, 'state in aux')
})

test('buttonAt: state is idle/hover/pressed and click only fires when inside', () => {
  const { api, pops } = boot()
  const idle = api.buttonAt(0, 0.0, 0.0, 0.1, 0.9, 0.9, true)   // pointer far away
  assert.equal(idle, false)
  assert.equal(pops[pops.length - 1].a, 0, 'far pointer → idle')

  api.buttonAt(0, 0.0, 0.0, 0.1, 0.0, 0.0, false)              // hovering, not clicking
  assert.equal(pops[pops.length - 1].a, 0.5, 'hover → 0.5')

  const hit = api.buttonAt(0, 0.0, 0.0, 0.1, 0.02, -0.01, true) // inside + click
  assert.equal(hit, true)
  assert.equal(pops[pops.length - 1].a, 1, 'pressed → 1')
})

test('topBar draws the band + tabs and returns the tab clicked (never the active one)', () => {
  const { api } = boot()
  // click the finder tab (index 1)
  const CH = api.CH
  const clicked = api.topBar('menu', CH.tabX[1], CH.barY, true)
  assert.equal(clicked, 'finder')
  // clicking the ALREADY-active tab returns null (no redundant nav)
  const same = api.topBar('menu', CH.tabX[0], CH.barY, true)
  assert.equal(same, null)
  // active tab is drawn pressed
  const { api: a2, pops } = boot()
  a2.topBar('finder', 9, 9, false)             // pointer off-screen
  // find the finder tab button (id 1) — its aux should be forced to 1 (active)
  const finderBtn = pops.find(p => Math.trunc(p.code) === 301)
  assert.equal(finderBtn.a, 1, 'active tab forced pressed')
})

test('cornerPads returns design | fleet | null by pointer', () => {
  const { api } = boot()
  const CH = api.CH
  assert.equal(api.cornerPads(CH.designX, CH.padY, true), 'design')
  assert.equal(api.cornerPads(CH.fleetX, CH.padY, true), 'fleet')
  assert.equal(api.cornerPads(0.0, 0.0, true), null)
})

test('palette highlights the selected slot and returns a different clicked slot', () => {
  const { api, pops } = boot()
  const CH = api.CH
  const got = api.palette(2, CH.palX[4], CH.palY, true)
  assert.equal(got, 4, 'clicked slot 4')
  // selected slot 2 (button id ID_PAL0+2) is forced active
  const selBtn = pops.find(p => Math.trunc(p.code) === 300 + CH.ID_PAL0 + 2)
  assert.equal(selBtn.a, 1)
  // clicking the already-selected slot returns null
  assert.equal(api.palette(2, CH.palX[2], CH.palY, true), null)
})

test('listRow: selected shades to 1, hover to 0.5, click fires only inside', () => {
  const { api, pops } = boot()
  assert.equal(api.listRow(0, 0.0, 0.5, 0.6, true, 9, 9, true), false) // selected, pointer away
  assert.equal(pops[pops.length - 1].a, 1)
  const hit = api.listRow(0, 0.0, 0.5, 0.6, false, 0.0, 0.5, true)     // inside + click
  assert.equal(hit, true)
})

test('statCard pushes a non-interactive panel sized to its rows', () => {
  const { api, pops } = boot()
  api.statCard(0.5, 0.2, 8)
  assert.equal(pops[0].code, 320)                 // it is a PANEL, not a button
  const hhSmall = (() => { const b = boot(); b.api.statCard(0, 0, 1); return wgslUnpackH(b.pops[0].a) })()
  const hhBig = wgslUnpackH(pops[0].a)
  assert.ok(hhBig > hhSmall, 'more rows → taller card')
})

test('reason draws the red banner + stashes text; empty clears with no banner', () => {
  const { api, pops, wd } = boot()
  api.reason('would overlap')
  assert.equal(wd.__reason, 'would overlap')
  assert.equal(pops[0].code, 321)
  const b2 = boot()
  b2.api.reason('')
  assert.equal(b2.wd.__reason, '')
  assert.equal(b2.pops.length, 0, 'no banner drawn when there is no reason')
})

test('CHROME_WGSL declares the primitive fns the shader calls, braces balanced', () => {
  for (const fn of ['ch_unpackW', 'ch_unpackH', 'ch_rrect', 'ch_panel', 'ch_banner', 'ch_button'])
    assert.ok(new RegExp('fn\\s+' + fn + '\\s*\\(').test(CHROME_WGSL), 'fn ' + fn)
  // panel/banner/button return an rgba the shader composites
  assert.equal((CHROME_WGSL.match(/->\s*vec4f/g) || []).length >= 3, true)
  let depth = 0
  for (const ch of CHROME_WGSL) { if (ch === '{') depth++; else if (ch === '}') depth-- }
  assert.equal(depth, 0, 'balanced braces')
  const paren = [...CHROME_WGSL].reduce((d, c) => d + (c === '(') - (c === ')'), 0)
  assert.equal(paren, 0, 'balanced parens')
})

test('CHROME_WGSL unpack formulas are literally floor/4096 and fract (mirror pin)', () => {
  assert.ok(/floor\(a\)\s*\/\s*4096/.test(CHROME_WGSL), 'ch_unpackW = floor(a)/4096')
  assert.ok(/return\s+fract\(a\)/.test(CHROME_WGSL), 'ch_unpackH = fract(a)')
})

test('chrome.mjs has no imports and no Deno/tmp (inlinable into PRELUDE)', () => {
  const src = readFileSync(join(here, '../chrome.mjs'), 'utf8')
  assert.equal(/^\s*import\s/m.test(src), false, 'no import')
  assert.equal(/\bDeno\b/.test(src), false, 'no Deno')
  assert.equal(/\/tmp\b/.test(src), false, 'no /tmp')
})
