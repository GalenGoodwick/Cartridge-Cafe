import { prisma } from './prisma'

/** Notifications + follows — the belonging layer. Self-creating tables
 *  (the EngineSlot pattern): no migration step, works on prod at first touch. */

let ready = false
export async function ensureCommunityTables(): Promise<void> {
  if (ready) return
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Notif" (
    "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL, "link" TEXT, "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Notif_user_idx" ON "Notif"("userId", "createdAt")`)
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Follow" (
    "followerId" TEXT NOT NULL, "followeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("followerId", "followeeId"))`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Follow_followee_idx" ON "Follow"("followeeId")`)
  ready = true
}

const cuid = () => 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)

export async function notifyUser(userId: string, kind: string, text: string, link?: string): Promise<void> {
  try {
    await ensureCommunityTables()
    await prisma.$executeRaw`INSERT INTO "Notif" ("id", "userId", "kind", "text", "link")
      VALUES (${cuid()}, ${userId}, ${kind}, ${text.slice(0, 300)}, ${link?.slice(0, 300) ?? null})`
  } catch { /* notifying must never break the action that caused it */ }
}

export function handleOf(email: string): string {
  return email.split('@')[0].replace(/[^a-z0-9_-]/gi, '')
}

/** Resolve a profile handle back to users (email local-part, sanitized).
 *  handleOf strips dots/plus-tags, so a prefix match on the raw email misses
 *  addresses like galen.goodwick@ — match on the sanitized form instead. */
export async function usersByHandle(handle: string): Promise<Array<{ id: string; email: string; name: string | null }>> {
  const clean = handle.replace(/[^a-z0-9_-]/gi, '')
  if (!clean) return []
  const rows = await prisma.$queryRaw<Array<{ id: string; email: string; name: string | null }>>`
    SELECT "id", "email", "name" FROM "User"
    WHERE regexp_replace(split_part("email", '@', 1), '[^a-zA-Z0-9_-]', '', 'g') = ${clean}
    LIMIT 20`
  return rows
}

/** The site's human admins own the canonical worlds — branch notifications land here. */
export async function adminUsers(): Promise<Array<{ id: string }>> {
  const admins = (process.env.ADMIN_EMAILS || '').split(',').map(a => a.trim().toLowerCase()).filter(Boolean)
  if (!admins.length) return []
  return prisma.user.findMany({ where: { email: { in: admins } }, select: { id: true } })
}
