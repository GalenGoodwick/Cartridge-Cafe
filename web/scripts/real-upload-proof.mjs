// REAL UPLOAD PROOF — no mocks. Mint a genuine owner session (NextAuth JWT),
// drive the ◲ ASSETS tab's real file input + RIP button against a real DB
// world (blank-2d), then confirm the sheet persisted through the REAL route
// (GET returns meta) and clean up (DELETE) so the sandbox stays blank.
import { chromium } from 'playwright'
import { encode } from 'next-auth/jwt'
import { readFileSync, existsSync } from 'fs'

const env = ['.env', '.env.local'].filter(existsSync).flatMap(f => readFileSync(f, 'utf8').split('\n'))
const get = k => env.find(l => l.startsWith(k + '='))?.slice(k.length + 1).replace(/^"|"$/g, '')
const SECRET = get('NEXTAUTH_SECRET')
const BASE = process.env.EYE_BASE || 'http://localhost:3141'
const SLUG = 'blank-2d'
const UID = 'cmrjg9c0300009lufwk5tjoxb'
const EMAIL = 'galen.goodwick@gmail.com'

// genuine NextAuth v4 JWE session cookie for the owner
const token = await encode({ token: { name: 'Galen Goodwick', email: EMAIL, sub: UID, id: UID }, secret: SECRET, maxAge: 60 * 60 })
const cookie = { name: 'next-auth.session-token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }

const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-vulkan=swiftshader', '--enable-unsafe-swiftshader'] })
// the site guards mutating requests with an Origin check (the browser sends it
// automatically; APIRequestContext does not) — supply it so harness cleanup works
const ORIGIN = { headers: { origin: BASE } }
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
await ctx.addCookies([cookie])
const p = await ctx.newPage()
p.on('dialog', d => d.dismiss().catch(() => {}))
let pass = 0, fail = 0
const T = (n, ok) => { console.log(`${ok ? '✓' : '✗'} ${n}`); ok || fail++; ok && pass++ }
const body = () => p.evaluate(() => document.body.innerText)

// confirm the cookie really auths us as the owner (not a mock)
const who = await (await ctx.request.get(BASE + '/api/auth/session')).json().catch(() => ({}))
T('minted session auths as the owner (real /api/auth/session)', who?.user?.email === EMAIL)

// sweep the sandbox clean: delete every sheet already on it (prior runs)
const sweep = async () => {
  const cur = await (await ctx.request.get(`${BASE}/api/spaces/${SLUG}/sprites`)).json().catch(() => ({}))
  for (const s of cur?.sheets ?? []) await ctx.request.delete(`${BASE}/api/spaces/${SLUG}/sprites?name=${encodeURIComponent(s.name)}`, ORIGIN).catch(() => {})
}
await sweep()

await p.goto(`${BASE}/grid?ui=engine&w=space:${SLUG}`, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(3500)
await p.locator('button', { hasText: '◲ ASSETS' }).first().click()
await p.waitForTimeout(1000)
T('owner sees the real upload door', (await body()).includes('DROP A PNG'))

// drive the REAL hidden file input → staging
await p.locator('input[type=file]').first().setInputFiles('/tmp/ember.png')
await p.waitForTimeout(1200)
T('staging shows the sheet dimensions (64×16px)', (await body()).includes('64×16px'))

// set the RIP grid: 4 cols · 1 row · 8 fps
const setNum = async (labelText, val) => {
  const lab = p.locator('label', { hasText: labelText }).first()
  const inp = lab.locator('input[type=number]')
  await inp.fill(String(val))
}
await setNum('cols', 4); await setNum('rows', 1); await setNum('fps', 8)
await p.waitForTimeout(600)
T('grid overlay computes 4 slots', (await body()).includes('4 slots'))

// FIRE the real RIP → real POST → sprite-store + worldData mirror
const ripBtn = p.locator('button', { hasText: 'RIP INTO 4 SLOTS' }).first()
T('RIP button reads "RIP INTO 4 SLOTS"', await ripBtn.count() > 0)
await ripBtn.click()
await p.waitForTimeout(2500)
const afterText = await body()
T('sheet landed on the shelf (slots ember.0–ember.3)', afterText.includes('slots ember.0') && afterText.includes('ember.3'))
T('shelf shows the animated clip @8fps', afterText.includes('clip @8fps'))
T('use-snippet is spriteAnim(0, 4, 8.0, uv, time)', afterText.includes('spriteAnim(0, 4, 8.0, uv, time)'))
await p.screenshot({ path: '/tmp/real-upload-tab.png' })

// INDEPENDENT confirmation: the REAL GET route persisted it (fresh request)
const got = await (await ctx.request.get(`${BASE}/api/spaces/${SLUG}/sprites`)).json()
const sheet = got?.sheets?.find(s => s.name === 'ember')
T('GET route persisted the sheet (cols4×rows1, fps8)', !!sheet && sheet.cols === 4 && sheet.rows === 1 && sheet.fps === 8)
T('GET meta has 4 slots + 1 clip', got?.meta?.slots?.length === 4 && got?.meta?.clips?.length === 1)
T('stored pixels are the real png (>1KB, not a mock 1px)', (sheet?.png_b64?.length || 0) > 1000)

// confirm the worldData.sprites MIRROR was written (so live tabs hot-load it)
const snap = await (await ctx.request.get(`${BASE}/api/spaces/${SLUG}/snapshot`)).json().catch(() => ({}))
const wdSprites = snap?.snapshot?.worldData?.sprites
T('worldData.sprites mirror written (renderer refetches atlas)', wdSprites?.slots?.length === 4)

// CLEAN UP — restore the sandbox to blank
await sweep()
const after = await (await ctx.request.get(`${BASE}/api/spaces/${SLUG}/sprites`)).json()
T('cleanup: sandbox restored to blank (0 sheets)', (after?.sheets?.length ?? 0) === 0)

console.log(`\n${pass} ✓  ${fail} ✗`)
await b.close()
process.exit(fail ? 1 : 0)
