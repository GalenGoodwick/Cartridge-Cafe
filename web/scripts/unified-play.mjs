import { chromium } from 'playwright'
const b = await chromium.launch({ args:['--enable-unsafe-webgpu','--use-gl=angle'] })
const ctx = await b.newContext({ viewport: { width: 1344, height: 800 }, deviceScaleFactor: 2 })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {} })
const p = await ctx.newPage()
await p.goto('http://localhost:3131/design/unified', { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
await p.screenshot({ path: '/tmp/uni-view.png' })
// click the rail (PLAY): x ~ 0.93*w, y ~ 0.5*h
await p.mouse.click(1344*0.93, 800*0.5)
await p.waitForTimeout(700)
await p.screenshot({ path: '/tmp/uni-play.png' })
// click EXIT: x ~ 0.957*w, y ~ 0.032*h
await p.mouse.click(1344*0.957, 800*0.032)
await p.waitForTimeout(700)
await p.screenshot({ path: '/tmp/uni-back.png' })
console.log('view/play/back shots saved')
await b.close()
