import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {} })
const p = await ctx.newPage()
await p.goto('http://localhost:3131/grid?ui=engine', { waitUntil: 'domcontentloaded' })
await p.waitForSelector('button:has-text("◈ EYE · NODES")', { timeout: 20000 }); await p.waitForTimeout(1200)
await p.click('button:has-text("◈ EYE · NODES")'); await p.waitForTimeout(500)
console.log('EYE overlay:', await p.evaluate(() => /AI CONSOLE/.test(document.body.innerText) && /⬢ NODE TOOLS/.test(document.body.innerText)) ? '✓ console+nodes' : '✗')
await p.click('[aria-label="ui selector"]'); await p.waitForTimeout(300)   // dockstar wins
await p.click('[aria-label="ui selector"]'); await p.waitForTimeout(300)   // close menu
await p.click('button:has-text("⚙ WORLD CONFIG")'); await p.waitForTimeout(500)
console.log('CONFIG overlay:', await p.evaluate(() => /⚙ WORLD CONFIG/.test(document.body.innerText) && /SETTINGS/.test(document.body.innerText) && !/AI CONSOLE/.test(document.body.innerText)) ? '✓ settings only' : '✗')
await b.close(); console.log('SPLIT EYE COMPLETE')
