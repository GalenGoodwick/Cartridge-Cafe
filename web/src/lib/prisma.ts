import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  pool: Pool | undefined
}

function createPrismaClient() {
  const pool = globalForPrisma.pool ?? new Pool({
    connectionString: process.env.DATABASE_URL,
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

// Schema bootstrap — the house pattern (see ensureSlotTable): no migration files
// exist, so additive DDL ships as idempotent statements run once per instance.
// This carries the Companion feature onto any database the app points at —
// without it, the new Prisma client selects PlayerSpace.createdByCompanionId
// on a DB that lacks it and every un-narrowed space query 500s.
const bootKey = '__prisma_ddl_boot'
const gb = globalThis as unknown as { [key: string]: boolean | undefined }
if (!gb[bootKey]) {
  gb[bootKey] = true
  void (async () => {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "PlayerSpace" ADD COLUMN IF NOT EXISTS "createdByCompanionId" TEXT`)
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Companion" (
        "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "handle" TEXT NOT NULL UNIQUE,
        "keyHash" TEXT NOT NULL UNIQUE, "keyPrefix" TEXT NOT NULL, "provenance" TEXT,
        "ownerId" TEXT NOT NULL, "worldsPerDay" INTEGER NOT NULL DEFAULT 20,
        "icon" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "lastActiveAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3)
      )`)
      await prisma.$executeRawUnsafe(`ALTER TABLE "Companion" ADD COLUMN IF NOT EXISTS "icon" JSONB`)
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Companion_ownerId_idx" ON "Companion"("ownerId")`)
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PlayerSpace_createdByCompanionId_idx" ON "PlayerSpace"("createdByCompanionId")`)
    } catch (e) {
      console.error('[prisma] schema bootstrap failed (will retry next cold start):', e)
      gb[bootKey] = false
    }
  })()
}

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
