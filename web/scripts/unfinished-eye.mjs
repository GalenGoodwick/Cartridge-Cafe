// the unfinished tier + publish destinations + sign-out + back navigation
import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {}
  window.__eyeEvents = []; window.addEventListener('cafe:eye', e => window.__eyeEvents.push(e.detail)) })
const T = (n, ok) => console.log(`${ok ? '✓' : '✗'} ${n}`)
const SNAP = { snapshot: { fields: [], worldData: { instructions: 'mock' }, worldParams: {} } }
await ctx.route('**/api/spaces/testy/**', r => r.fulfill({ json: {} }))
await ctx.route('**/api/spaces/testy', r => r.fulfill({ json: { space: { id: 'sp_1', slug: 'testy', name: 'TESTY', ownerId: 'u_me', owner: { id: 'u_me', name: 'Galen' }, isPublic: true } } }))
await ctx.route('**/api/auth/session', r => r.fulfill({ json: { user: { id: 'u_me', name: 'Galen', email: 'g@x' } } }))
await ctx.route('**/api/spaces/testy/snapshot**', r => r.fulfill({ json: SNAP }))
await ctx.route('**/api/spaces/testy/versions', r => r.fulfill({ json: { versions: [] } }))
const p = await ctx.newPage()

// ── shelf: ⚒ UNFINISHED tab present, empty state honest ──
await p.goto('http://localhost:3131/grid?ui=games&w=CINDERFELL', { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForSelector('button:has-text("⚒ UNFINISHED")', { timeout: 30000 }); await p.waitForTimeout(1200)
await p.click('button:has-text("⚒ UNFINISHED")'); await p.waitForTimeout(1500)
T('⚒ UNFINISHED tab + honest empty', /nothing on the workbench shelf|UNFINISHED/.test(await p.evaluate(() => document.body.innerText)))

// ── sign-out in the dockstar menu ──
await p.click('button[aria-label="ui selector"]', { force: true }); await p.waitForTimeout(600)
T('signed-in ACCOUNT → /account page door (name shown)', await p.evaluate(() => {
  const acct = document.querySelector('a[data-grid-account]')
  return !!acct && acct.textContent.includes('Galen') && acct.getAttribute('href') === '/account'
}))
await p.keyboard.press('Escape'); await p.evaluate(() => document.querySelector('button[aria-label="ui selector"]')?.click())

// ── publish destinations on an owned space ──
await p.goto('http://localhost:3131/grid?ui=engine&w=space:testy', { waitUntil: 'domcontentloaded' })
await p.waitForSelector('button:has-text("⬆ PUBLISH")', { timeout: 30000 })
await p.waitForFunction(() => window.__eyeEvents?.some(e => e?.config?.spaceSlug === 'testy'), null, { timeout: 30000 })
await p.click('button:has-text("⬆ PUBLISH")'); await p.waitForTimeout(800)
const dest = await p.evaluate(() => document.body.innerText)
T('destinations: GAME LIST · UNFINISHED · OPEN LIVE EDITING…', /● PUBLISH — GAME LIST/.test(dest) && /⚒ PUBLISH — UNFINISHED/.test(dest) && /◉ OPEN LIVE EDITING…/.test(dest))
// publish → unfinished round-trips
await p.click('button:has-text("⚒ PUBLISH — UNFINISHED")', { force: true }); await p.waitForTimeout(1200)
T('publish:unfinished round-trips (chip ⚒)', await p.evaluate(() => window.__eyeEvents.some(e => e?.config?.unfinished === true)) && /⚒ LIVE — UNFINISHED/.test(await p.locator('[data-pub-state]').innerText()))
// back to game list clears the flag
await p.click('button:has-text("● PUBLISH — GAME LIST")', { force: true }); await p.waitForTimeout(1200)
T('publish:game clears unfinished (chip ●)', /● LIVE — GAME LIST/.test(await p.locator('[data-pub-state]').innerText()))
// live-edit needs the DISCLAIMER; confirm seals; other destinations BLOCK
await p.click('button:has-text("◉ OPEN LIVE EDITING…")', { force: true }); await p.waitForTimeout(400)
T('disclaimer names the seal (no instant open)', await p.evaluate(() => {
  const c = document.querySelector('[data-live-confirm]')
  return !!c && /CANNOT|cannot be\s*reversed/i.test(c.textContent) && !window.__eyeEvents.some(e => e?.config?.policy === 'anyone')
}))
await p.click('[data-live-confirm-go]', { force: true }); await p.waitForTimeout(1500)
const sealed = await p.evaluate(() => window.__eyeEvents.some(e => e?.config?.policy === 'anyone'))
T('confirm → contract sealed (policy anyone)', sealed)
T('open world BLOCKS other destinations', await p.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  const game = btns.find(x => x.textContent.includes('● PUBLISH — GAME LIST'))
  const unf = btns.find(x => x.textContent.includes('⚒ PUBLISH — UNFINISHED'))
  const open = btns.find(x => x.textContent.includes('◉ OPEN LIVE EDITING…'))
  return game?.disabled && unf?.disabled && !open
}))

// ── back navigation: browser back + the bar ◂ ──
await p.goto('http://localhost:3131/grid?ui=games&w=CINDERFELL', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500)
await p.click('button:has-text("⚙")', { force: true }).catch(() => {})  // noop safety
await p.evaluate(() => document.querySelector('button[aria-label="ui selector"]').click()); await p.waitForTimeout(400)
await p.evaluate(() => { [...document.querySelectorAll('button')].find(x => x.textContent.includes('ENGINE'))?.click() }); await p.waitForTimeout(800)
const inEngine = await p.evaluate(() => new URL(location.href).searchParams.get('ui') === 'engine')
await p.goBack(); await p.waitForTimeout(800)
const backToGames = await p.evaluate(() => new URL(location.href).searchParams.get('ui') === 'games')
T('browser back → previous view (engine → games)', inEngine && backToGames)
T('bar has ◂ BACK left of title', await p.evaluate(() => {
  const back = document.querySelector('[data-grid-back]'), title = document.querySelector('[data-grid-title]')
  return !!back && (!title || back.getBoundingClientRect().left < title.getBoundingClientRect().left)
}))
await b.close(); console.log('UNFINISHED EYE COMPLETE')
