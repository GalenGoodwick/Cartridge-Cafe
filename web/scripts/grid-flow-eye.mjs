import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {} })
const p = await ctx.newPage()
await p.goto('http://localhost:3131/grid', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(3000)
for (const preset of ['FULL','WIDE','SQUARE','TALL','MINI']) {
  await p.click(`text=${preset}`)
  await p.waitForTimeout(450)   // let the 0.32s ease settle
  const m = await p.evaluate(() => {
    const cv = document.querySelector('canvas')
    const frame = [...document.querySelectorAll('div')].find(d => d.style.border?.includes('80, 200, 255'))
    const cr = cv.getBoundingClientRect(), fr = frame?.getBoundingClientRect()
    return {
      canvas: { x: Math.round(cr.x), y: Math.round(cr.y), w: Math.round(cr.width), h: Math.round(cr.height) },
      frame: fr ? { x: Math.round(fr.x), y: Math.round(fr.y), w: Math.round(fr.width), h: Math.round(fr.height) } : null,
      buffer: { w: cv.width, h: cv.height },
      aligned: fr ? Math.abs(cr.x - fr.x) <= 2 && Math.abs(cr.width - fr.width) <= 3 : false,
    }
  })
  console.log(preset.padEnd(7), `canvas ${m.canvas.w}x${m.canvas.h}`, `buffer ${m.buffer.w}x${m.buffer.h}`, m.aligned ? 'FRAME ALIGNED ✓' : `FRAME OFF (${JSON.stringify(m.frame)})`)
}
await p.click('text=MINI'); await p.waitForTimeout(500)
await p.screenshot({ path: '/tmp/grid-mini.png' })
await p.click('text=WIDE'); await p.waitForTimeout(500)
await p.screenshot({ path: '/tmp/grid-wide.png' })
await b.close(); console.log('shots: /tmp/grid-mini.png /tmp/grid-wide.png')
