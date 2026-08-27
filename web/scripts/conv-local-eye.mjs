import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'] })
for (const [tag, w, h] of [['desktop', 1344, 800], ['phone', 390, 844]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
  await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override', '1') } catch {} })
  const p = await ctx.newPage()
  const errs = []
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 100)) })
  await p.goto('http://localhost:3131/design/conversion', { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(8000)
  const st = await p.evaluate(() => ({
    canvases: document.querySelectorAll('canvas').length,
    domPlay: [...document.querySelectorAll('button')].some(x => /⛶ PLAY/.test(x.textContent || '')),
    domBox: [...document.querySelectorAll('button')].some(x => /BUILDERBOX/.test(x.textContent || '')),
  }))
  console.log(tag, JSON.stringify({ errs: errs.slice(0, 3), ...st }))
  await p.screenshot({ path: `/tmp/conv-${tag}.png` })
  await ctx.close()
}
await b.close()
console.log('done')
