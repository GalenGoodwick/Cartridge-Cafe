// E2E: the PLATFORMER BASE as a shared room (task #9 rung 2). Solo = local
// (lobby); ?room=e2e = one authoritative room; both tabs see both bodies.
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
const SLUG = 'base-platformer-2d'

const gal = await prisma.user.findUnique({ where: { email: 'galen.goodwick@gmail.com' } })
const jwt = await encode({ token: { sub: gal.id, id: gal.id, email: 'galen.goodwick@gmail.com', name: 'Galen' }, secret: process.env.NEXTAUTH_SECRET })
const cookie = { name: 'next-auth.session-token', value: jwt, domain: 'localhost', path: '/' }

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal'] })
async function tab(q) {
  const c = await browser.newContext({ viewport: { width: 900, height: 700 } })
  await c.addCookies([cookie])
  const p = await c.newPage()
  await p.goto(`${BASE}/space/${SLUG}${q}`, { waitUntil: 'domcontentloaded' })
  return p
}
// SOLO stays local (lobby): no arena join without ?room=
const solo = await tab('')
await solo.waitForTimeout(7000)
let rooms = await fetch(`${ARENA}/rooms?world=${SLUG}`).then(r => r.json())
console.log(`solo stays local (lobby): ${(rooms.rooms ?? []).length === 0 ? '✓ no room formed' : 'FAIL ' + JSON.stringify(rooms)}`)
await solo.close()

const A = await tab('?room=e2e')
await A.waitForTimeout(7000)
const B = await tab('?room=e2e')
await B.waitForTimeout(7000)
rooms = await fetch(`${ARENA}/rooms?world=${SLUG}`).then(r => r.json())
const rm = (rooms.rooms ?? []).find(x => x.room === 'e2e')
console.log(`?room=e2e forms one room, two players: ${rm?.players === 2 ? '✓' : 'FAIL ' + JSON.stringify(rooms)}`)

await A.bringToFront(); await A.keyboard.down('d')
await B.bringToFront(); await B.keyboard.down('a')
await A.waitForTimeout(1200)
await A.keyboard.up('d'); await B.keyboard.up('a')
// B jumps
await B.keyboard.down('w'); await B.waitForTimeout(150); await B.keyboard.up('w')
await A.waitForTimeout(250)
await A.screenshot({ path: `${SHOT}/base-room-A.png` })
await B.screenshot({ path: `${SHOT}/base-room-B.png` })
console.log('screenshots taken — the eye judges')
await browser.close()
await prisma.$disconnect(); await pool.end()
