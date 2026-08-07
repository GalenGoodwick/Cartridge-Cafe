// e2e-savestates.mjs — ROUND-TRIP proof of the ROM/save-state architecture against
// the save-states branch running on :3055. Matrix:
//   A plays → capture (slot appears) → A reloads → progress CONTINUES
//   B (fresh profile) → clean ROM boot
//   owner tab syncs → shared snapshot carries NO player state (ROM protection)
import { createRequire } from 'module'
const require = createRequire('/Users/galengoodwick/Documents/GitHub/cafe-savestates-wt/web/package.json')
const { chromium } = require('playwright-core')
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const BASE = 'http://localhost:3055'
let pass = 0, fail = 0
const ok = (c, name) => { if (c) { pass++; console.log('  ✓', name) } else { fail++; console.log('  ✗ FAIL', name) } }

// ── tiny cookie-jar fetch (the MCP brew flow, replicated) ──────────────────
const jar = {}
async function jfetch(path, opts = {}) {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', origin: BASE, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(opts.headers || {}) },
    redirect: 'manual',
  })
  for (const sc of r.headers.getSetCookie?.() || []) {
    const [kv] = sc.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1)
  }
  let body = null; try { body = await r.json() } catch { }
  return { status: r.status, body }
}

// 1) guest session + space + token
await jfetch('/api/auth/guest', { method: 'POST' })
const csrf = (await jfetch('/api/auth/csrf')).body?.csrfToken
await jfetch('/api/auth/callback/guest', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `csrfToken=${encodeURIComponent(csrf)}&json=true` })
const w = await jfetch('/api/spaces', { method: 'POST', body: JSON.stringify({ name: 'savestate e2e' }) })
const slug = w.body?.slug || w.body?.space?.slug
if (!slug) { console.log('no slug:', w.status, JSON.stringify(w.body).slice(0, 200)); process.exit(1) }
const t = await jfetch(`/api/spaces/${slug}/token`, { method: 'POST', body: JSON.stringify({ name: 'e2e' }) })
const TOK = t.body?.token
console.log('world:', slug, 'token:', TOK?.slice(0, 8) + '…')

// 2) build the test cartridge: field + visual + testifying hook + rom flag
const bridge = async (command) => {
  const r = await fetch(BASE + '/api/engine/bridge', { method: 'POST', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) })
  return r.json()
}
await bridge({ type: 'create_field', name: 'Stage', x: 256, y: 256, radius: 200, color: [0.1, 0.1, 0.2, 1], visualType: 'ss_stage' })
await bridge({ type: 'define_visual', name: 'ss_stage', wgsl: 'fn visual_ss_stage(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {\n  return vec4f(0.1, 0.12 + 0.05 * sin(time), 0.25, 1.0);\n}' })
await bridge({ type: 'add_step_hook', hookId: 'ss-game', description: 'e2e: ticks = player progress; communal = shared', code: `
try {
  const wd = sim.worldData
  wd.__progress = wd.__progress || { ticks: 0 }
  wd.__progress.ticks++
  if (wd.communal == null) wd.communal = 0
  wd.hud = [{ id: 'e2e', text: 'T' + wd.__progress.ticks, x: 50, y: 20 }]
} catch (e) {}
` })
await bridge({ type: 'set_world_data', data: { __saveArch: 'rom', __shared: ['communal'], communal: 0 } })
const snap0 = (await jfetch(`/api/spaces/${slug}/snapshot`)).body || {}
ok((snap0.snapshot || snap0).worldData?.__saveArch === 'rom', 'ROM flag in the snapshot')

// ── browser helpers ─────────────────────────────────────────────────────────
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ARGS = ['--headless=new', '--enable-unsafe-webgpu', '--use-angle=metal', '--no-first-run']
async function playSession(profileDir, ms, { cookies } = {}) {
  const ctx = await chromium.launchPersistentContext(profileDir, { executablePath: CHROME, headless: true, args: ARGS, viewport: { width: 1280, height: 800 } })
  if (cookies) await ctx.addCookies(cookies)
  const page = ctx.pages()[0] || await ctx.newPage()
  await page.goto(`${BASE}/space/${slug}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(ms)
  let ticks = -1
  try {
    const txt = await page.locator('text=/T\\d+/').first().textContent({ timeout: 5000 })
    ticks = parseInt((txt.match(/T(\d+)/) || [])[1] || '-1')
  } catch { }
  await ctx.close()   // pagehide → flush
  return ticks
}
const stateSlots = async () => {
  const l = await jfetch('/api/engine/save?action=list')
  return (l.body?.slots || []).map(s => String(s.slot ?? s.name ?? s)).filter(s => s.includes(`${slug}:__state`))
}
const slotTicks = async (key) => {
  const r = await jfetch(`/api/engine/save?slot=${encodeURIComponent(key)}`)
  return r.body?.data?.__progress?.ticks ?? -1
}

// 3) the matrix
const dirA = mkdtempSync(join(tmpdir(), 'ss-a-')), dirB = mkdtempSync(join(tmpdir(), 'ss-b-'))
const before = await stateSlots()
await playSession(dirA, 15000)
await new Promise(r => setTimeout(r, 1500))
const after = await stateSlots()
ok(after.length > before.length, `capture landed a per-user __state slot (${before.length} → ${after.length})`)
const slotA = after.find(s => !before.includes(s))
const t1 = await slotTicks(slotA)
console.log('A saved ticks:', t1, 'slot:', slotA)
ok(t1 > 200, `A's progress captured to their slot (T${t1})`)

await playSession(dirA, 6000)
await new Promise(r => setTimeout(r, 1500))
const t2 = await slotTicks(slotA)
console.log('A ticks after reload session:', t2)
ok(t2 > t1 + 100, `A's progress CONTINUED across reload (T${t2} > T${t1})`)

await playSession(dirB, 6000)
await new Promise(r => setTimeout(r, 1500))
const two = await stateSlots()
ok(two.length > after.length, 'B got a DISTINCT per-user slot')
const slotB = two.find(s => !after.includes(s))
const t3 = await slotTicks(slotB)
console.log('B saved ticks:', t3)
ok(t3 > 0 && t3 < t1 * 0.6, `B booted clean from ROM (T${t3} ≪ T${t1})`)

// 4) ROM protection: an OWNER tab (jar cookies) plays + syncs; snapshot stays clean
const dirO = mkdtempSync(join(tmpdir(), 'ss-o-'))
const cookieList = Object.entries(jar).map(([name, value]) => ({ name, value, url: BASE }))
await playSession(dirO, 9000, { cookies: cookieList })
const snap1 = (await jfetch(`/api/spaces/${slug}/snapshot`)).body || {}
const swd = (snap1.snapshot || snap1).worldData || {}
ok(swd.__progress === undefined, 'shared snapshot carries NO player progress (ROM protected)')
ok(swd.hud === undefined, 'no hud residue in the ROM')
ok(swd.__saveArch === 'rom' && swd.communal !== undefined, 'ROM + shared keys intact')

console.log(`\n${pass} passed · ${fail} failed`)
process.exit(fail ? 1 : 0)
