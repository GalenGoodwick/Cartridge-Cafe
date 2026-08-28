import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {} })
const p = await ctx.newPage()
await p.goto('http://localhost:3131/grid?ui=engine', { waitUntil: 'domcontentloaded' })
await p.waitForSelector('button:has-text("◈ EYE")', { timeout: 20000 }); await p.waitForTimeout(1500)
// mini frame + under-area default EYE
const geo = await p.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { w: Math.round(r.width), top: Math.round(r.top) } })
console.log('ENGINE mini@top:', JSON.stringify(geo), geo.w < 700 && geo.top < 40 ? '✓' : '✗')
console.log('EYE default:', await p.evaluate(() => /THE EYE — what the AI does/.test(document.body.innerText)) ? '✓' : '✗')
for (const [btn, marker] of [['⬢ NODES','who builds what'],['⚙ CONFIG','WORLD CONFIG'],['◉ CHAT','THE ROOM'],['⚿ CONNECT AI','COPY THE PROMPT']]) {
  await p.click(`button:has-text("${btn}")`); await p.waitForTimeout(600)
  console.log(btn, '→', await p.evaluate(m => document.body.innerText.includes(m), marker) ? '✓' : '✗')
}
// nothing over the game: click the frame → play works from engine
await p.click('[aria-label^="play"]'); await p.waitForTimeout(600)
console.log('frame-click → play:', await p.evaluate(() => new URL(location.href).searchParams.get('ph')) === 'play' ? '✓' : '✗')
await b.close(); console.log('UNDER-AREA EYE COMPLETE')
