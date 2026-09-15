// WORLD TAB SHOT — photograph what a REAL browser tab shows for any world at
// any window size (the viewport-scope instrument; same playwright+WebGPU
// pattern as the *-tab-eye family). Usage:
//   node scripts/world-tab-shot.mjs <url> <out.png> [WxH] [waitMs]
import { chromium } from 'playwright'
const [url, out, size = '1600x1000', wait = '12000'] = process.argv.slice(2)
if (!url || !out) { console.error('usage: node scripts/world-tab-shot.mjs <url> <out.png> [WxH] [waitMs]'); process.exit(2) }
const [width, height] = size.split('x').map(Number)
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
const p = await ctx.newPage()
await p.goto(url, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(Number(wait))
try { await p.click('text=CLICK TO PLAY', { timeout: 3000 }); await p.waitForTimeout(4000) } catch {}
await p.screenshot({ path: out })
await b.close()
console.log('captured', out, `${width}x${height}`)
