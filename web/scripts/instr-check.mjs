import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {} })
const p = await ctx.newPage()
await p.goto('http://localhost:3131/grid', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(2500)
const info = await p.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].filter(x => /INSTRUCTIONS/.test(x.textContent||''))
  return btns.map(x => { const r = x.getBoundingClientRect(); const cs = getComputedStyle(x); return { txt: (x.textContent||'').slice(0,20), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), display: cs.display, vis: cs.visibility, opacity: cs.opacity } })
})
console.log(JSON.stringify(info, null, 1))
await b.close()
