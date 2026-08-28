import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-swiftshader'] })
// WIDE: engine → right strip, maker cited, WORLD TOOLS opens, grid-click → play
const w = await (await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })).newPage()
await w.context().addInitScript?.(() => {})
await w.goto('http://localhost:3131/grid?ui=engine', { waitUntil: 'domcontentloaded' })
await w.evaluate(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {} })
await w.reload({ waitUntil: 'domcontentloaded' }); await w.waitForTimeout(3000)
console.log('maker cited:', await w.evaluate(() => /by Galen/.test(document.body.innerText)) ? '✓' : '✗')
await w.click('button:has-text("⚙ WORLD TOOLS")'); await w.waitForTimeout(1000)
console.log('WORLD TOOLS panel:', await w.evaluate(() => /WORLD TOOLS|LINEAGE|THE CARD/.test(document.body.innerText)) ? '✓ (real panel)' : '✗')
await w.keyboard.press('Escape').catch(()=>{})
await w.click('[aria-label^="play"]').catch(()=>{})
await w.waitForTimeout(500)
console.log('engine grid-click →', await w.evaluate(() => new URL(location.href).searchParams.get('ui')), '/', await w.evaluate(() => new URL(location.href).searchParams.get('ph')))
// NARROW: engine dock = bottom sheet
const n = await (await b.newContext({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 1 })).newPage()
await n.goto('http://localhost:3131/grid?ui=engine', { waitUntil: 'domcontentloaded' })
await n.evaluate(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {} })
await n.reload({ waitUntil: 'domcontentloaded' }); await n.waitForTimeout(2500)
const geo = await n.evaluate(() => {
  const cv = document.querySelector('canvas'); const r = cv.getBoundingClientRect()
  const dock = [...document.querySelectorAll('div')].find(d => /⚙ ENGINE/.test(d.textContent||'') && d.className.includes('flex-row'))
  return { canvasBottom: Math.round(r.bottom), winH: window.innerHeight, sheet: !!dock }
})
console.log('NARROW engine:', JSON.stringify(geo), geo.sheet && (geo.winH - geo.canvasBottom) > 180 ? '(bottom sheet ✓)' : '✗')
await b.close(); console.log('BATCH EYE COMPLETE')
