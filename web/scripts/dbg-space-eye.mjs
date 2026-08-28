import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addInitScript(() => { try { sessionStorage.setItem('cc-gate-override','1') } catch {}
  window.__eyeEvents = []
  window.addEventListener('cafe:eye', e => window.__eyeEvents.push(e.detail))
})
const SNAP = { snapshot: { fields: [], worldData: { instructions: 'mock' }, worldParams: {} } }
await ctx.route('**/api/spaces/testy', r => r.fulfill({ json: { space: { id: 'sp_1', slug: 'testy', name: 'TESTY', ownerId: 'u_me', owner: { id: 'u_me', name: 'Galen' }, isPublic: true } } }))
await ctx.route('**/api/auth/session', r => r.fulfill({ json: { user: { id: 'u_me', name: 'Galen', email: 'g@x' } } }))
await ctx.route('**/api/spaces/testy/**', r => {
  const u = r.request().url()
  if (u.includes('/snapshot')) return r.fulfill({ json: SNAP })
  if (u.includes('/versions')) return r.fulfill({ json: { versions: [] } })
  return r.fulfill({ json: {} })
})
const p = await ctx.newPage()
p.on('console', m => { const t = m.text(); if (/error|Error|fail/i.test(t) && !/favicon|404/.test(t)) console.log('PAGE:', t.slice(0,180)) })
p.on('pageerror', e => console.log('PAGEERR:', String(e).slice(0,200)))
await p.goto('http://localhost:3131/grid?ui=engine&w=space:testy', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(7000)
console.log(await p.evaluate(() => ({
  canvases: document.querySelectorAll('canvas').length,
  eyeEvents: window.__eyeEvents.length,
  lastCfg: window.__eyeEvents.at(-1)?.config ?? null,
  bodyHas: { config: /⚙ CONFIG/.test(document.body.innerText), frame: /TESTY/.test(document.body.innerText) },
})))
await b.close()
