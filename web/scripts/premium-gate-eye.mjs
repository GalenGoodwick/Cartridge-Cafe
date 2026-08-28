// ✦ THE PREMIUM GATE eye — preview free, pay to play, owned opens.
import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {} })
const T = (n, ok) => console.log(`${ok ? '✓' : '✗'} ${n}`)
let owned = false
const SNAP = { snapshot: { fields: [], worldData: { instructions: 'mock' }, worldParams: {} } }
await ctx.route('**/api/spaces/prem/**', r => r.fulfill({ json: {} }))
await ctx.route('**/api/spaces/prem', r => r.fulfill({ json: { space: { id: 'sp_9', slug: 'prem', name: 'PREMY', ownerId: 'u_other', owner: { id: 'u_other', name: 'Maker' }, isPublic: true } } }))
await ctx.route('**/api/spaces/prem/snapshot**', r => r.fulfill({ json: SNAP }))
await ctx.route('**/api/auth/session', r => r.fulfill({ json: { user: { id: 'u_me', name: 'Galen', email: 'g@x' } } }))
await ctx.route('**/api/premium?slug=prem', r => r.fulfill({ json: { premium: { usd: 5, demoSeconds: 60, coProgram: true }, owned, signedIn: true, buyable: true } }))
let checkoutHit = false
await ctx.route('**/api/premium', r => {
  if (r.request().method() === 'POST') { checkoutHit = true; owned = true; return r.fulfill({ json: { url: 'http://localhost:3131/grid?ui=games&w=space:prem&paid=experience' } }) }
  return r.fallback()
})
const p = await ctx.newPage()
await p.goto('http://localhost:3131/grid?ui=games&w=space:prem', { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForSelector('button[aria-label^="play"]', { timeout: 30000 }); await p.waitForTimeout(2500)
T('premium world PREVIEWS free (no gate in browse)', await p.evaluate(() => !document.body.innerText.includes('✦ PREMIUM WORLD')))
await p.click('button[aria-label^="play"]'); await p.waitForTimeout(1200)
const gate = await p.evaluate(() => ({
  up: document.body.innerText.includes('✦ PREMIUM WORLD') && /BUY & PLAY — \$5/.test(document.body.innerText),
  stillBrowse: new URL(location.href).searchParams.get('ph') !== 'play',
}))
T('click-to-play while unpaid → payment gate (play blocked)', gate.up && gate.stillBrowse)
// buy → mocked checkout round-trips straight back with ?paid=experience
await p.click('[data-prem-buy]'); await p.waitForTimeout(1500)
T('BUY posts checkout + redirects', checkoutHit)
await p.waitForFunction(() => new URL(location.href).searchParams.get('ph') === 'play', null, { timeout: 15000 })
T('checkout return (owned) → world OPENS', true)
// owned now: direct click opens with no gate
await p.goto('http://localhost:3131/grid?ui=games&w=space:prem', { waitUntil: 'domcontentloaded' })
await p.waitForSelector('button[aria-label^="play"]', { timeout: 30000 }); await p.waitForTimeout(2000)
await p.click('button[aria-label^="play"]'); await p.waitForTimeout(1500)
T('owned: click just opens (no gate)', await p.evaluate(() => new URL(location.href).searchParams.get('ph') === 'play' && !document.body.innerText.includes('✦ PREMIUM WORLD')))
// deep-link belt: unpaid direct ?ph=play gets kicked to the gate
owned = false
await p.goto('http://localhost:3131/grid?ui=games&ph=play&w=space:prem', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(3000)
T('deep-link belt: unpaid ?ph=play → gate, play revoked', await p.evaluate(() =>
  document.body.innerText.includes('✦ PREMIUM WORLD') && new URL(location.href).searchParams.get('ph') !== 'play'))
await b.close(); console.log('PREMIUM GATE EYE COMPLETE')
