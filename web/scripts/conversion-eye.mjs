// THE CONVERSION EYE — screenshot a real world on the preview: is the chrome
// engine pixels? Desktop + phone instances.
import { chromium } from 'playwright'
const base = process.argv[2]
const slug = process.argv[3] || 'cinderfell'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal'] })
for (const [tag, w, h, dpr] of [['desktop', 1344, 800, 2], ['phone', 390, 844, 2]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr })
  await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override', '1') } catch {} })
  const p = await ctx.newPage()
  const errs = []
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)) })
  await p.goto(`${base}/space/${slug}`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => errs.push(e.message))
  await p.waitForTimeout(9000)
  const state = await p.evaluate(() => ({
    canvases: [...document.querySelectorAll('canvas')].map(c => ({ w: c.width, h: c.height })),
    domChrome: {
      builderboxPill: !!(document.body.innerText.match(/BUILDERBOX/) && [...document.querySelectorAll('button')].some(b2 => /BUILDERBOX/.test(b2.textContent || ''))),
      playBtn: [...document.querySelectorAll('button')].some(b2 => /⛶ PLAY/.test(b2.textContent || '')),
      topbarTitle: [...document.querySelectorAll('div,span')].some(el => el.childElementCount === 0 && /·/.test(el.textContent || '') && el.closest('[class*="fixed"]') !== null),
    },
  }))
  console.log(tag, JSON.stringify({ errs: errs.slice(0, 3), canvases: state.canvases.length, domChrome: state.domChrome }))
  await p.screenshot({ path: `/tmp/conv-${tag}.png` })
  await ctx.close()
}
await b.close()
console.log('shots: /tmp/conv-desktop.png /tmp/conv-phone.png')
