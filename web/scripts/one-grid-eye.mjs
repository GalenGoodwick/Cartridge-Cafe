import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {} })
const p = await ctx.newPage()
await p.goto('http://localhost:3131/one', { waitUntil: 'domcontentloaded' })
// home cartridge + catalog pills solved?
let hits = []
for (let i=0;i<40;i++){
  hits = await p.evaluate(() => (globalThis.__ccDevSim?.worldData?.__uiRects?.hits ?? []).filter(h=>h.action?.startsWith('shell:open:')||h.action==='shell:grid'))
  if (hits.length) break
  await p.waitForTimeout(500)
}
const homeFields = await p.evaluate(() => globalThis.__ccDevSim?.fields?.size ?? 0)
console.log('HOME fields:', homeFields, '· catalog pills:', hits.length, hits.slice(0,3).map(h=>h.action).join(' '))
// click the first pill → world hot-swaps INTO the same canvas
const h = hits[0]
await p.evaluate((hit) => {
  const cv = document.querySelector('canvas'); const r = cv.getBoundingClientRect()
  const side = Math.min(r.width, r.height)
  const cx = r.left + (r.width - side)/2 + (hit.x + hit.w/2) * side/512
  const cy = r.top + (r.height - side)/2 + (hit.y + hit.h/2) * side/512
  cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, bubbles: true, cancelable: true, pointerId: 1, isPrimary: true }))
}, h)
await p.waitForTimeout(4000)
const after = await p.evaluate(() => ({
  url: location.search,
  fields: globalThis.__ccDevSim?.fields?.size ?? 0,
  canvases: document.querySelectorAll('canvas').length,
  backPill: (globalThis.__ccDevSim?.worldData?.__uiRects?.hits ?? []).some(h=>h.action==='shell:grid'),
}))
console.log('AFTER SWAP:', JSON.stringify(after))
await b.close()
console.log(after.canvases === 1 && after.backPill ? 'ONE GRID: swap verified, one canvas, linkable' : 'CHECK NEEDED')
