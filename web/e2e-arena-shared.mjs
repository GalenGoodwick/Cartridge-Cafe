// E2E: SHARED STATE on dev infra (task #9 rung 1). A world built on the
// placeholder anatomy declares mpManifest + a local arena (worldData.arenaUrl)
// → two real browser tabs join the same authoritative room → the server runs
// the world's player node (per-seat kinematic avatars from wd.players input
// frames) → tab A holds D, tab B holds A → BOTH tabs see BOTH dots, moving.
// Truth read from the arena's /rooms endpoint + both tabs' screenshots.
import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { encode } from 'next-auth/jwt'
import { chromium } from 'playwright'

const pool = new pg.Pool({ connectionString: process.env.CAFE_DATABASE_URL || process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const BASE = 'http://localhost:3000'
const ARENA = 'http://localhost:8080'
const SHOT = '/private/tmp/claude-501/-Users-galengoodwick/e3a3eea1-70f6-4618-9bf9-e748009eec87/scratchpad'

const PLAYER_NODE = `// ── PLAYER (networked): the ARENA runs this — each seat an avatar.
// wd.players = per-seat input frames the room merges every tick.
const wd = sim.worldData
if (Array.isArray(wd.players)) {
  const pos = wd.mp_pos || (wd.mp_pos = {})
  const u = Array.isArray(wd.gpuUniforms) ? wd.gpuUniforms : (wd.gpuUniforms = new Array(16).fill(0))
  for (const p of wd.players) {
    const k = 's' + p.seat
    const st = pos[k] || (pos[k] = { x: 200 + p.seat * 80, y: 256 })
    const dx = ((p.key_d || p.key_arrowright) ? 1 : 0) - ((p.key_a || p.key_arrowleft) ? 1 : 0)
    const dy = ((p.key_s || p.key_arrowdown) ? 1 : 0) - ((p.key_w || p.key_arrowup) ? 1 : 0)
    st.x = Math.max(10, Math.min(502, st.x + dx * 180 * dt))
    st.y = Math.max(10, Math.min(502, st.y + dy * 180 * dt))
    u[2 * p.seat] = st.x
    u[2 * p.seat + 1] = st.y
  }
  u[14] = wd.playerCount || 0
  wd.gpuUniforms = u
}
`

const DOTS_WGSL = `fn visual_mpdots(uv: vec2f, sdf: f32, color: vec4f, time: f32, params: vec4f, behind: vec4f) -> vec4f {
  let px = (uv * 0.5 + vec2f(0.5)) * 512.0;
  var col = vec4f(0.03, 0.03, 0.07, 1.0);
  let count = i32(uni(14));
  for (var i = 0; i < 6; i++) {
    if (i >= count) { break; }
    let p = vec2f(uni(i * 2), uni(i * 2 + 1));
    let d = distance(px, p);
    if (d < 12.0) { col = vec4f(0.95, 0.55 + f32(i) * 0.3, 0.25, 1.0); }
  }
  return col;
}`

const gal = await prisma.user.findUnique({ where: { email: 'galen.goodwick@gmail.com' } })
const token = await encode({ token: { sub: gal.id, id: gal.id, email: 'galen.goodwick@gmail.com', name: 'Galen' }, secret: process.env.NEXTAUTH_SECRET })
const cookie = { name: 'next-auth.session-token', value: token, domain: 'localhost', path: '/' }
const now = Date.now()

await prisma.playerSpace.deleteMany({ where: { slug: 'e2e-arena-ground' } })
const world = await prisma.playerSpace.create({ data: {
  slug: 'e2e-arena-ground', name: 'E2E ARENA GROUND', ownerId: gal.id, isPublic: false, snapshot: {},
} })
// build through the REAL command pipeline with a REAL world token (the same
// credential an AI build holds) — fields/visuals/hooks land with correct shapes
const cryptoMod = await import('crypto')
const rawKey = 'uc_st_' + cryptoMod.randomBytes(16).toString('hex')
await prisma.spaceToken.create({ data: {
  name: 'e2e-builder', spaceId: world.id,
  tokenHash: cryptoMod.createHash('sha256').update(rawKey).digest('hex'),
  tokenPrefix: rawKey.slice(0, 12) + '...',
} })
const cmds = [
  { type: 'define_visual', name: 'mpdots', wgsl: DOTS_WGSL },
  { type: 'create_field', fieldId: 'mp_field', name: 'mp field', visualType: 'mpdots' },
  { type: 'add_step_hook', hookId: 'player', description: 'per-seat avatars (arena authority)', code: PLAYER_NODE },
  { type: 'add_step_hook', hookId: 'net', description: 'shared state', code: '// net slot — manifest lives in worldData.mpManifest\n' },
  { type: 'set_world_data', data: { mpManifest: { type: 'shared', capacity: 6 }, arenaUrl: 'ws://localhost:8080' } },
]
const br = await fetch(`${BASE}/api/engine/bridge`, {
  method: 'POST', headers: { Authorization: `Bearer ${rawKey}`, 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ commands: cmds }),
})
const bd = await br.json()
const errs = (bd.results ?? []).filter(x => x.error)
console.log(`world built via bridge: ${br.status} ${errs.length ? 'ERRORS ' + JSON.stringify(errs) : '✓ all commands landed'}`)

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal'] })
async function tab() {
  const c = await browser.newContext({ viewport: { width: 900, height: 700 } })
  await c.addCookies([cookie])
  const p = await c.newPage()
  await p.goto(`${BASE}/space/${world.slug}`, { waitUntil: 'domcontentloaded' })
  return p
}
const A = await tab()
await A.waitForTimeout(7000)
const B = await tab()
await B.waitForTimeout(7000)

// the room is REAL: the arena reports both players in one room
let rooms = await fetch(`${ARENA}/rooms?world=${world.slug}`).then(r => r.json())
console.log(`one room, two players: ${rooms.rooms?.[0]?.players === 2 ? '✓' : 'FAIL ' + JSON.stringify(rooms)}`)

// drive: A holds D (east), B holds A-key (west)
await A.bringToFront(); await A.keyboard.down('d')
await B.bringToFront(); await B.keyboard.down('a')
await A.waitForTimeout(1500)
await A.keyboard.up('d'); await B.keyboard.up('a')
await A.waitForTimeout(600)
await A.screenshot({ path: `${SHOT}/arena-tabA.png` })
await B.screenshot({ path: `${SHOT}/arena-tabB.png` })
console.log('screenshots taken — the eye judges both tabs')
await browser.close()

console.log(`world kept for inspection: ${BASE}/space/e2e-arena-ground (delete when done)`)
await prisma.$disconnect(); await pool.end()
