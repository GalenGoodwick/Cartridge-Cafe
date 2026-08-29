// DEAD-BUTTON AUDIT — click every button in the ENGINE set; a button is
// SUSPECT if nothing observable changes (DOM text, URL, overlays, events).
import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:3000' })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {}
  window.__evts = 0
  for (const ev of ['cafe:shell-cmd','cafe:eye','cafe:rec','cafe:ai-log']) window.addEventListener(ev, () => window.__evts++)
})
const SNAP = { snapshot: { fields: [], worldData: { instructions: 'mock', policy: { build: 'anyone' } }, worldParams: {} } }
await ctx.route('**/api/spaces/testy/**', r => r.fulfill({ json: {} }))
await ctx.route('**/api/spaces/testy', r => r.fulfill({ json: { space: { id: 'sp_1', slug: 'testy', name: 'TESTY', ownerId: 'u_me', owner: { id: 'u_me', name: 'Galen' }, isPublic: true } } }))
await ctx.route('**/api/auth/session', r => r.fulfill({ json: { user: { id: 'u_me', name: 'Galen', email: 'g@x' } } }))
await ctx.route('**/api/spaces/testy/snapshot**', r => r.fulfill({ json: SNAP }))
await ctx.route('**/api/spaces/testy/versions', r => r.fulfill({ json: { versions: [{ version: 1, note: null, createdAt: '2026-08-01T00:00:00Z' }] } }))
await ctx.route('**/api/spaces/testy/invite', r => r.fulfill({ json: { joinUrl: 'http://x/j' } }))
await ctx.route('**/api/spaces/testy/token', r => r.fulfill({ json: { token: 'uc_st_m', tokens: [] } }))
await ctx.route('**/api/spaces/testy/sprites**', r => r.fulfill({ json: { sprites: [] } }))
await ctx.route('**/api/cards?tab=live', r => r.fulfill({ json: { cards: [] } }))
await ctx.route('**/api/cards?tab=mine', r => r.fulfill({ json: { cards: [] } }))
const p = await ctx.newPage()
p.on('dialog', d => d.dismiss().catch(() => {}))

const TABS = ['◈ EYE', '⌁ CONSOLE', '⬢ NODES', '⛭ CO-BUILD', '⏱ VERSIONS', '⚙ CONFIG', '⬆ PUBLISH', '◉ CHAT', '⌂ MY WORLDS', '⚿ CONNECT AI']
await p.goto('http://localhost:3000/grid?ui=engine&w=space:testy', { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForSelector('button:has-text("⚙ CONFIG")', { timeout: 30000 }); await p.waitForTimeout(4000)

const suspects = []
for (const tab of TABS) {
  await p.evaluate(t => { [...document.querySelectorAll('button')].find(x => x.textContent.trim() === t)?.click() }, tab).catch(() => {})
  await p.waitForTimeout(700)
  const labels = await p.evaluate(() => {
    // buttons INSIDE the under-area content box only (below the mini frame)
    const area = [...document.querySelectorAll('div')].find(d => d.className.includes('max-w-[860px]'))
    if (!area) return []
    return [...area.querySelectorAll('button')].filter(b => !b.disabled).map((b, i) => ({ i, t: (b.textContent || '').trim().slice(0, 34) }))
  })
  for (const { t } of labels) {
    if (!t) continue
    const before = await p.evaluate(() => ({ txt: document.body.innerText.length, url: location.href, ev: window.__evts }))
    await p.evaluate(lbl => {
      const area = [...document.querySelectorAll('div')].find(d => d.className.includes('max-w-[860px]'))
      const btn = area && [...area.querySelectorAll('button')].find(x => (x.textContent || '').trim().slice(0, 34) === lbl && !x.disabled)
      btn?.click()
    }, t)
    await p.waitForTimeout(500)
    const after = await p.evaluate(() => ({ txt: document.body.innerText.length, url: location.href, ev: window.__evts }))
    const changed = before.txt !== after.txt || before.url !== after.url || before.ev !== after.ev
    if (!changed) suspects.push(`${tab} › "${t}"`)
    // recover: if we navigated to play or elsewhere, come back
    if (!(await p.evaluate(() => new URL(location.href).searchParams.get('ui') === 'engine'))) {
      await p.goto('http://localhost:3000/grid?ui=engine&w=space:testy', { waitUntil: 'domcontentloaded' })
      await p.waitForTimeout(2500)
      await p.evaluate(tb => { [...document.querySelectorAll('button')].find(x => x.textContent.trim() === tb)?.click() }, tab)
      await p.waitForTimeout(600)
    }
  }
}
console.log('SUSPECT (no observable effect):')
for (const sx of suspects) console.log('  ✗', sx)
if (!suspects.length) console.log('  (none)')
await b.close(); console.log('DEAD-BUTTON AUDIT COMPLETE')
