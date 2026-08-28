import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {} })
const p = await ctx.newPage()
const openChat = async (w) => {
  await p.goto(`http://localhost:3131/grid?ui=engine&w=${w}`, { waitUntil: 'domcontentloaded' })
  await p.waitForSelector('button:has-text("◉ CHAT")', { timeout: 20000 })
  await p.waitForTimeout(1500)
  await p.click('button:has-text("◉ CHAT")')
  await p.waitForSelector('input', { timeout: 15000 }); await p.waitForTimeout(1200)
}
await openChat('CINDERFELL')
const c = await p.evaluate(() => ({ alpha: /cinder-thread-alpha/.test(document.body.innerText), beta: /starfield-thread-beta/.test(document.body.innerText) }))
console.log('CINDERFELL thread:', JSON.stringify(c), c.alpha && !c.beta ? '✓ isolated' : '✗')
// typing guard: game keys stay off while typing in chat
await p.fill('input', 'wasd wasd wasd')
const keysOff = await p.evaluate(() => { const wd = globalThis.__ccDevSim?.worldData ?? {}; return !wd.key_a && !wd.key_d && !wd.key_w && !wd.key_s })
console.log('typing guarded:', keysOff ? '✓' : '✗')
await openChat('ONE-HOME')
const s2 = await p.evaluate(() => ({ alpha: /cinder-thread-alpha/.test(document.body.innerText), beta: /starfield-thread-beta/.test(document.body.innerText) }))
console.log('STARFIELD thread:', JSON.stringify(s2), s2.beta && !s2.alpha ? '✓ isolated' : '✗')
// tools scroll-down + no classic button + engine has no bar title
const tools = await p.evaluate(() => ({ noTitleBtn: !document.querySelector('[data-grid-title]') }))
await p.click('button:has-text("⚙ WORLD TOOLS")'); await p.waitForTimeout(500)
const t2 = await p.evaluate(() => ({ console: /◈ AI CONSOLE/.test(document.body.innerText), settings: /⚙ WORLD SETTINGS/.test(document.body.innerText), noBtn: ![...document.querySelectorAll('button')].some(x => /CLASSIC TOOLS/.test(x.textContent||'')) }))
console.log('engine no-title:', tools.noTitleBtn ? '✓' : '✗', '· tools:', JSON.stringify(t2))
await b.close(); console.log('EYE COMPLETE')
