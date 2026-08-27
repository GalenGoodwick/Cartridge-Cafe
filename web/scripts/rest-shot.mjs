import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1344, height: 800 }, deviceScaleFactor: 2 })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override', '1') } catch {} })
const p = await ctx.newPage()
await p.goto('http://localhost:3131/design/conversion', { waitUntil: 'domcontentloaded' })
for (let i = 0; i < 40; i++) {
  const ok = await p.evaluate(() => (globalThis.__ccDevSim?.fields?.size ?? 0) > 0)
  if (ok) break
  await p.waitForTimeout(500)
}
await p.waitForTimeout(2500)
await p.screenshot({ path: '/tmp/conv-rest.png' })
await b.close(); console.log('rest shot saved')
