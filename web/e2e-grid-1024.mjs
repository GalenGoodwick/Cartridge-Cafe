// E2E: grid dimensions (task #20). A 1024×1024 world with a field parked at
// (900, 900) — coordinates that CANNOT exist on a 512 grid (solid bounds would
// clamp it). The engine must be born at 1024: the dot renders in the far
// quadrant, the world square maps the full 1024 space.
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

const gal = await prisma.user.findUnique({ where: { email: 'galen.goodwick@gmail.com' } })
const jwt = await encode({ token: { sub: gal.id, id: gal.id, email: 'galen.goodwick@gmail.com', name: 'Galen' }, secret: process.env.NEXTAUTH_SECRET })

await prisma.playerSpace.deleteMany({ where: { slug: 'e2e-grid-1024' } })
const world = await prisma.playerSpace.create({ data: { slug: 'e2e-grid-1024', name: 'E2E GRID 1024', ownerId: gal.id, isPublic: false, snapshot: {} } })
const raw = 'uc_st_' + crypto.randomBytes(16).toString('hex')
await prisma.spaceToken.create({ data: { name: 'grid-seed', spaceId: world.id, tokenHash: crypto.createHash('sha256').update(raw).digest('hex'), tokenPrefix: raw.slice(0, 12) + '...' } })
const bridge = (commands) => fetch(`${BASE}/api/engine/bridge`, {
  method: 'POST', headers: { Authorization: `Bearer ${raw}`, 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ commands }),
}).then(r => r.json())

const DOT = `fn visual_dot(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  if (sdf < 0.0) { return vec4f(color.rgb, 1.0); }
  return vec4f(0.0);
}`
const d = await bridge([
  { type: 'set_world_params', gridSize: 1024, boundaryMode: 'solid' },
  { type: 'define_visual', name: 'dot', wgsl: DOT },
  { type: 'create_field', fieldId: 'far', name: 'far dot', radius: 40, color: [1, 0.6, 0.2, 1], x: 900, y: 900, visualType: 'dot' },
  { type: 'create_field', fieldId: 'origin', name: 'origin dot', radius: 40, color: [0.2, 0.8, 1, 1], x: 100, y: 100, visualType: 'dot' },
])
const errs = (d.results ?? []).filter(x => x.error)
console.log(`built: ${errs.length ? 'ERRORS ' + JSON.stringify(errs).slice(0, 300) : '✓'}`)
console.log(`gridSize warning: ${(d.results ?? []).find(x => x.warning)?.warning?.slice(0, 60) ?? '(none)'}`)

// server truth
const after = await prisma.playerSpace.findUnique({ where: { slug: 'e2e-grid-1024' }, select: { snapshot: true } })
console.log(`persisted gridSize: ${after.snapshot.worldParams?.gridSize === 1024 ? '✓ 1024' : 'FAIL ' + after.snapshot.worldParams?.gridSize}`)
const farF = after.snapshot.fields.find(f => f.id === 'far')
console.log(`field at (900,900): ${farF ? JSON.stringify({ x: farF.transform?.x ?? farF.x, y: farF.transform?.y ?? farF.y }) : 'MISSING'}`)

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal'] })
const ctx = await browser.newContext({ viewport: { width: 1100, height: 780 } })
await ctx.addCookies([{ name: 'next-auth.session-token', value: jwt, domain: 'localhost', path: '/' }])
const page = await ctx.newPage()
await page.goto(`${BASE}/space/${world.slug}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(8000)
await page.screenshot({ path: `${SHOT}/grid-1024.png` })
await browser.close()
console.log('eye shot taken — expect the orange dot deep in the lower-right quadrant (900/1024), blue near upper-left (100/1024)')
console.log('world kept: /space/e2e-grid-1024')
await prisma.$disconnect(); await pool.end()
