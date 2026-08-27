import { chromium } from 'playwright'
const b = await chromium.launch({ args:['--enable-unsafe-webgpu','--use-gl=angle'] })
for (const [name, w, h] of [['desktop', 1344, 800], ['phone', 390, 844]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
  await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {} })
  const p = await ctx.newPage()
  await p.goto('http://localhost:3131/design/unified', { waitUntil: 'networkidle' })
  await p.waitForTimeout(1200)
  await p.screenshot({ path: `/tmp/unified-${name}.png` })
  console.log(`${name} shot saved (${w}x${h})`)
  await ctx.close()
}
await b.close()
