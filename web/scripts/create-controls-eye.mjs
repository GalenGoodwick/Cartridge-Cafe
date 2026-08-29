// ✧ create rework + programmable controls + admin door
import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {} })
await ctx.route('**/api/admin/worlds', r => r.fulfill({ json: { worlds: [], spaces: [] } }))   // "I am admin"
const T = (n, ok) => console.log(`${ok ? '✓' : '✗'} ${n}`)
const p = await ctx.newPage()
p.on('dialog', d => d.dismiss().catch(() => {}))

// ═ CREATE: brew loads BLANK, facets morph the frame, born hands off ═
await p.goto('http://localhost:3000/grid?ui=create&w=CINDERFELL', { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForSelector('button:has-text("✧ OPEN THE CREATE FLOW")', { timeout: 30000 }); await p.waitForTimeout(2000)
const before = await p.evaluate(() => { const f = document.querySelector('div.fixed.pointer-events-none'); const r = f.getBoundingClientRect(); return { w: r.width, h: r.height } })
await p.click('button:has-text("✧ OPEN THE CREATE FLOW")'); await p.waitForTimeout(2500)
T('brew from nothing → BLANK world in frame', await p.evaluate(() => new URL(location.href).searchParams.get('w') === 'BLANK'))
T('flow iframe has NO base param', await p.evaluate(() => (document.querySelector('iframe[data-create-flow]')?.getAttribute('src') ?? '') === '/create'))
// the embedded page dropped BASE + renumbered
const flowTxt = await p.frameLocator('iframe[data-create-flow]').locator('body').textContent().catch(() => '')
T('create flow: BASE section gone, DIMENSIONS is 1', !/1 · BASE|FROM A FORMAT/.test(flowTxt) && /1 · DIMENSIONS/.test(flowTxt))
// pick MOBILE inside the iframe → the parent frame goes PORTRAIT
await p.frameLocator('iframe[data-create-flow]').locator('button:has-text("▯ MOBILE")').click()
await p.waitForTimeout(1200)
const after = await p.evaluate(() => { const f = document.querySelector('div.fixed.pointer-events-none'); const r = f.getBoundingClientRect(); return { w: r.width, h: r.height } })
T(`MOBILE facet → PORTRAIT frame (was ${before.w.toFixed(0)}×${before.h.toFixed(0)}, now ${after.w.toFixed(0)}×${after.h.toFixed(0)})`, after.h > after.w && before.w > before.h)
// birth message → parent lands in ENGINE on the new world (mock the space)
await ctx.route('**/api/spaces/newborn/**', r => r.fulfill({ json: {} }))
await ctx.route('**/api/spaces/newborn', r => r.fulfill({ json: { space: { id: 'sp_n', slug: 'newborn', name: 'NEWBORN', ownerId: 'u', owner: { id: 'u', name: 'G' }, isPublic: false } } }))
await ctx.route('**/api/spaces/newborn/snapshot**', r => r.fulfill({ json: { snapshot: { fields: [], worldData: {}, worldParams: {} } } }))
await p.evaluate(() => window.postMessage({ cc: 'create-born', slug: 'newborn' }, window.location.origin))
await p.waitForTimeout(1500)
T('create-born → ENGINE on the new world', await p.evaluate(() => {
  const u = new URL(location.href); return u.searchParams.get('w') === 'space:newborn' && u.searchParams.get('ui') === 'engine'
}))

// ═ ADMIN door ═
await p.evaluate(() => document.querySelector('button[aria-label="ui selector"]')?.click()); await p.waitForTimeout(600)
T('⛨ ADMIN door for admins → /admin', await p.evaluate(() => document.querySelector('a[data-grid-admin]')?.getAttribute('href') === '/admin'))
await p.keyboard.press('Escape')

// ═ PROGRAMMABLE CONTROLS: key: button holds a key, generic stick stands down ═
await p.goto('http://localhost:3000/grid?ui=games&ph=play&w=CINDERFELL', { waitUntil: 'domcontentloaded' })
await p.waitForSelector('canvas', { timeout: 30000 }); await p.waitForTimeout(4000)
await p.evaluate(() => {
  window.__ccDevSim.worldData.ui = { rev: 9, root: [
    { id: 'ctl', kind: 'panel', anchor: { vx: 0.5, vy: 0.95 }, align: 'bc', w: 200, glass: true, dir: 'row',
      children: [{ kind: 'button', id: 'jump', text: 'JUMP', click: 'key:space' }] },
  ] }
})
await p.waitForTimeout(1200)
const hit = await p.evaluate(() => {
  const r = window.__ccDevSim.worldData.__uiRects
  const h = r && r.hits && r.hits.find(x => x.action === 'key:space')
  if (!h) return null
  const cv = document.querySelector('canvas'); const cr = cv.getBoundingClientRect()
  const side = Math.min(cr.width, cr.height)
  return { x: cr.left + (cr.width - side) / 2 + (h.rect ? h.rect.x + h.rect.w / 2 : h.x + h.w / 2) * side / 512,
           y: cr.top + (cr.height - side) / 2 + (h.rect ? h.rect.y + h.rect.h / 2 : h.y + h.h / 2) * side / 512 }
})
T('key: button solved into the hit table', !!hit)
if (hit) {
  await p.mouse.move(hit.x, hit.y); await p.mouse.down(); await p.waitForTimeout(400)
  const held = await p.evaluate(() => window.__ccDevSim.worldData.key_space === true)
  await p.mouse.up(); await p.waitForTimeout(300)
  const released = await p.evaluate(() => window.__ccDevSim.worldData.key_space === false)
  T('press HOLDS key_space · release lets go', held && released)
  T('generic touch stick stands down (declared controls)', await p.evaluate(() => ![...document.querySelectorAll('[data-cc-chrome]')].some(el => el.className.includes('backdrop-blur-sm') && el.className.includes('rounded-full'))))
}
await b.close(); console.log('CREATE+CONTROLS EYE COMPLETE')
