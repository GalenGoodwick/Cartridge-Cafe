// THE DELETE-WORLD EYE — the ✕ DELETE control in CONFIG + its confirm popup.
// Part A (REAL, no mocks): mint an owner session, create a THROWAWAY world,
// drive the real ✕ DELETE → confirm popup → cancel (survives) → DELETE FOREVER
// (gone, navigates to the hub). Part B (mock): a non-owner never sees the button.
import { chromium } from 'playwright'
import { encode } from 'next-auth/jwt'
import { readFileSync, existsSync } from 'fs'

const env = ['.env', '.env.local'].filter(existsSync).flatMap(f => readFileSync(f, 'utf8').split('\n'))
const SECRET = env.find(l => l.startsWith('NEXTAUTH_SECRET='))?.slice('NEXTAUTH_SECRET='.length).replace(/^"|"$/g, '')
const BASE = process.env.EYE_BASE || 'http://localhost:3141'
const UID = 'cmrjg9c0300009lufwk5tjoxb', EMAIL = 'galen.goodwick@gmail.com'
const ORIGIN = { headers: { origin: BASE } }

const token = await encode({ token: { name: 'Galen Goodwick', email: EMAIL, sub: UID, id: UID }, secret: SECRET, maxAge: 3600 })
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-vulkan=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await b.newContext({ viewport: { width: 1200, height: 860 } })
await ctx.addCookies([{ name: 'next-auth.session-token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }])
const p = await ctx.newPage()
p.on('dialog', d => d.dismiss().catch(() => {}))
let pass = 0, fail = 0
const T = (n, ok) => { console.log(`${ok ? '✓' : '✗'} ${n}`); ok ? pass++ : fail++ }
const body = () => p.evaluate(() => document.body.innerText)
const spriteExists = async slug => (await ctx.request.get(`${BASE}/api/spaces/${slug}`)).status()

// ── create a throwaway world to destroy ──
const NAME = 'zzz del test world'
const mk = await ctx.request.post(`${BASE}/api/spaces`, { ...ORIGIN, data: { name: NAME, draft: true } })
const mkd = await mk.json().catch(() => ({}))
const slug = mkd?.space?.slug ?? mkd?.slug
T('created a throwaway world to delete', mk.ok() && !!slug)
if (!slug) { console.log('cannot proceed without a slug'); await b.close(); process.exit(1) }
console.log('  throwaway slug:', slug)

await p.goto(`${BASE}/grid?ui=engine&w=space:${slug}`, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(3500)
await p.locator('button', { hasText: '⚙ CONFIG' }).first().click()
await p.waitForTimeout(1000)
T('owner sees ✕ DELETE in CONFIG', await p.locator('button', { hasText: '✕ DELETE' }).count() > 0)

// open the confirm popup
await p.locator('button', { hasText: '✕ DELETE' }).first().click()
await p.waitForTimeout(500)
let t = await body()
T('confirm popup appears (DELETE WORLD + the slug)', t.includes('DELETE WORLD') && t.includes(slug))
T('popup warns it can’t be undone', t.includes('can’t be undone'))

// CANCEL → world survives
await p.locator('button', { hasText: 'cancel' }).first().click()
await p.waitForTimeout(500)
T('cancel closes the popup', !(await body()).includes('DELETE FOREVER'))
T('after cancel the world still exists (200)', await spriteExists(slug) === 200)

// really delete
await p.locator('button', { hasText: '✕ DELETE' }).first().click()
await p.waitForTimeout(400)
await p.locator('button', { hasText: 'DELETE FOREVER' }).first().click()
// wait for the hub navigation
let navved = false
for (let i = 0; i < 20 && !navved; i++) { await p.waitForTimeout(400); navved = new URL(p.url()).search === '' && new URL(p.url()).pathname === '/grid' }
T('DELETE FOREVER navigates back to the hub (/grid)', navved)
T('the world is really gone (404)', await spriteExists(slug) === 404)

// safety: if it somehow survived, clean it up
if (await spriteExists(slug) !== 404) await ctx.request.delete(`${BASE}/api/spaces/${slug}`, ORIGIN).catch(() => {})

// ── Part B: a NON-owner never sees ✕ DELETE ──
await ctx.route('**/api/spaces/notmine**', r => r.fulfill({ json: { space: { id: 'sp_x', slug: 'notmine', name: 'NOTMINE', ownerId: 'u_boss', owner: { id: 'u_boss', name: 'Someone' }, isPublic: true } } }))
await ctx.route('**/api/spaces/notmine/snapshot**', r => r.fulfill({ json: { snapshot: { fields: [], worldData: {}, worldParams: {} } } }))
await ctx.route('**/api/spaces/notmine/**', r => r.fulfill({ json: {} }))
await p.goto(`${BASE}/grid?ui=engine&w=space:notmine`, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(3000)
await p.locator('button', { hasText: '⚙ CONFIG' }).first().click()
await p.waitForTimeout(800)
T('non-owner does NOT see ✕ DELETE', await p.locator('button', { hasText: '✕ DELETE' }).count() === 0)

console.log(`\n${pass} ✓  ${fail} ✗`)
await b.close()
process.exit(fail ? 1 : 0)
