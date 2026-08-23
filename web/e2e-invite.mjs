// E2E: the one-time invite link (task #5). Owner mints → stranger joins via
// link → member row exists → world in stranger's SHARED tab → link is SPENT
// (a second stranger gets nothing). Cleans its temp users after.
import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { encode } from 'next-auth/jwt'

const pool = new pg.Pool({ connectionString: process.env.CAFE_DATABASE_URL || process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const BASE = 'http://localhost:3000'
const SECRET = process.env.NEXTAUTH_SECRET

async function sessionFor(email, name) {
  let u = await prisma.user.findUnique({ where: { email } })
  if (!u) u = await prisma.user.create({ data: { email, name } })
  const token = await encode({ token: { sub: u.id, id: u.id, email, name }, secret: SECRET })
  return { user: u, cookie: `next-auth.session-token=${token}` }
}

const owner = await sessionFor('galen.goodwick@gmail.com', 'Galen')
const s1 = await sessionFor('e2e-crew-one@test.local', 'CrewOne')
const s2 = await sessionFor('e2e-crew-two@test.local', 'CrewTwo')
const h1 = 'e2e-crew-one', h2 = 'e2e-crew-two'

// a world Galen owns
const world = await prisma.playerSpace.findFirst({ where: { ownerId: owner.user.id }, select: { id: true, slug: true, name: true } })
if (!world) { console.log('FAIL: no owned world'); process.exit(1) }
console.log(`world: ${world.slug} (${world.name})`)

// 1. owner mints the one-time link
let r = await fetch(`${BASE}/api/spaces/${world.slug}/invite`, { method: 'POST', headers: { cookie: owner.cookie, Origin: BASE } })
let d = await r.json()
console.log(`mint: ${r.status} ${d.joinUrl ? 'joinUrl ✓' : JSON.stringify(d)}`)
const joinUrl = d.joinUrl

// 1b. a stranger may NOT mint
r = await fetch(`${BASE}/api/spaces/${world.slug}/invite`, { method: 'POST', headers: { cookie: s1.cookie, Origin: BASE } })
console.log(`stranger mint blocked: ${r.status === 404 ? '✓ (404)' : 'FAIL ' + r.status}`)

// 2. stranger ONE walks through the door
r = await fetch(joinUrl, { headers: { cookie: s1.cookie }, redirect: 'manual' })
console.log(`join visit: ${r.status} → ${r.headers.get('location') ?? '(no redirect)'}`)
const m1 = await prisma.spaceToken.findFirst({ where: { spaceId: world.id, revokedAt: null, name: `member:${h1}` } })
console.log(`member row for ${h1}: ${m1 ? '✓ minted' : 'FAIL — missing'}`)

// 3. world appears in stranger ONE's SHARED WORLDS tab
r = await fetch(`${BASE}/api/cards?tab=shared`, { headers: { cookie: s1.cookie, Origin: BASE } })
d = await r.json()
const inShared = (d.cards ?? []).some(c => c.slug === world.slug)
console.log(`SHARED tab: ${inShared ? `✓ ${world.slug} dealt` : 'FAIL — not in ' + JSON.stringify((d.cards ?? []).map(c => c.slug))}`)

// 4. the link is SPENT — stranger TWO gets nothing from it
r = await fetch(joinUrl, { headers: { cookie: s2.cookie }, redirect: 'manual' })
const m2 = await prisma.spaceToken.findFirst({ where: { spaceId: world.id, revokedAt: null, name: `member:${h2}` } })
console.log(`second use dead: ${m2 ? 'FAIL — link reused!' : '✓ (no member row for ' + h2 + ')'}`)

// 5. the ledger shows one used invite by h1
r = await fetch(`${BASE}/api/spaces/${world.slug}/invite`, { headers: { cookie: owner.cookie, Origin: BASE } })
d = await r.json()
console.log(`ledger: outstanding=${d.outstanding} used=${JSON.stringify(d.used?.map(u => u.by))} ${d.used?.some(u => u.by === h1) ? '✓' : 'FAIL'}`)

// cleanup: temp users + their member rows + the invite slot entry stays (used, prunes itself)
await prisma.spaceToken.deleteMany({ where: { spaceId: world.id, name: { in: [`member:${h1}`, `member:${h2}`] } } })
await prisma.user.deleteMany({ where: { email: { in: ['e2e-crew-one@test.local', 'e2e-crew-two@test.local'] } } })
console.log('cleaned: temp users + member rows removed')
await prisma.$disconnect(); await pool.end()
