// E2E: a MEMBER of a build:'invited' world self-mints their build key at the
// token route (the key CONNECT AI needs); a NON-member is refused; a re-mint
// retires the older member key (roster stays one row per handle).
import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { encode } from 'next-auth/jwt'
import crypto from 'crypto'

const pool = new pg.Pool({ connectionString: process.env.CAFE_DATABASE_URL || process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const BASE = 'http://localhost:3000'

async function sessionFor(email, name) {
  let u = await prisma.user.findUnique({ where: { email } })
  if (!u) u = await prisma.user.create({ data: { email, name } })
  const token = await encode({ token: { sub: u.id, id: u.id, email, name }, secret: process.env.NEXTAUTH_SECRET })
  return { user: u, cookie: `next-auth.session-token=${token}` }
}

const ownerU = await sessionFor('e2e-crew-owner@test.local', 'CrewOwner')
const member = await sessionFor('e2e-crew-mem@test.local', 'CrewMem')
const rando = await sessionFor('e2e-crew-rando@test.local', 'CrewRando')
const hm = 'e2e-crew-mem'

// a temp CREW world: policy {build:'invited', play:'everyone'} baked in
const world = await prisma.playerSpace.create({ data: {
  slug: 'e2e-crew-table', name: 'E2E CREW TABLE', ownerId: ownerU.user.id, isPublic: true,
  snapshot: { worldData: { policy: { build: 'invited', play: 'everyone' } } },
} })

// seed the roster: member joined earlier (as the join door would)
await prisma.spaceToken.create({ data: {
  name: `member:${hm}`,
  tokenHash: crypto.createHash('sha256').update('seed').digest('hex'),
  tokenPrefix: 'seed...', spaceId: world.id,
} })

// MEMBER self-mints → 200 + raw key, and the seed row is retired
let r = await fetch(`${BASE}/api/spaces/${world.slug}/token`, {
  method: 'POST', headers: { cookie: member.cookie, Origin: BASE, 'Content-Type': 'application/json' },
  body: JSON.stringify({}) })
let d = await r.json()
console.log(`member self-mint: ${r.status} ${d.token?.startsWith('uc_st_') ? '✓ raw key' : JSON.stringify(d)}`)
const rows = await prisma.spaceToken.findMany({ where: { spaceId: world.id, name: `member:${hm}` }, select: { revokedAt: true } })
console.log(`roster after re-mint: ${rows.filter(x => !x.revokedAt).length} live / ${rows.length} total ${rows.filter(x => !x.revokedAt).length === 1 ? '✓ old retired' : 'FAIL'}`)

// NON-member is refused
r = await fetch(`${BASE}/api/spaces/${world.slug}/token`, {
  method: 'POST', headers: { cookie: rando.cookie, Origin: BASE, 'Content-Type': 'application/json' },
  body: JSON.stringify({}) })
console.log(`non-member refused: ${r.status >= 400 ? '✓ (' + r.status + ')' : 'FAIL — minted!'}`)

// cleanup
await prisma.spaceToken.deleteMany({ where: { spaceId: world.id } })
await prisma.playerSpace.delete({ where: { id: world.id } })
await prisma.user.deleteMany({ where: { email: { in: ['e2e-crew-owner@test.local', 'e2e-crew-mem@test.local', 'e2e-crew-rando@test.local'] } } })
console.log('cleaned: temp world + users removed')
await prisma.$disconnect(); await pool.end()
