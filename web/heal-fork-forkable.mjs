// heal: strip the inherited `forkable` flag from existing forks — forkability
// is opt-in per world, never heritage. Targets Galen's forks in the dev DB.
import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.CAFE_DATABASE_URL || process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

const forks = await prisma.playerSpace.findMany({
  where: { forkOfId: { not: null } },
  select: { id: true, slug: true, name: true, snapshot: true, createdAt: true },
  orderBy: { createdAt: 'desc' },
})
for (const f of forks) {
  const snap = f.snapshot
  const wd = snap && typeof snap === 'object' ? snap.worldData : null
  if (wd && wd.forkable === true) {
    delete wd.forkable
    await prisma.playerSpace.update({ where: { id: f.id }, data: { snapshot: snap } })
    console.log(`healed: ${f.slug} (${f.name}) — forkable stripped`)
  } else {
    console.log(`clean:  ${f.slug} (${f.name})`)
  }
}
await prisma.$disconnect(); await pool.end()
