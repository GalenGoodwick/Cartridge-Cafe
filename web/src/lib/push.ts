import webpush from 'web-push'
import { prisma } from './prisma'

// Web-push for cartridge.cafe. Ported from Unity Chant, trimmed to the cafe's
// needs. The PushSubscription table SELF-CREATES (like ensurePasskeyTable /
// ensureCommunityTables) so production never needs a migration or a dangerous
// `prisma db push` — the cafe keeps raw-SQL tables out of the schema on purpose.

let tableReady = false
export async function ensurePushTable(): Promise<void> {
  if (tableReady) return
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "PushSubscription" (
    "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "endpoint" TEXT NOT NULL UNIQUE,
    "p256dh" TEXT NOT NULL, "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastUsedAt" TIMESTAMP(3))`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PushSubscription_userId_idx" ON "PushSubscription"("userId")`)
  tableReady = true
}

let vapidConfigured = false
function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:galen.goodwick@icloud.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    )
    vapidConfigured = true
    return true
  }
  return false
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

/** Fire a web-push to every browser a user has subscribed. Best-effort: prunes
 *  dead endpoints (410/404), never throws. Safe to call fire-and-forget. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!ensureVapidConfigured()) return   // no keys in this env — silently skip
  await ensurePushTable()
  const subs = await prisma.pushSubscription.findMany({ where: { userId } }).catch(() => [])
  await Promise.allSettled(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      )
      prisma.pushSubscription.update({ where: { id: sub.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
    } catch (err: unknown) {
      const code = (err as { statusCode?: number })?.statusCode
      if (code === 410 || code === 404) {
        prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {})
      }
    }
  }))
}

/** Cafe notification templates — keep tags stable so re-sends replace, not stack. */
export const cafePush = {
  worldBuilt: (name: string, slug: string): PushPayload => ({
    title: '✦ your world is ready',
    body: `"${name}" finished building — come see it.`,
    url: `/space/${slug}`,
    tag: `built-${slug}`,
  }),
  comment: (who: string, where: string, preview: string, url: string): PushPayload => ({
    title: `💬 ${who} in ${where}`,
    body: `"${preview}"`,
    url,
    tag: `comment-${url}`,   // stable per channel → a new message replaces the last, never stacks
  }),
  branch: (author: string, base: string, url: string): PushPayload => ({
    title: '⑂ new branch',
    body: `${author} branched ${base} — come see how it evolves.`,
    url,
    tag: `branch-${url}`,
  }),
}
