// mobile pass: dockstar centered+primary · phone trims · games-only mobile ·
// engine sans instructions · create iframe actually loads (CSP self)
import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-swiftshader'] })
const T = (n, ok) => console.log(`${ok ? '✓' : '✗'} ${n}`)

// ── desktop ──
const d = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
await d.goto('http://localhost:3000/grid?ui=games&w=CINDERFELL', { waitUntil: 'domcontentloaded', timeout: 60000 })
await d.waitForSelector('button[aria-label="ui selector"]', { timeout: 30000 }); await d.waitForTimeout(1500)
const cupC = await d.evaluate(() => { const r = document.querySelector('button[aria-label="ui selector"]').getBoundingClientRect(); return Math.abs((r.left + r.width / 2) - window.innerWidth / 2) })
T('desktop: dockstar dead-center (' + cupC.toFixed(1) + 'px off)', cupC < 2)
await d.goto('http://localhost:3000/grid?ui=engine&w=CINDERFELL', { waitUntil: 'domcontentloaded' }); await d.waitForTimeout(2000)
T('engine: no INSTRUCTIONS button', await d.evaluate(() => !document.body.innerText.includes('? INSTRUCTIONS')))
// create iframe loads real content now (CSP frame-ancestors self)
await d.goto('http://localhost:3000/grid?ui=create&w=CINDERFELL', { waitUntil: 'domcontentloaded' })
await d.waitForSelector('button:has-text("✧ OPEN THE CREATE FLOW")', { timeout: 30000 })
await d.click('button:has-text("✧ OPEN THE CREATE FLOW")'); await d.waitForTimeout(3500)
const frameLen = await d.frameLocator('iframe[data-create-flow]').locator('body').textContent().then(t => (t || '').trim().length).catch(() => -1)
T('create flow iframe loads content (' + frameLen + ' chars)', frameLen > 100)

// ── phone (375×740, touch) ──
const mctx = await b.newContext({ viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' })
const m = await mctx.newPage()
await m.goto('http://localhost:3000/grid?ui=engine&w=CINDERFELL', { waitUntil: 'domcontentloaded', timeout: 60000 })
await m.waitForSelector('button[aria-label="ui selector"]', { timeout: 30000 }); await m.waitForTimeout(2500)
T('mobile: engine set allowed (reversal)', await m.evaluate(() => new URL(location.href).searchParams.get('ui') === 'engine'))
const mm = await m.evaluate(() => {
  const cup = document.querySelector('button[aria-label="ui selector"]')
  const r = cup.getBoundingClientRect()
  return {
    off: Math.abs((r.left + r.width / 2) - window.innerWidth / 2),
    w: r.width, visible: r.width >= 46 && r.height >= 46 && r.right <= window.innerWidth,
    title: !!document.querySelector('[data-grid-title]'),
    rec: !!document.querySelector('[data-grid-rec]'),
  }
})
T('mobile: dockstar centered (' + mm.off.toFixed(1) + 'px off) + full size', mm.off < 2 && mm.visible)
T('mobile: no title, no REC', !mm.title && !mm.rec)
await m.click('button[aria-label="ui selector"]', { force: true }); await m.waitForTimeout(600)
const menu = await m.evaluate(() => ['GAMES', 'MAIN', 'ENGINE', 'CREATE'].every(t => document.body.innerText.includes(t)))
T('mobile menu: all four sets (reversal)', menu)
// touch controls inside the frame in play
await m.goto('http://localhost:3000/grid?ui=games&ph=play&w=CINDERFELL', { waitUntil: 'domcontentloaded' }); await m.waitForTimeout(4000)
const tc = await m.evaluate(() => {
  const stick = [...document.querySelectorAll('[data-cc-chrome]')].find(el => el.className.includes('rounded-full') && el.className.includes('backdrop-blur-sm'))
  if (!stick) return { there: false }
  const r = stick.getBoundingClientRect()
  const barTop = window.innerHeight - 64
  return { there: true, insideBar: r.bottom <= barTop + 2, onscreen: r.left >= 0 && r.right <= window.innerWidth }
})
T('mobile: touch stick INSIDE the frame (above the bar)', tc.there && tc.insideBar && tc.onscreen)
await b.close(); console.log('MOBILE BAR EYE COMPLETE')
