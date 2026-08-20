import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/adminAuth'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const GUEST_SUFFIX = '@guest.cartridge.cafe'
const n = (v: unknown) => Number(v ?? 0)
const DAY = 864e5
/** run a query; on ANY error return `fb` and record the failure — one broken
 *  query (e.g. a table the shared/legacy DB shapes differently) must not 500
 *  the whole report. The `fails` list tells us WHAT the shared DB is missing. */
const fails: string[] = []
async function safe<T>(label: string, fb: T, fn: () => Promise<T>): Promise<T> {
  try { return await fn() } catch (e) { fails.push(`${label}: ${(e as Error)?.message?.slice(0, 120) || 'err'}`); return fb }
}

/** GET /api/admin/stats — user / visitor / world metrics for the keeper. Read-only.
 *  As of the Jul 2026 DB split the cafe runs on its OWN Neon branch (CAFE_DATABASE_URL),
 *  no longer sharing User/Account/Session with the Unity Chant app — so the counts here
 *  are cafe-only. `humans.*` remain useful real-activity signals (world made, passkey,
 *  companion, OAuth) but no longer need to subtract an inherited agent pool. */
export async function GET(req: NextRequest) {
  if (!(await isAdmin(req.headers.get('authorization')))) {
    return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  }
  fails.length = 0
  const notGuest = { email: { not: { endsWith: GUEST_SUFFIX } } }
  const isGuest = { email: { endsWith: GUEST_SUFFIX } }
  const since = (ms: number) => ({ gte: new Date(Date.now() - ms) })

  const users = {
    rows_nonGuest: await safe('users.total', 0, () => prisma.user.count({ where: notGuest })),
    newRows_24h: await safe('users.new24h', 0, () => prisma.user.count({ where: { ...notGuest, createdAt: since(DAY) } })),
    newRows_7d: await safe('users.new7d', 0, () => prisma.user.count({ where: { ...notGuest, createdAt: since(7 * DAY) } })),
    guests: await safe('users.guests', 0, () => prisma.user.count({ where: isGuest })),
  }

  // cafe-activity signals — real engagement (world made / passkey / OAuth)
  const humans = {
    madeAWorld: await safe('humans.world', 0, () => prisma.user.count({ where: { ...notGuest, ownedSpaces: { some: {} } } })),
    withPasskey: await safe('humans.passkey', 0, () => prisma.user.count({ where: { ...notGuest, passkeys: { some: {} } } })),
    everLoggedIn_sharedAuth: await safe('humans.session', 0, () => prisma.user.count({ where: { ...notGuest, sessions: { some: {} } } })),
    withOAuth_sharedAuth: await safe('humans.account', 0, () => prisma.user.count({ where: { ...notGuest, accounts: { some: {} } } })),
    verified: await safe('humans.verified', 0, () => prisma.user.count({ where: { ...notGuest, emailVerified: { not: null } } })),
  }

  const worlds = {
    total: await safe('worlds.total', 0, () => prisma.playerSpace.count()),
    public: await safe('worlds.public', 0, () => prisma.playerSpace.count({ where: { isPublic: true } })),
    new_24h: await safe('worlds.new24h', 0, () => prisma.playerSpace.count({ where: { createdAt: since(DAY) } })),
    new_7d: await safe('worlds.new7d', 0, () => prisma.playerSpace.count({ where: { createdAt: since(7 * DAY) } })),
    guestMade: await safe('worlds.guest', 0, () => prisma.playerSpace.count({ where: { owner: isGuest } })),
  }

  const recentWorlds = await safe('recentWorlds', [] as unknown[], async () =>
    (await prisma.playerSpace.findMany({
      orderBy: { createdAt: 'desc' }, take: 15,
      select: { slug: true, name: true, createdAt: true, isPublic: true, owner: { select: { email: true, name: true } } },
    })).map(w => ({ slug: w.slug, name: w.name, at: w.createdAt, by: w.owner.email.endsWith(GUEST_SUFFIX) ? 'guest' : (w.owner.name || w.owner.email.split('@')[0]), guest: w.owner.email.endsWith(GUEST_SUFFIX), public: w.isPublic })))

  const userTopDomains = await safe('topDomains', [] as { domain: string; count: number }[], async () =>
    (await prisma.$queryRawUnsafe(`SELECT split_part(email,'@',2) AS domain, count(*) AS c FROM "User" WHERE email NOT LIKE '%@guest.cartridge.cafe' GROUP BY domain ORDER BY c DESC LIMIT 15`) as Record<string, unknown>[]).map(r => ({ domain: String(r.domain), count: n(r.c) })))

  const signupsByDay = await safe('signupsByDay', [] as { day: string; count: number }[], async () =>
    (await prisma.$queryRawUnsafe(`SELECT to_char(date_trunc('day',"createdAt"),'YYYY-MM-DD') AS day, count(*) AS c FROM "User" WHERE "createdAt" >= now()-interval '60 days' GROUP BY day ORDER BY day DESC LIMIT 60`) as Record<string, unknown>[]).map(r => ({ day: String(r.day), count: n(r.c) })))

  const visitors = await safe('visitors', { pv_1d: 0, pv_7d: 0, uniq_7d: 0, strangers_1d: 0, strangers_7d: 0 }, async () => {
    const v = (await prisma.$queryRawUnsafe(`SELECT
      count(*) FILTER (WHERE kind='page' AND ts >= now()-interval '24 hours') AS pv_1d,
      count(*) FILTER (WHERE kind='page' AND ts >= now()-interval '7 days')  AS pv_7d,
      count(DISTINCT vid) FILTER (WHERE kind='page' AND (who IS DISTINCT FROM 'headless') AND ts >= now()-interval '7 days') AS uniq_7d,
      count(DISTINCT vid) FILTER (WHERE kind='page' AND who IS NULL AND ts >= now()-interval '24 hours') AS strangers_1d,
      count(DISTINCT vid) FILTER (WHERE kind='page' AND who IS NULL AND ts >= now()-interval '7 days')  AS strangers_7d
      FROM "Visit"`) as Record<string, unknown>[])[0]
    return { pv_1d: n(v.pv_1d), pv_7d: n(v.pv_7d), uniq_7d: n(v.uniq_7d), strangers_1d: n(v.strangers_1d), strangers_7d: n(v.strangers_7d) }
  })
  const liveNow = await safe('liveNow', 0, async () => n((await prisma.$queryRawUnsafe(`SELECT count(DISTINCT id) AS c FROM cc_presence WHERE seen >= now()-interval '2 minutes'`) as Record<string, unknown>[])[0]?.c))

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    _note: 'Cafe runs on its own Neon branch (CAFE_DATABASE_URL) since the Jul 2026 split — counts are cafe-only. humans.* = real cafe activity.',
    users, humans, worlds, visitors, liveNow, recentWorlds, userTopDomains, signupsByDay,
    _queryFailures: fails,
  })
}
