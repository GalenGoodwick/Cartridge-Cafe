// THE ASSETS-TAB EYE — ◲ ASSETS as a first-class ENGINE tab: house message,
// owner upload door, GET-meta use-snippets (copyable), read-only for
// non-owners, CONFIG workbench door jumps here. Prodtools-eye harness shape;
// world pixels stay Galen's tab.
import { chromium } from 'playwright'

const BASE = process.env.EYE_BASE || 'http://localhost:3141'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override', '1') } catch { /* noop */ } })

const PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const SPRITES = {
  sheets: [{ name: 'ember', png_b64: PX, cols: 4, rows: 1, fps: 8 }],
  meta: { rev: 1, slots: [0, 1, 2, 3].map(i => ({ name: 'ember.' + i, i, sheet: 'ember', cell: [i, 0] })), clips: [{ name: 'ember', first: 0, n: 4, fps: 8 }] },
}
const SNAP = { snapshot: { fields: [], worldData: { instructions: 'mock world' }, worldParams: {} } }
const mockSpace = async (owner) => {
  await ctx.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {})
  await ctx.route('**/api/spaces/testy/**', r => r.fulfill({ json: {} }))
  await ctx.route('**/api/spaces/testy', r => r.fulfill({ json: { space: { id: 'sp_1', slug: 'testy', name: 'TESTY', ownerId: owner ? 'u_me' : 'u_boss', owner: { id: owner ? 'u_me' : 'u_boss', name: 'Someone' }, isPublic: true } } }))
  await ctx.route('**/api/auth/session', r => r.fulfill({ json: { user: { id: 'u_me', name: 'Galen', email: 'g@x' } } }))
  await ctx.route('**/api/spaces/testy/snapshot**', r => r.fulfill({ json: SNAP }))
  await ctx.route('**/api/spaces/testy/sprites**', r => r.fulfill({ json: SPRITES }))
  await ctx.route('**/api/spaces/testy/token', r => r.request().method() === 'POST' ? r.fulfill({ json: { token: 'uc_st_mock' } }) : r.fulfill({ json: { tokens: [] } }))
  await ctx.route('**/api/spaces/testy/versions', r => r.fulfill({ json: { versions: [] } }))
  await ctx.route('**/api/spaces/testy/invite', r => r.fulfill({ json: { joinUrl: BASE + '/join/abc' } }))
  await ctx.route('**/api/spaces/testy/nodes**', r => r.fulfill({ json: { nodes: [] } }))
}

const p = await ctx.newPage()
p.on('dialog', d => d.dismiss().catch(() => {}))
let pass = 0, fail = 0
const T = (n, ok) => { console.log(`${ok ? '✓' : '✗'} ${n}`); ok ? pass++ : fail++ }
const body = () => p.evaluate(() => document.body.innerText)

// ═ 1 · house cartridge: the tab exists; shelf says assets live on real worlds ═
await mockSpace(true)
await p.goto(BASE + '/grid?ui=engine&w=CINDERFELL', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(2500)
const tabBtn = p.locator('button', { hasText: '◲ ASSETS' }).first()
T('tab row shows ◲ ASSETS', await tabBtn.count() > 0)
await tabBtn.click()
await p.waitForTimeout(600)
T('house cartridge → "assets live on real worlds"', (await body()).includes('assets live on real worlds'))

// ═ 2 · owned space: upload door + the sheet + its use-snippet from GET meta ═
await p.goto(BASE + '/grid?ui=engine&w=space:testy', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(3500)
await p.locator('button', { hasText: '◲ ASSETS' }).first().click()
await p.waitForTimeout(1200)
let t = await body()
T('owner sees the upload door (DROP A PNG)', t.includes('DROP A PNG'))
T('the world\'s sheet is on the shelf (ember · slots)', t.includes('ember') && t.includes('slots ember.0'))
T('use-snippet from GET meta (spriteAnim)', t.includes('spriteAnim(0, 4, 8.0, uv, time)'))
const snip = p.locator('button', { hasText: 'spriteAnim(' }).first()
if (await snip.count()) {
  await snip.click(); await p.waitForTimeout(300)
  const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '')
  T('use-snippet copies to clipboard', clip === 'spriteAnim(0, 4, 8.0, uv, time)')
} else T('use-snippet copies to clipboard', false)
await p.screenshot({ path: process.env.SHOT || '/tmp/assets-tab-owner.png' })

// ═ 3 · CONFIG workbench ◲ ASSETS door jumps to the tab ═
await p.locator('button', { hasText: '⚙ CONFIG' }).first().click()
await p.waitForTimeout(800)
t = await body()
if (t.includes('THE WORKBENCH')) {
  await p.locator('button', { hasText: '◲ ASSETS' }).nth(1).click()
  await p.waitForTimeout(500)
  T('CONFIG workbench door lands on the ASSETS tab', (await body()).includes('saved on this world'))
} else T('CONFIG workbench door lands on the ASSETS tab (workbench absent — cfg owner?)', false)

// ═ 4 · not the owner: read-only shelf — no upload, no delete, note shown ═
await mockSpace(false)
await p.goto(BASE + '/grid?ui=engine&w=space:testy', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(3500)
await p.locator('button', { hasText: '◲ ASSETS' }).first().click()
await p.waitForTimeout(1200)
t = await body()
T('non-owner: read-only note', t.includes('read-only — the owner uploads'))
T('non-owner: no upload door', !t.includes('DROP A PNG'))
T('non-owner: no DELETE', !t.includes('DELETE'))
T('non-owner still sees the shelf + use-snippet', t.includes('ember') && t.includes('spriteAnim(0, 4, 8.0, uv, time)'))

console.log(`\n${pass} ✓ ${fail} ✗`)
await b.close()
process.exit(fail ? 1 : 0)
