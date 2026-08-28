import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1344, height: 800 }, deviceScaleFactor: 1 })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {} })
const p = await ctx.newPage()
await p.goto('http://localhost:3131/design/conversion', { waitUntil: 'domcontentloaded' })
// wait for the UI solve (proves the frame loop + solve ran) — NOT the world
let solved = 0
for (let i=0;i<40;i++){ solved = await p.evaluate(()=> (globalThis.__ccDevSim?.worldData?.__uiRects?.hits?.length ?? 0)); if (solved>0) break; await p.waitForTimeout(500) }
await p.waitForTimeout(3000)   // let a few frames paint
// sample the pixel where a pill should be (rail top-right ~ x1147 y95 css → device px same at dpr1)
const px = await p.evaluate(()=>{
  const cv = document.querySelector('canvas'); const g = cv.getContext ? null : null
  // read back via a 2d snapshot is not possible on webgpu canvas directly; use toDataURL fallback
  return { w: cv.width, h: cv.height }
})
console.log('ui hits:', solved, 'canvas', JSON.stringify(px))
await p.screenshot({ path: '/tmp/conv-clean.png' })
console.log('shot saved')
await b.close()
