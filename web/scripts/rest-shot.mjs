import { chromium } from 'playwright'
const url = process.argv[2] || 'http://localhost:3131/design/conversion'
const out = process.argv[3] || '/tmp/conv-rest.png'
const vp = process.argv[4] === 'phone' ? { width: 412, height: 900 } : { width: 1344, height: 800 }
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2 })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override', '1') } catch {} })
const p = await ctx.newPage()
await p.goto(url, { waitUntil: 'domcontentloaded' })
let ok = false
for (let i = 0; i < 40; i++) { if (await p.evaluate(() => (globalThis.__ccDevSim?.fields?.size ?? 0) > 0)) { ok = true; break } await p.waitForTimeout(500) }
await p.waitForTimeout(2500)
await p.screenshot({ path: out })
console.log(ok ? 'shot: ' + out : 'world never loaded')
await b.close()
