// ContactMessage self-creates like EngineSlot does (store.ts ensureSlotTable):
// this stack has NO prisma migrations and `db push` can't run under the
// Prisma-7 driver-adapter config, so any new table must ensure itself
// idempotently from app code before first use.
import type { PrismaClient } from '@prisma/client'

let ensured = false

export async function ensureContactTable(prisma: PrismaClient): Promise<void> {
  if (ensured) return
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ContactMessage" (
    "id" TEXT PRIMARY KEY,
    "email" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ContactMessage_status_createdAt_idx" ON "ContactMessage"("status", "createdAt")`)
  ensured = true
}
