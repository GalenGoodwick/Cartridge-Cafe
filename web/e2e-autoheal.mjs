// E2E: the auto-heal wire (rung 2). A world with a good rev + a fresh bad rev;
// the live tab's error reports (hook-errors POSTs) hit threshold → the world's
// snapshot heals to the good code, the bad rev is marked. Cleans after.
import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.CAFE_DATABASE_URL || process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const BASE = 'http://localhost:3000'

const owner = await prisma.user.findUnique({ where: { email: 'galen.goodwick@gmail.com' }, select: { id: true } })
const now = Date.now()
const world = await prisma.playerSpace.create({ data: {
  slug: 'e2e-autoheal', name: 'E2E AUTOHEAL', ownerId: owner.id, isPublic: false,
  snapshot: {
    fields: [], interactionRules: [], interactionEffects: [], visualTypes: [], modules: [],
    stepHooks: [{ id: 'engine', author: 'test', description: '', code: 'sim.v2.explodes' }],
    worldData: {
      __nodes: { engine: { id: 'engine', rev: 2 } },
      __nodeHist: { engine: [
        { rev: 1, code: 'sim.v1 = true', at: now - 60_000, by: 'builder-a' },
        { rev: 2, code: 'sim.v2.explodes', at: now, by: 'builder-a' },
      ] },
    },
  },
} })

const report = () => fetch(`${BASE}/api/engine/hook-errors`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ slug: world.slug, error: { hookId: 'engine', phase: 'runtime', error: `TypeError at ${Math.random()}` } }),
}).then(r => r.json())

let d = await report()
console.log(`report 1: counted=${d.counted} ${d.counted === 1 ? '✓' : 'FAIL ' + JSON.stringify(d)}`)
d = await report()
console.log(`report 2: counted=${d.counted} ${d.counted === 2 ? '✓' : 'FAIL ' + JSON.stringify(d)}`)
d = await report()
console.log(`report 3: reverted=${d.reverted} ${d.reverted === 1 ? '✓ AUTO-HEALED' : 'FAIL ' + JSON.stringify(d)}`)

const after = await prisma.playerSpace.findUnique({ where: { id: world.id }, select: { snapshot: true } })
const snap = after.snapshot
const hook = snap.stepHooks.find(h => h.id === 'engine')
console.log(`snapshot code healed: ${hook?.code === 'sim.v1 = true' ? '✓' : 'FAIL — ' + hook?.code}`)
const badRev = snap.worldData.__nodeHist.engine.find(r => r.rev === 2)
console.log(`bad rev marked: ${badRev?.bad === true ? '✓' : 'FAIL'}`)

await prisma.playerSpace.delete({ where: { id: world.id } })
console.log('cleaned')
await prisma.$disconnect(); await pool.end()
