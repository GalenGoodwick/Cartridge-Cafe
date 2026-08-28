// THE PROD-TOOLS EYE v2 — the batch-2 shape: VERSIONS + CO-BUILD + MY WORLDS
// as their own tabs, ✕ CLEAR on the eye image, REC games-play only, the old
// inspect panel confined, NODES ADVANCED = the flow tree. Space APIs mocked
// (dev DB has no reachable spaces); world pixels stay Galen's tab.
import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:3131' })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {}
  window.__eyeEvents = []
  window.addEventListener('cafe:eye', e => window.__eyeEvents.push(e.detail))
})

// ── mocks: a space I own; playwright matches routes NEWEST-FIRST, catch-all goes first ──
const SNAP = { snapshot: { fields: [], worldData: { instructions: 'mock world' }, worldParams: {} } }
await ctx.route('**/api/spaces/testy/**', r => r.fulfill({ json: {} }))
await ctx.route('**/api/spaces/testy', r => r.fulfill({ json: { space: { id: 'sp_1', slug: 'testy', name: 'TESTY', ownerId: 'u_me', owner: { id: 'u_me', name: 'Galen' }, isPublic: true } } }))
await ctx.route('**/api/auth/session', r => r.fulfill({ json: { user: { id: 'u_me', name: 'Galen', email: 'g@x' } } }))
await ctx.route('**/api/spaces/testy/snapshot**', r => r.fulfill({ json: SNAP }))
await ctx.route('**/api/spaces/testy/versions', r => r.request().method() === 'POST'
  ? r.fulfill({ json: { version: { version: 3, note: 'from eye', createdAt: new Date().toISOString() } } })
  : r.fulfill({ json: { versions: [{ version: 1, note: null, createdAt: '2026-08-01T00:00:00Z' }, { version: 2, note: 'good one', createdAt: '2026-08-20T00:00:00Z' }] } }))
await ctx.route('**/api/spaces/testy/invite', r => r.fulfill({ json: { joinUrl: 'http://localhost:3131/join/abc' } }))
await ctx.route('**/api/spaces/testy/token', r => r.request().method() === 'POST' ? r.fulfill({ json: { token: 'uc_st_mock' } }) : r.fulfill({ json: { tokens: [] } }))
await ctx.route('**/api/spaces/testy/sprites**', r => r.fulfill({ json: { sprites: [] } }))
await ctx.route('**/api/spaces/testy/nodes**', r => r.fulfill({ json: { nodes: [] } }))
await ctx.route('**/api/spaces/testy/fork', r => r.fulfill({ json: { space: { slug: 'testy-remix' } } }))
// the fresh fork the CREATE flow lands on
await ctx.route('**/api/spaces/testy-remix/**', r => r.fulfill({ json: {} }))
await ctx.route('**/api/spaces/testy-remix', r => r.fulfill({ json: { space: { id: 'sp_2', slug: 'testy-remix', name: 'NEON-REMIX', ownerId: 'u_me', owner: { id: 'u_me', name: 'Galen' }, isPublic: false } } }))
await ctx.route('**/api/spaces/testy-remix/snapshot**', r => r.fulfill({ json: SNAP }))
await ctx.route('**/api/spaces/testy-remix/versions', r => r.fulfill({ json: { versions: [] } }))

const p = await ctx.newPage()
p.on('dialog', d => d.dismiss().catch(() => {}))
const T = (n, ok) => console.log(`${ok ? '✓' : '✗'} ${n}`)
const body = () => p.evaluate(() => document.body.innerText)

// ═ 1 · house cartridge in ENGINE ═
await p.goto('http://localhost:3131/grid?ui=engine&w=CINDERFELL', { waitUntil: 'domcontentloaded' })
await p.waitForSelector('button:has-text("◈ EYE")', { timeout: 20000 }); await p.waitForTimeout(3500)

T('REC absent in engine (games-play only)', await p.locator('[data-grid-rec]').count() === 0)
T('tab row: CO-BUILD · VERSIONS · MY WORLDS present', await p.evaluate(() =>
  ['⛭ CO-BUILD', '⏱ VERSIONS', '⌂ MY WORLDS'].every(t => document.body.innerText.includes(t))))

// EYE: inspect + confined chrome
await p.click('button:has-text("◈ EYE")'); await p.waitForTimeout(600)
await p.click('button:has-text("◎ INSPECT")'); await p.waitForTimeout(800)
T('inspect toggles ON', /◉ INSPECT ON/.test(await body()))
T('frame-play yields while inspect on', await p.evaluate(() => !document.querySelector('button[aria-label^="play"]')))
const chrome = await p.evaluate(() => {
  const gone = !/clicks are documented for the AI/.test(document.body.innerText)
  const tint = [...document.querySelectorAll('div')].find(d => (d.getAttribute('style') || '').replace(/\s/g, '').includes('rgba(56,110,190'))
  const r = tint?.getBoundingClientRect()
  return { gone, framed: !!r && r.top > 0 && r.height < window.innerHeight - 40 }
})
T('old inspect panel gone (feed lives in EYE)', chrome.gone)
T('inspect tint confined to the frame', chrome.framed)
await p.click('button:has-text("◉ INSPECT ON")'); await p.waitForTimeout(400)

// ✕ CLEAR on the eye image (inject a shot, clear it)
await p.evaluate(() => window.dispatchEvent(new CustomEvent('cafe:eye', { detail: { eye: { png: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', at: Date.now() + 1e6 } } })))
await p.waitForTimeout(300)
T('eye image + ✕ CLEAR appear', await p.locator('[data-eye-clear]').count() === 1)
await p.click('[data-eye-clear]'); await p.waitForTimeout(300)
T('✕ CLEAR dismisses the snapshot', await p.locator('[data-eye-clear]').count() === 0 && /no image yet/.test(await body()))

// NODES → ADVANCED = the flow tree
await p.click('button:has-text("⬢ NODES")'); await p.waitForTimeout(1000)
await p.click('button:has-text("⬡ ADVANCED")'); await p.waitForTimeout(500)
const flow = await body()
T('ADVANCED shows THE FLOW tree', /⬡ THE FLOW/.test(flow) && /─paints→|▦ FIELDS/.test(flow) && /✎ HOOKS|◆ VISUALS/.test(flow))

// house notes on the space-only tabs
await p.click('button:has-text("⛭ CO-BUILD")'); await p.waitForTimeout(400)
T('CO-BUILD tab: house note', /co-build roster lives on real worlds/.test(await body()))
await p.click('button:has-text("⏱ VERSIONS")'); await p.waitForTimeout(400)
T('VERSIONS tab: house note', /versions live on real worlds/.test(await body()))
await p.click('button:has-text("⌂ MY WORLDS")'); await p.waitForTimeout(800)
T('MY WORLDS tab renders (empty deed note ok)', /MY WORLDS — pick one|no worlds on your deed/.test(await body()))

// CONFIG baseline: presence gone, design moved to PUBLISH, versions moved out
await p.click('button:has-text("⚙ CONFIG")'); await p.waitForTimeout(500)
const cfg1 = await body()
T('config slim: no presence · no design (→PUBLISH) · no versions', !/player presence/.test(cfg1) && !/design mode/.test(cfg1) && !/⚑ SAVE A POINT/.test(cfg1))
await p.click('button:has-text("⬆ PUBLISH")'); await p.waitForTimeout(400)
T('PUBLISH tab: house note', /publishing lives on real worlds/.test(await body()))

// ═ 2 · REC on GAMES-play ═
await p.goto('http://localhost:3131/grid?ui=games&ph=play&w=CINDERFELL', { waitUntil: 'domcontentloaded' })
await p.waitForSelector('[data-grid-rec]', { timeout: 20000 }); await p.waitForTimeout(3000)
T('REC on the bar (games-play)', await p.locator('[data-grid-rec]').count() === 1)
await p.click('[data-grid-rec]'); await p.waitForTimeout(1500)
const recTxt = await p.locator('[data-grid-rec]').innerText()
console.log(`  · REC reads ${JSON.stringify(recTxt.trim())} ${/\d+:\d+/.test(recTxt) ? '(recording ✓)' : '(headless captureStream refused — verify in real tab)'}`)
if (/\d+:\d+/.test(recTxt)) await p.click('[data-grid-rec]').catch(() => {})
T('MY WORLDS tab on the games shelf', await p.goto('http://localhost:3131/grid?ui=games&w=CINDERFELL', { waitUntil: 'domcontentloaded' })
  .then(() => p.waitForTimeout(1500)).then(() => p.evaluate(() => document.body.innerText.includes('⌂ MY WORLDS'))))

// ═ 3 · the SPACE mount ═
await p.goto('http://localhost:3131/grid?ui=engine&w=space:testy', { waitUntil: 'domcontentloaded' })
await p.waitForSelector('button:has-text("⚙ CONFIG")', { timeout: 20000 })
await p.waitForFunction(() => window.__eyeEvents?.some(e => e?.config?.spaceSlug === 'testy'), null, { timeout: 30000 })
await p.click('button:has-text("⚙ CONFIG")'); await p.waitForTimeout(1200)
const cfgTxt = await body()
T('space mounts for real (owner workbench)', /THE WORKBENCH/.test(cfgTxt))

// invite / icon / sprites
await p.click('button:has-text("⚭ INVITE A BUILDER")'); await p.waitForTimeout(700)
T('invite minted + copied', /✓ LINK COPIED/.test(await body()))
await p.click('button:has-text("◆ MAKE ICON")'); await p.waitForTimeout(700)
T('icon prompt copied (token minted)', /✓ COPIED/.test(await body()))
await p.click('button:has-text("◲ SPRITES")'); await p.waitForTimeout(900)
const spr = await p.evaluate(() => {
  const has = /◲ SPRITES/.test(document.body.innerText) && !!document.querySelector('.absolute.inset-0')
  const bar = document.querySelector('button[aria-label="ui selector"]')
  return { has, barVisible: !!bar && bar.getBoundingClientRect().height > 0 }
})
T('sprites panel embedded', spr.has)
T('bottom bar never covered', spr.barVisible)
await p.locator('button:has-text("✕")').last().click().catch(() => {})

// ⏱ VERSIONS tab on a space (owner)
await p.click('button:has-text("⏱ VERSIONS")'); await p.waitForTimeout(900)
const verTxt = await body()
T('VERSIONS tab: list + save + LIVE current', /every save point/.test(verTxt) && /v2/.test(verTxt) && /good one/.test(verTxt) && /⚑ SAVE A POINT/.test(verTxt))
T('LIVE marked current', await p.locator('button:has-text("LIVE")').first().evaluate(el => el.className.includes('emerald')))
await p.click('button:has-text("⚑ SAVE A POINT")'); await p.waitForTimeout(600)

// ⛭ CO-BUILD tab on a space
await p.click('button:has-text("⛭ CO-BUILD")'); await p.waitForTimeout(900)
T('CO-BUILD tab: NodeDockPanel embedded', /NODES — who builds what/.test(await body()))

// ═ 4 · ⬆ PUBLISH — draft⇄live, design rolled in ═
await p.click('button:has-text("⬆ PUBLISH")'); await p.waitForTimeout(600)
T('PUBLISH tab: ● LIVE chip (mock isPublic)', await p.locator('[data-pub-state]').innerText().then(t => t.includes('LIVE')))
await p.click('button:has-text("✎ START A DRAFT")'); await p.waitForTimeout(800)
T('draft flips the state chip (design ON)', await p.locator('[data-pub-state]').innerText().then(t => t.includes('DRAFTING')))
await p.click('button:has-text("● PUBLISH — ON THE GAME LIST")'); await p.waitForTimeout(900)
T('publish ends the draft → ● LIVE', await p.locator('[data-pub-state]').innerText().then(t => t.includes('LIVE')))

// ▤ THE CARD in CONFIG — kind chip writes through the seam and reads back
await p.click('button:has-text("⚙ CONFIG")'); await p.waitForTimeout(700)
T('THE CARD section present', /▤ THE CARD/.test(await body()))
await p.click('[data-card-kind="game"]'); await p.waitForTimeout(900)
T('kind=GAME round-trips (engine publish)', await p.evaluate(() =>
  window.__eyeEvents.some(e => e?.config?.card?.kind === 'game')))

// ═ 5 · ✧ CREATE — contextual base ═
await p.goto('http://localhost:3131/grid?ui=create&w=CINDERFELL', { waitUntil: 'domcontentloaded' })
await p.waitForSelector('text=✧ CREATE', { timeout: 20000 }); await p.waitForTimeout(1000)
T('CREATE on house cartridge: brew only', /forks grow from real worlds/.test(await body()) && /OPEN THE CREATE FLOW/.test(await body()))
await p.goto('http://localhost:3131/grid?ui=create&w=space:testy', { waitUntil: 'domcontentloaded' })
await p.waitForSelector('input[placeholder^="name your fork"]', { timeout: 20000 })
await p.fill('input[placeholder^="name your fork"]', 'neon-remix')
await p.click('button:has-text("⑄ FORK IT")'); await p.waitForTimeout(1500)
const afterFork = await p.evaluate(() => ({ url: location.search, engine: /⚙ CONFIG/.test(document.body.innerText) }))
T('fork → lands in ENGINE on the new world', afterFork.url.includes('w=space%3Atesty-remix') && afterFork.engine)

await b.close(); console.log('PROD-TOOLS EYE v3 COMPLETE')
