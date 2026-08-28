import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {} })
const p = await ctx.newPage()
await p.goto('http://localhost:3131/grid', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(3000)
const rect = () => p.evaluate(() => {
  const cv = document.querySelector('canvas'); const r = cv.getBoundingClientRect()
  return { w: Math.round(r.width), h: Math.round(r.height), fields: globalThis.__ccDevSim?.fields?.size ?? -1 }
})
const r1 = await rect()
console.log('BROWSE:', JSON.stringify(r1), r1.w < 800 ? '(shrunken ✓)' : '(NOT shrunken ✗)')
// switch preview → STARFIELD hot-swaps in
await p.click('text=STARFIELD'); await p.waitForTimeout(2500)
const r2 = await rect()
console.log('SWAPPED to STARFIELD:', JSON.stringify(r2), '· url:', await p.evaluate(() => new URL(location.href).searchParams.get('w')))
// CLICK THE GRID → play (expands)
await p.click('[aria-label^="play"]'); await p.waitForTimeout(600)
const r3 = await rect()
console.log('PLAY:', JSON.stringify(r3), r3.w > r2.w ? '(expanded ✓)' : '(no expand ✗)', '· ph:', await p.evaluate(() => new URL(location.href).searchParams.get('ph')))
// back to browse
await p.click('text=◱ GAMES'); await p.waitForTimeout(600)
const r4 = await rect()
console.log('BACK TO BROWSE:', JSON.stringify(r4), r4.w < r3.w ? '(shrunk ✓)' : '(✗)')
await b.close(); console.log('GAMES DOCK LOOP COMPLETE')
