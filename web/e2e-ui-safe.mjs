// eye: chrome-safe UI (task #19). A world using THE UI SYSTEM (worldData.ui)
// with panels pinned into every corner — on a NARROW viewport where the name
// plate + pills overlap the world square, every panel must sit clear of them.
import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { encode } from 'next-auth/jwt'
import crypto from 'crypto'
import { chromium } from 'playwright'

const pool = new pg.Pool({ connectionString: process.env.CAFE_DATABASE_URL || process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const BASE = 'http://localhost:3000'
const SHOT = '/private/tmp/claude-501/-Users-galengoodwick/e3a3eea1-70f6-4618-9bf9-e748009eec87/scratchpad'

const HUD_NODE = `// hud slot — THE UI SYSTEM demo: four corner panels + a meter + a button
const wd = sim.worldData
wd.__uit = (wd.__uit ?? 0) + dt
wd.ui = { rev: 1, root: [
  { id: 'tl', kind: 'panel', anchor: { gx: 6, gy: 6 }, align: 'tl', w: 150,
    children: [ { kind: 'text', text: 'SCORE 4200', fontSize: 14 }, { kind: 'meter', id: 'hp', value: 0.66, label: 'HP' } ] },
  { id: 'tr', kind: 'panel', anchor: { gx: 506, gy: 6 }, align: 'tr', w: 120,
    children: [ { kind: 'text', text: 'WAVE 3' } ] },
  { id: 'bl', kind: 'panel', anchor: { gx: 6, gy: 506 }, align: 'bl', w: 170,
    children: [ { kind: 'text', text: 'ARROWS TO MOVE', fontSize: 11 } ] },
  { id: 'br', kind: 'panel', anchor: { gx: 506, gy: 506 }, align: 'br', w: 130,
    children: [ { kind: 'button', id: 'go', text: 'START', click: 'start' } ] },
] }
`

const BG_WGSL = `fn visual_uibg(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let g = 0.5 + 0.5 * sin(uv.x * 3.0 + time * 0.4);
  return vec4f(0.06 + g * 0.05, 0.05, 0.12, 1.0);
}`

const gal = await prisma.user.findUnique({ where: { email: 'galen.goodwick@gmail.com' } })
const jwt = await encode({ token: { sub: gal.id, id: gal.id, email: 'galen.goodwick@gmail.com', name: 'Galen' }, secret: process.env.NEXTAUTH_SECRET })
const cookie = { name: 'next-auth.session-token', value: jwt, domain: 'localhost', path: '/' }

await prisma.playerSpace.deleteMany({ where: { slug: 'e2e-ui-safe' } })
const world = await prisma.playerSpace.create({ data: { slug: 'e2e-ui-safe', name: 'E2E UI SAFE', ownerId: gal.id, isPublic: false, snapshot: {} } })
const raw = 'uc_st_' + crypto.randomBytes(16).toString('hex')
await prisma.spaceToken.create({ data: { name: 'ui-seed', spaceId: world.id, tokenHash: crypto.createHash('sha256').update(raw).digest('hex'), tokenPrefix: raw.slice(0, 12) + '...' } })
const r = await fetch(`${BASE}/api/engine/bridge`, {
  method: 'POST', headers: { Authorization: `Bearer ${raw}`, 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ commands: [
    { type: 'define_visual', name: 'uibg', wgsl: BG_WGSL },
    { type: 'create_field', fieldId: 'bg', name: 'backdrop', visualType: 'uibg' },
    { type: 'add_step_hook', hookId: 'hud', description: 'ui demo', code: HUD_NODE },
  ] }),
})
const errs = ((await r.json()).results ?? []).filter(x => x.error)
console.log(`built: ${errs.length ? 'ERRORS ' + JSON.stringify(errs) : '✓'}`)

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal'] })
for (const [label, vp] of [['narrow', { width: 840, height: 700 }], ['wide', { width: 1280, height: 800 }]]) {
  const ctx = await browser.newContext({ viewport: vp })
  await ctx.addCookies([cookie])
  const page = await ctx.newPage()
  await page.goto(`${BASE}/space/${world.slug}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(8000)
  await page.screenshot({ path: `${SHOT}/ui-safe-${label}.png` })
  await ctx.close()
  console.log(`${label} shot taken`)
}
await browser.close()
console.log('world kept: /space/e2e-ui-safe')
await prisma.$disconnect(); await pool.end()
