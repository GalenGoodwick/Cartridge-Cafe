import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {} })
const T = (n, ok) => console.log(`${ok ? '✓' : '✗'} ${n}`)
// a mouse-look space (veilfire-shaped): __mouseLook in worldData
const SNAP = { snapshot: { fields: [], worldData: { __mouseLook: 1, instructions: 'fps' }, worldParams: {} } }
await ctx.route('**/api/spaces/vf/**', r => r.fulfill({ json: {} }))
await ctx.route('**/api/spaces/vf', r => r.fulfill({ json: { space: { id: 'sp_v', slug: 'vf', name: 'VF', ownerId: 'u_o', owner: { id: 'u_o', name: 'G' }, isPublic: true } } }))
await ctx.route('**/api/spaces/vf/snapshot**', r => r.fulfill({ json: SNAP }))
await ctx.route('**/api/auth/session', r => r.fulfill({ json: {} }))
await ctx.route('**/api/premium?slug=vf', r => r.fulfill({ json: { premium: null, owned: true } }))
const p = await ctx.newPage()
p.on('console', m => { if (/pointer/i.test(m.text())) console.log('PAGE:', m.text().slice(0, 120)) })
// ── engine bar contents (the "screwy lineage button" hunt) ──
await p.goto('http://localhost:3131/grid?ui=engine&w=CINDERFELL', { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForSelector('button[aria-label="ui selector"]', { timeout: 30000 }); await p.waitForTimeout(2500)
console.log('ENGINE BAR:', await p.evaluate(() => {
  const bar = document.querySelector('button[aria-label="ui selector"]').closest('div').parentElement
  return [...bar.querySelectorAll('button,a')].map(el => (el.getAttribute('aria-label') || el.textContent.trim()).slice(0, 30))
}))
// ── mouse-look click-to-bind in the grid's play phase ──
await p.goto('http://localhost:3131/grid?ui=games&ph=play&w=space:vf', { waitUntil: 'domcontentloaded' })
await p.waitForSelector('canvas', { timeout: 30000 }); await p.waitForTimeout(4500)  // > the 600ms entry gate
// __* keys are STRIPPED on snapshot import — real veilfire's hook sets this each
// tick; the dev hatch stands in for the hook here
await p.evaluate(() => { window.__ccDevSim.worldData.__mouseLook = 1 })
console.log('  · at click point:', await p.evaluate(() => document.elementFromPoint(640, 400)?.tagName + '.' + (document.elementFromPoint(640, 400)?.className || '').toString().slice(0, 60)))
await p.evaluate(() => {
  document.addEventListener('pointerlockerror', () => console.log('PLERR'))
  window.__pdSeen = 0
  document.querySelector('canvas').addEventListener('pointerdown', () => { window.__pdSeen++ }, true)
})
await p.mouse.click(640, 400); await p.waitForTimeout(600)
console.log('  · pointerdown reached canvas:', await p.evaluate(() => window.__pdSeen))
console.log('  · direct requestPointerLock:', await p.evaluate(async () => {
  try { const r = document.querySelector('canvas').requestPointerLock(); if (r && r.then) await r; return 'ok:' + (document.pointerLockElement?.tagName ?? 'none') } catch (e) { return 'threw: ' + e.message }
}))
T('click binds the cursor (pointer lock on canvas)', await p.evaluate(() => document.pointerLockElement?.tagName === 'CANVAS'))
// ── the REAL lineage in attribution ──
await ctx.route('**/api/engine/lineage/trail?space=vf', r => r.fulfill({ json: { trail: [{ name: 'ROOTLING', slug: 'rootling', kind: 'space' }, { name: 'VF', slug: 'vf', kind: 'space' }], remixes: [{ name: 'VF-REMIX', slug: 'vfr' }] } }))
await p.goto('http://localhost:3131/grid?ui=games&w=space:vf', { waitUntil: 'domcontentloaded' })
await p.waitForSelector('[data-grid-title]', { timeout: 30000 }); await p.waitForTimeout(1500)
await p.click('[data-grid-title]', { force: true }); await p.waitForTimeout(1200)
const lin = await p.evaluate(() => document.querySelector('[data-attrib-lineage]')?.textContent ?? '')
T('attribution shows the REAL trail + forks', /ROOTLING/.test(lin) && /VF/.test(lin) && /forks: VF-REMIX/.test(lin) && !/wires to the lineage store/.test(lin))
await b.close(); console.log('VF/LINEAGE EYE COMPLETE')
