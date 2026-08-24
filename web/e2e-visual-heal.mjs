// E2E: the visuals heal wire (rung 2 second half). World with good + fresh
// broken shader rev; ONE quarantine report (as the renderer posts it) →
// snapshot heals to the good WGSL, bad rev marked, AI channel gets the
// 'reverted' line. Cleans after.
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
  slug: 'e2e-visual-heal', name: 'E2E VISUAL HEAL', ownerId: owner.id, isPublic: false,
  snapshot: {
    fields: [], stepHooks: [], interactionRules: [], interactionEffects: [], modules: [],
    visualTypes: [{ name: 'aurora', wgsl: 'fn broken( {}' }],
    worldData: {
      __nodeHist: { 'visual:aurora': [
        { rev: 1, code: 'fn good() {}', at: now - 60_000, by: 'builder-a' },
        { rev: 2, code: 'fn broken( {}', at: now, by: 'builder-a' },
      ] },
    },
  },
} })

// the renderer's exact report shape
const r = await fetch(`${BASE}/api/engine/quarantine`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ phase: 'compile-error', url: `${BASE}/space/${world.slug}`,
    hazards: [{ name: 'aurora', reason: 'WGSL parse error at line 1' }] }),
})
const d = await r.json()
console.log(`quarantine report → healed: ${d.healed?.[0]?.name === 'aurora' && d.healed[0].rev === 1 ? '✓ aurora → rev 1' : 'FAIL ' + JSON.stringify(d)}`)

const after = await prisma.playerSpace.findUnique({ where: { id: world.id }, select: { snapshot: true } })
const snap = after.snapshot
console.log(`snapshot WGSL healed: ${snap.visualTypes.find(v => v.name === 'aurora')?.wgsl === 'fn good() {}' ? '✓' : 'FAIL'}`)
console.log(`bad rev marked: ${snap.worldData.__nodeHist['visual:aurora'].find(x => x.rev === 2)?.bad === true ? '✓' : 'FAIL'}`)

// the AI channel (world state's hookErrors buffer) carries the heal line
const errs = await fetch(`${BASE}/api/engine/hook-errors?slug=${world.slug}`).then(x => x.json())
const line = errs.hookErrors?.find(e => e.hookId === 'visual:aurora' && e.phase === 'reverted')
console.log(`AI channel heal line: ${line ? '✓ "' + line.error.slice(0, 60) + '…"' : 'FAIL'}`)

await prisma.playerSpace.delete({ where: { id: world.id } })
console.log('cleaned')
await prisma.$disconnect(); await pool.end()
