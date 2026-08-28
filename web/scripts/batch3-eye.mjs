import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {} })
const p = await ctx.newPage()
await p.goto('http://localhost:3131/grid', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(2500)
// connect-ai leads the carousel
console.log('CONNECT AI in browse:', await p.evaluate(() => [...document.querySelectorAll('button')].some(x => /⚿ CONNECT AI/.test(x.textContent||''))) ? '✓' : '✗')
// title button → attribution
await p.click('[data-grid-title]', { timeout: 5000 })
await p.waitForTimeout(400)
console.log('ATTRIBUTION popup:', await p.evaluate(() => /⑂ LINEAGE/.test(document.body.innerText) && /what it grew from/.test(document.body.innerText)) ? '✓' : '✗')
await p.keyboard.press('Escape').catch(()=>{}); await p.mouse.click(640, 300); await p.waitForTimeout(300)
// engine: CHAT + WORLD TOOLS overlay
await p.goto('http://localhost:3131/grid?ui=engine', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500)
console.log('CHAT button:', await p.evaluate(() => [...document.querySelectorAll('button')].some(x => /◉ CHAT/.test(x.textContent||''))) ? '✓' : '✗')
await p.click('button:has-text("⚙ WORLD TOOLS")'); await p.waitForTimeout(500)
console.log('TOOLS overlay:', await p.evaluate(() => /AI LOGS/.test(document.body.innerText) && /ATTRIBUTION/.test(document.body.innerText)) ? '✓ (full overlay w/ ai-logs seat)' : '✗')
await b.close(); console.log('BATCH3 EYE COMPLETE')
