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
const SNAP = { snapshot: { fields: [], worldData: { instructions: 'mock world', policy: { build: 'anyone' } }, worldParams: {} } }
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
await ctx.route('**/api/cards?tab=live', r => r.fulfill({ json: { cards: [{ slug: 'testy', name: 'TESTY', maker: { name: 'Galen' } }] } }))
await p.click('button:has-text("⛭ CO-BUILD")'); await p.waitForTimeout(800)
T('CO-BUILD = the join door (open builds listed)', /open live-editing worlds, join in/.test(await body()) && await p.locator('[data-crew-join="testy"]').count() === 1)
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

// ⛭ CO-BUILD join: picking an open build loads it + opens ⚿ CONNECT
await p.click('button:has-text("⛭ CO-BUILD")'); await p.waitForTimeout(900)
await p.click('[data-crew-join="testy"]').catch(() => {})
await p.waitForTimeout(800)
T('CO-BUILD join → world in frame + connect prompt', await p.evaluate(() =>
  new URL(location.href).searchParams.get('w') === 'space:testy' && /CONNECT YOUR AI/.test(document.body.innerText)))

// ═ 4 · ⬆ PUBLISH — slim check only (the DESTINATIONS flow is unfinished-eye's) ═
await p.click('button:has-text("⬆ PUBLISH")'); await p.waitForTimeout(600)
T('PUBLISH tab: state chip + destination buttons', await p.evaluate(() =>
  !!document.querySelector('[data-pub-state]') && /PUBLISH — GAME LIST/.test(document.body.innerText)))

// ▤ THE CARD in CONFIG — kind chip writes through the seam and reads back
await p.click('button:has-text("⚙ CONFIG")'); await p.waitForTimeout(700)
T('THE CARD section present', /▤ THE CARD/.test(await body()))
await p.click('[data-card-kind="game"]'); await p.waitForTimeout(900)
T('kind=GAME round-trips (engine publish)', await p.evaluate(() =>
  window.__eyeEvents.some(e => e?.config?.card?.kind === 'game')))

// ═ 5 · ✧ CREATE — contextual base ═
// membership banner rides live-edit worlds (policy build:anyone in the mock)
T('EDITING MEMBERSHIP box on live-edit world', /EDITING MEMBER|LIVE EDITING|MEMBERSHIP/i.test(await body()))

// PUBLISH: ✦ PREMIUM seat round-trips
await p.click('button:has-text("⬆ PUBLISH")'); await p.waitForTimeout(500)
T('✦ PREMIUM seat present', /✦ PREMIUM/.test(await body()))
await p.fill('input[inputmode="decimal"]', '5')
await p.click('button:has-text("SET PRICE")'); await p.waitForTimeout(800)
T('premium $5 round-trips', await p.evaluate(() => window.__eyeEvents.some(e => e?.config?.premium === 5)))

// CONFIG: ▦ DEVICE chips round-trip
await p.click('button:has-text("⚙ CONFIG")'); await p.waitForTimeout(500)
T('device chips present', await p.locator('[data-cfg-device="mobile"]').count() === 1)
await p.click('[data-cfg-device="mobile"]'); await p.waitForTimeout(800)
T('device=mobile round-trips', await p.evaluate(() => window.__eyeEvents.some(e => e?.config?.device === 'mobile')))

// ═ 6 · MAIN — the commons: starfield in frame (no bubbles), presence room, chat, brew ═
await ctx.route('**/api/engine/player-icon', r => r.request().method() === 'POST' ? r.fulfill({ json: { token: 'uc_pt_mock' } }) : r.fulfill({ json: { icon: null, signedIn: true } }))
await p.goto('http://localhost:3131/grid?ui=main&w=CINDERFELL', { waitUntil: 'domcontentloaded' })
await p.waitForSelector('[data-grid-commons]', { timeout: 20000 }); await p.waitForTimeout(4000)
T('MAIN: ◉ COMMONS button on the bar', await p.locator('[data-grid-commons]').count() === 1)
T('MAIN bar: Cartridge.Cafe title · commons LEFT · brew RIGHT · no instructions', await p.evaluate(() => {
  const t = document.querySelector('[data-grid-title]')
  const cup = document.querySelector('button[aria-label="ui selector"]')
  const com = document.querySelector('[data-grid-commons]')
  const brew = document.querySelector('[data-grid-brewicon]')
  if (!t || !cup || !com || !brew) return false
  const x = el => el.getBoundingClientRect().left
  return t.textContent === 'Cartridge.Cafe' && x(com) < x(cup) && x(brew) > x(cup) && !document.body.innerText.includes('? INSTRUCTIONS')
}))
T('MAIN: presence room armed on CAFE (starfield frame)', await p.evaluate(() => window.__ccPresenceDbg?.room === 'cursors:CAFE'))
T('MAIN: no bubble doors (CAFE hub not mounted)', await p.evaluate(() => !/THE SHELF|SUB-MAIN/.test(document.body.innerText)))
// the glyph hook packs uniforms and the icon TRACKS THE CURSOR (the freeze-era
// cafe_door replaced by main_glyph — zero bubbles, cursor uv at u[4..5])
await p.mouse.move(640, 200); await p.waitForTimeout(400)
const g1 = await p.evaluate(() => ((window.__ccDevSim?.worldData?.gpuUniforms) || []).slice(0, 8))
await p.mouse.move(400, 320); await p.waitForTimeout(400)
const g2 = await p.evaluate(() => ((window.__ccDevSim?.worldData?.gpuUniforms) || []).slice(0, 8))
T('MAIN: glyph uniforms pack (0 bubbles) + cursor tracks', g1.length >= 8 && g1[3] === 0 && (g1[4] !== g2[4] || g1[5] !== g2[5]))

// ◆ BREW ICON
T('MAIN: ◆ BREW ICON on the bar', await p.locator('[data-grid-brewicon]').count() === 1)
await p.click('[data-grid-brewicon]', { force: true }); await p.waitForTimeout(700)
T('brew panel opens (token minted, bar free)', await p.evaluate(() => {
  const open = /BREW YOUR ICON/.test(document.body.innerText) && /COPY FOR YOUR AI/.test(document.body.innerText)
  const bar = document.querySelector('button[aria-label="ui selector"]')
  return open && !!bar && bar.getBoundingClientRect().height > 0
}))
await p.fill('textarea[placeholder^="a shy blue jellyfish"]', 'a tiny ember fox')
await p.click('button:has-text("⧉ COPY FOR YOUR AI")'); await p.waitForTimeout(400)
T('brew prompt copied', /✓ COPIED/.test(await body()))
await p.click('[data-grid-brewicon]', { force: true }); await p.waitForTimeout(300)
await p.click('[data-grid-commons]', { force: true }); await p.waitForTimeout(700)
const commons = await p.evaluate(() => ({
  open: /THE COMMONS — THE ROOM|THE COMMONS/.test(document.body.innerText),
  bar: (() => { const b = document.querySelector('button[aria-label="ui selector"]'); return !!b && b.getBoundingClientRect().height > 0 })(),
}))
T('COMMONS chat opens field-bounded (bar free)', commons.open && commons.bar)
await p.click('[data-grid-commons]', { force: true }); await p.waitForTimeout(300)

// dockstar menu: brand + ACCOUNT → auth
await p.click('button[aria-label="ui selector"]', { force: true }); await p.waitForTimeout(500)
T('dockstar menu: cafe-sign brand + cup + tagline', await p.evaluate(() => {
  const sign = document.querySelector('.cafe-sign')
  return !!sign && /cartridge/.test(sign.textContent || '') &&
    document.querySelectorAll('img[src="/cartridge-cup.svg"]').length >= 2 &&   // the dockstar cup + the menu cup
    document.body.innerText.includes('INSTANT NATURAL LANGUAGE TO GAME WORLD FRAMEWORK')
}))
T('ACCOUNT door: /account signed-in, signin signed-out', await p.evaluate(() => {
  const a = document.querySelector('a[data-grid-account]')
  const href = a?.getAttribute('href') || ''
  return !!a && (href === '/account' || href.startsWith('/auth/signin'))
}))

// ═ 7 · ✧ CREATE ═
await p.goto('http://localhost:3131/grid?ui=create&w=CINDERFELL', { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForSelector('text=✧ CREATE', { timeout: 20000 }); await p.waitForTimeout(1000)
T('CREATE on house cartridge: brew only', /forks grow from real worlds/.test(await body()) && /OPEN THE CREATE FLOW/.test(await body()))
await p.goto('http://localhost:3131/grid?ui=create&w=space:testy', { waitUntil: 'domcontentloaded' })
await p.waitForSelector('input[placeholder^="name your fork"]', { timeout: 20000 })
await p.fill('input[placeholder^="name your fork"]', 'neon-remix')
await p.click('button:has-text("⑄ FORK IT")'); await p.waitForTimeout(1500)
const afterFork = await p.evaluate(() => ({ url: location.search, engine: /⚙ CONFIG/.test(document.body.innerText) }))
T('fork → lands in ENGINE on the new world', afterFork.url.includes('w=space%3Atesty-remix') && afterFork.engine)

// the embedded create flow (Galen: "all plugged into it")
await p.goto('http://localhost:3131/grid?ui=create&w=space:testy', { waitUntil: 'domcontentloaded' })
await p.waitForSelector('button:has-text("✧ OPEN THE CREATE FLOW")', { timeout: 20000 })
await p.click('button:has-text("✧ OPEN THE CREATE FLOW")'); await p.waitForTimeout(2500)
const embed = await p.evaluate(() => {
  const f = document.querySelector('iframe[data-create-flow]')
  return { there: !!f, src: f?.getAttribute('src') ?? '' }
})
T('create flow embedded (iframe, base threaded)', embed.there && embed.src.includes('/create?base=testy'))
await p.click('button:has-text("◂ BACK")'); await p.waitForTimeout(400)
T('back out of the flow', await p.evaluate(() => !document.querySelector('iframe[data-create-flow]')))

await b.close(); console.log('PROD-TOOLS EYE v4 COMPLETE')
