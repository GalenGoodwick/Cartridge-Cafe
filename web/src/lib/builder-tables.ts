import { prisma } from '@/lib/prisma'

// Self-creating Builder + BuildJob tables. These are real Prisma models, but they
// were never migrated onto prod — and `prisma db push` can't run there safely
// (it would drop the co-agent's unmodeled Notif/CafeFollow tables). So the build
// system creates them on demand, additively, matching EXACTLY the structure
// Prisma generated on dev (introspected column-for-column) so prisma.buildJob /
// prisma.builder queries work against them identically. Idempotent + guarded.

let ensured = false

export async function ensureBuilderTables(): Promise<void> {
  if (ensured) return
  // the status enum — CREATE TYPE has no IF NOT EXISTS, so guard it
  await prisma.$executeRawUnsafe(`DO $$ BEGIN
    CREATE TYPE "BuildJobStatus" AS ENUM ('pending','leased','building','done','needs_review','rejected');
  EXCEPTION WHEN duplicate_object THEN null; END $$;`)
  // added later (same additive pattern): revalidate() cancels queued jobs whose
  // consent evaporated. ADD VALUE is idempotent with IF NOT EXISTS.
  await prisma.$executeRawUnsafe(`ALTER TYPE "BuildJobStatus" ADD VALUE IF NOT EXISTS 'cancelled'`)

  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Builder" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "reputation" INTEGER NOT NULL DEFAULT 0,
    "jobsDone" INTEGER NOT NULL DEFAULT 0,
    "abandons" INTEGER NOT NULL DEFAULT 0,
    "idleOnly" BOOLEAN NOT NULL DEFAULT true,
    "maxConcurrent" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "Builder_pkey" PRIMARY KEY ("id"))`)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Builder_tokenHash_key" ON "Builder"("tokenHash")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Builder_ownerId_idx" ON "Builder"("ownerId")`)

  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "BuildJob" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT,
    "sceneName" TEXT,
    "spaceSlug" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "status" "BuildJobStatus" NOT NULL DEFAULT 'pending',
    "leaseHolderId" TEXT,
    "leaseExpires" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "attemptedBy" TEXT[],
    "history" JSONB[],
    "preSnapshot" JSONB,
    "escalatedHouse" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BuildJob_pkey" PRIMARY KEY ("id"))`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BuildJob_status_idx" ON "BuildJob"("status")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BuildJob_spaceId_idx" ON "BuildJob"("spaceId")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BuildJob_leaseExpires_idx" ON "BuildJob"("leaseExpires")`)

  ensured = true
}
