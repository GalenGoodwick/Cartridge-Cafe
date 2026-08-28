import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {} })
const p = await ctx.newPage()
await p.goto('http://localhost:3131/grid', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(2500)
for (const preset of ['WIDE','TALL','MINI']) {
  await p.click(`text=${preset}`); await p.waitForTimeout(500)
  const m = await p.evaluate(() => {
    const star = document.querySelector('[aria-label="ui selector"]')
    const frame = [...document.querySelectorAll('div')].find(d => d.style.border?.includes('80, 200, 255'))
    const sr = star.getBoundingClientRect(), fr = frame.getBoundingClientRect()
    return { starInCorner: Math.abs((fr.right - 8) - sr.right) < 3 && Math.abs((fr.top + 8) - sr.top) < 3 }
  })
  console.log(preset, m.starInCorner ? 'DOCKSTAR RIDES THE CORNER ✓' : 'OFF CORNER ✗')
}
await p.click('[aria-label="ui selector"]'); await p.waitForTimeout(300)
const menu = await p.evaluate(() => [...document.querySelectorAll('button')].filter(b => /GAMES|MAIN|ENGINE|CREATE/.test(b.textContent||'')).length)
console.log('selector sets visible:', menu)
await b.close()
