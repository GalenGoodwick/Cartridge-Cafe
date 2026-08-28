import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {} })
const p = await ctx.newPage()
await p.goto('http://localhost:3131/grid?ui=engine', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(3000)
await p.click('button:has-text("⌁ BUILDERBOX")'); await p.waitForTimeout(1000)
const open1 = await p.evaluate(() => /BUILDERBOX/.test(document.body.innerText) && [...document.querySelectorAll('div')].some(d => /build log|world chat|terminal/i.test(d.textContent||'') && d.getBoundingClientRect().height > 100))
console.log('builderbox open in engine:', open1 ? '✓' : '?')
// grid-click → play: panels must close
await p.click('[aria-label^="play"]'); await p.waitForTimeout(800)
const after = await p.evaluate(() => ({
  ph: new URL(location.href).searchParams.get('ph'),
  boxStill: [...document.querySelectorAll('div')].some(d => /BUILDERBOX/.test(d.textContent||'') && /build log|entries summon/i.test(d.textContent||'') && d.getBoundingClientRect().height > 100),
  share: [...document.querySelectorAll('button')].some(x => /↗ SHARE/.test(x.textContent||'')),
}))
console.log('after grid-click:', JSON.stringify(after), !after.boxStill && after.share ? '(box closed ✓ · SHARE present ✓)' : '✗')
await b.close(); console.log('HYGIENE EYE COMPLETE')
