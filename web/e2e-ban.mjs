// E2E: the ban lifecycle (task #6). Member exists → owner bans → their key is
// revoked NOW, a fresh invite can't readmit them, open-world self-mint 403s,
// the ledger shows it, unban lifts it. Cleans after.
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
const post = (url, cookie, body) => fetch(url, { method: 'POST', headers: { cookie, Origin: BASE, 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })

const owner = await sessionFor('e2e-ban-owner@test.local', 'BanOwner')
const griefer = await sessionFor('e2e-griefer@test.local', 'Griefer')
const hg = 'e2e-griefer'

// an OPEN world (build:anyone) owned by the temp owner — worst case for a ban
const world = await prisma.playerSpace.create({ data: {
  slug: 'e2e-ban-ground', name: 'E2E BAN GROUND', ownerId: owner.user.id, isPublic: true,
  snapshot: { worldData: { policy: { build: 'anyone', play: 'everyone' } } },
} })

// griefer self-mints on the open world (they're a member now)
let r = await post(`${BASE}/api/spaces/${world.slug}/token`, griefer.cookie)
let d = await r.json()
const grieferKey = d.token
console.log(`griefer self-mint (open world): ${r.status === 201 && grieferKey ? '✓' : 'FAIL ' + r.status}`)

// the griefer's key WORKS on the bridge pre-ban
r = await fetch(`${BASE}/api/engine/bridge`, { headers: { Authorization: `Bearer ${grieferKey}` } })
console.log(`key live pre-ban: ${r.status === 200 ? '✓' : 'FAIL ' + r.status}`)

// owner BANS
r = await post(`${BASE}/api/spaces/${world.slug}/ban`, owner.cookie, { handle: hg })
d = await r.json()
console.log(`ban: ${r.status === 200 && d.keysRevoked >= 1 ? `✓ (${d.keysRevoked} key revoked, ${d.bannedForDays}d)` : 'FAIL ' + JSON.stringify(d)}`)

// the key is DEAD immediately
r = await fetch(`${BASE}/api/engine/bridge`, { headers: { Authorization: `Bearer ${grieferKey}` } })
console.log(`key dead post-ban: ${r.status === 401 ? '✓ (401)' : 'FAIL ' + r.status}`)

// self-mint now refuses (banned beats open policy)
r = await post(`${BASE}/api/spaces/${world.slug}/token`, griefer.cookie)
console.log(`re-mint refused: ${r.status === 403 ? '✓ (403)' : 'FAIL ' + r.status}`)

// a fresh one-time invite cannot readmit them (link NOT consumed, no member row)
r = await post(`${BASE}/api/spaces/${world.slug}/invite`, owner.cookie)
const joinUrl = (await r.json()).joinUrl
await fetch(joinUrl, { headers: { cookie: griefer.cookie }, redirect: 'manual' })
const row = await prisma.spaceToken.findFirst({ where: { spaceId: world.id, revokedAt: null, name: `member:${hg}` } })
r = await fetch(`${BASE}/api/spaces/${world.slug}/invite`, { headers: { cookie: owner.cookie, Origin: BASE } })
d = await r.json()
console.log(`invite can't readmit: ${row ? 'FAIL — member row minted!' : '✓'} (invite still outstanding: ${d.outstanding === 1 ? '✓ unconsumed' : 'consumed?!'})`)

// ledger + unban
r = await fetch(`${BASE}/api/spaces/${world.slug}/ban`, { headers: { cookie: owner.cookie, Origin: BASE } })
d = await r.json()
console.log(`ledger: ${d.bans?.some(b => b.handle === hg) ? '✓ listed' : 'FAIL'}`)
r = await fetch(`${BASE}/api/spaces/${world.slug}/ban`, { method: 'DELETE', headers: { cookie: owner.cookie, Origin: BASE, 'Content-Type': 'application/json' }, body: JSON.stringify({ handle: hg }) })
console.log(`unban: ${r.status === 200 ? '✓' : 'FAIL ' + r.status}`)
r = await post(`${BASE}/api/spaces/${world.slug}/token`, griefer.cookie)
console.log(`mint after unban: ${r.status === 201 ? '✓ welcome back' : 'FAIL ' + r.status}`)

// cleanup (world delete cascades tokens; slots are keyed by the dead spaceId)
await prisma.spaceToken.deleteMany({ where: { spaceId: world.id } })
await prisma.playerSpace.delete({ where: { id: world.id } })
await prisma.user.deleteMany({ where: { email: { in: ['e2e-ban-owner@test.local', 'e2e-griefer@test.local'] } } })
console.log('cleaned')
await prisma.$disconnect(); await pool.end()
