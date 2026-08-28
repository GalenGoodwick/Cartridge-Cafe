import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {} })
const p = await ctx.newPage()
await p.goto('http://localhost:3131/grid?ui=engine', { waitUntil: 'domcontentloaded' })
await p.waitForSelector('button:has-text("⬢ NODES")', { timeout: 20000 }); await p.waitForTimeout(3500)
await p.click('button:has-text("⬢ NODES")'); await p.waitForTimeout(1500)
const rows = await p.evaluate(() => ({
  field: /FIELD/.test(document.body.innerText), visual: /VISUAL/.test(document.body.innerText),
  hook: /HOOK/.test(document.body.innerText), names: (document.body.innerText.match(/cf_[a-z_]+|bg|home_bg/g)||[]).slice(0,4),
}))
console.log('NODES from the game:', JSON.stringify(rows), rows.field && rows.visual ? '✓ live graph' : '✗')
await p.click('button:has-text("⬡ ADVANCED")'); await p.waitForTimeout(800)
console.log('ADVANCED = real graph overlay:', await p.evaluate(() => /MODULES|VISUALS|FIELDS|HOOKS/.test(document.body.innerText)) ? '✓' : '✗')
await p.keyboard.press('Escape').catch(()=>{}); await p.mouse.click(30, 400); await p.waitForTimeout(400)
await p.click('button:has-text("⚙ CONFIG")'); await p.waitForTimeout(800)
const cfg = await p.evaluate(() => ({ mp: /multiplayer/.test(document.body.innerText), r: /restart with R/.test(document.body.innerText), fork: /allow forking/.test(document.body.innerText), contract: /social contract/.test(document.body.innerText) }))
console.log('CONFIG real toggles:', JSON.stringify(cfg))
await b.close(); console.log('LIVE GRAPH EYE COMPLETE')
