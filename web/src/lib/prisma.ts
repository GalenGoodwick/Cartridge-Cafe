import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  pool: Pool | undefined
}

function createPrismaClient() {
  const pool = globalForPrisma.pool ?? new Pool({
    // CAFE_DATABASE_URL is the cafe's OWN database (its own Neon branch), split
    // out from the Unity-Chant-shared DB that the Vercel/Neon Storage integration
    // manages as DATABASE_URL. We read our own var first so the integration can
    // never silently revert the cutover; unset → falls back to the shared DB, i.e.
    // exactly the pre-split behavior.
    connectionString: process.env.CAFE_DATABASE_URL || process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30000,
    // Neon over home networks: connects can take seconds after an idle window,
    // and NAT silently kills idle TCP — keepalive + a generous timeout ride it out
    connectionTimeoutMillis: 15000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 5000,
  })

  if (!globalForPrisma.pool) {
    globalForPrisma.pool = pool
  }

  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

// Cache in all environments to reuse across warm invocations
globalForPrisma.prisma = prisma


// Connection warmer: ping every 20s to prevent Neon cold starts
const WARM_INTERVAL = 20_000
const warmKey = '__prisma_warm_interval'
const g = globalThis as unknown as { [key: string]: ReturnType<typeof setInterval> | undefined }
if (!g[warmKey]) {
  g[warmKey] = setInterval(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`
    } catch {
      // silent — connection will reconnect on next real query
    }
  }, WARM_INTERVAL)
}

export default prisma
