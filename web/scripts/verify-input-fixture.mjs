// Headless regression driver for the input event-queue fix (item 1). Drives a
// seeded fixture world through the REAL sandbox worker: between-tick taps must
// each reach input.pressed exactly once, a held key must not re-fire, both
// flippers actuate independently. Usage:
//   node scripts/verify-input-fixture.mjs [slug]
// Slug defaults to the seed's scratchpad record. Seed/refresh the world with:
//   SEED_FIXTURE=1 npx vitest run src/__tests__/fixtures/input-fixture.seed.test.ts
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const argSlug = process.argv[2]
let slug = argSlug
if (!slug) { try { slug = JSON.parse(readFileSync('/private/tmp/claude-501/-Users-galengoodwick/c2b6d436-7855-4b2a-9cfc-cd2b94e9d7c8/scratchpad/tap-fixture.json', 'utf8')).slug } catch { /* pass slug as argv[2] */ } }
if (!slug) { console.error('no slug — pass one as argv[2] or re-seed'); process.exit(2) }
const URL = 'http://localhost:3000/space/' + slug
const SHOT = '/private/tmp/claude-501/-Users-galengoodwick/c2b6d436-7855-4b2a-9cfc-cd2b94e9d7c8/scratchpad/fixture.png'

const launch = { headless: true, args: ['--headless=new', '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--ignore-gpu-blocklist'] }
let browser
try { browser = await chromium.launch({ ...launch, channel: 'chrome' }) } catch { browser = await chromium.launch(launch) }
const page = await browser.newPage({ viewport: { width: 700, height: 820 } })
const errs = []
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
page.on('pageerror', e => errs.push('PAGEERR: ' + e.message))
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => errs.push('goto: ' + e.message))
await page.waitForTimeout(2000)
try { await (await page.getByText('GOT IT', { exact: false })).click({ timeout: 1500 }) } catch {}
try { await (await page.getByText(/play tap fixture/i)).click({ timeout: 3000 }) } catch (e) { errs.push('play-click: ' + e.message) }
let devSimReady = false
for (let i = 0; i < 30; i++) { devSimReady = await page.evaluate(() => !!window.__ccDevSim); if (devSimReady) break; await page.waitForTimeout(400) }
await page.waitForTimeout(2500)

const tf = () => page.evaluate(() => ({ ...(window.__ccDevSim?.worldData?.__tf || {}) }))

// baseline, then N space / M left / K right taps — each a keydown+keyup in the SAME
// microtask (a sub-frame "between-tick" tap), spaced 120ms apart so each clearly
// lands in its own tick. Under the OLD level-sampling these were LOST.
const base = await tf()
const dispatched = { space: 6, left: 3, right: 2 }
await page.evaluate(async (d) => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const tap = (key) => { window.dispatchEvent(new KeyboardEvent('keydown', { key })); window.dispatchEvent(new KeyboardEvent('keyup', { key })) }
  for (let i = 0; i < d.space; i++) { tap(' '); await sleep(120) }
  for (let i = 0; i < d.left; i++) { tap('ArrowLeft'); await sleep(120) }
  for (let i = 0; i < d.right; i++) { tap('ArrowRight'); await sleep(120) }
}, dispatched)
await page.waitForTimeout(700)
const post = await tf()
const tapTest = {
  spaceDelta: (post.space ?? 0) - (base.space ?? 0),
  leftDelta: (post.left ?? 0) - (base.left ?? 0),
  rightDelta: (post.right ?? 0) - (base.right ?? 0),
  exact: (post.space - base.space === dispatched.space) && (post.left - base.left === dispatched.left) && (post.right - base.right === dispatched.right),
}

// HELD test: hold left ~350ms → exactly ONE more count, flipper actuated (la≈0.7)
const beforeHold = (await tf()).left ?? 0
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })))
await page.waitForTimeout(220)
const midHold = await tf()
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft' })))
await page.waitForTimeout(350)
const afterHold = (await tf()).left ?? 0

// BOTH flippers: hold left+right together → both actuate (la>0, ra<0)
await page.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })) })
await page.waitForTimeout(160)
const bothHeld = await tf()
await page.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft' })); window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' })) })
await page.waitForTimeout(250)
await page.screenshot({ path: SHOT })

console.log(JSON.stringify({
  devSimReady, dispatched,
  tapTest,
  heldTest: { beforeHold, midHoldCount: midHold.left, midHoldAngle: midHold.la, afterHold, exactlyOneMore: afterHold === beforeHold + 1, flipperActuated: midHold.la > 0.5 },
  bothFlippers: { la: bothHeld.la, ra: bothHeld.ra, bothActuated: bothHeld.la > 0.5 && bothHeld.ra < -0.5 },
  shaderErrs: errs.filter(e => /wgsl|tint|shader|pipeline|compile|PAGEERR/i.test(e)).slice(0, 6),
}, null, 2))
await browser.close()
