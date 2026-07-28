import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/adminAuth'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const GUEST_SUFFIX = '@guest.cartridge.cafe'
const n = (v: unknown) => Number(v ?? 0)

/** GET /api/admin/stats — user / visitor / world metrics for the keeper.
 *  Real users vs guests (email @guest.cartridge.cafe), page-view visitors from
 *  the self-hosted Visit table (who IS NULL = anonymous strangers = real growth),
 *  worlds + guest worlds, and who's live right now. Read-only. */
export async function GET(req: NextRequest) {
  if (!(await isAdmin(req.headers.get('authorization')))) {
    return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  }
  const notGuest = { email: { not: { endsWith: GUEST_SUFFIX } } }
  const isGuest = { email: { endsWith: GUEST_SUFFIX } }

  const [
    usersReal, usersReal1d, usersReal7d, guestUsers, guestUsers7d,
    worldsTotal, worldsPublic, worlds1d, worlds7d, forks, aiWorlds, guestWorlds,
  ] = await Promise.all([
    prisma.user.count({ where: notGuest }),
    prisma.user.count({ where: { ...notGuest, createdAt: { gte: new Date(Date.now() - 864e5) } } }),
    prisma.user.count({ where: { ...notGuest, createdAt: { gte: new Date(Date.now() - 7 * 864e5) } } }),
    prisma.user.count({ where: isGuest }),
    prisma.user.count({ where: { ...isGuest, createdAt: { gte: new Date(Date.now() - 7 * 864e5) } } }),
    prisma.playerSpace.count(),
    prisma.playerSpace.count({ where: { isPublic: true } }),
    prisma.playerSpace.count({ where: { createdAt: { gte: new Date(Date.now() - 864e5) } } }),
    prisma.playerSpace.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 864e5) } } }),
    prisma.playerSpace.count({ where: { forkOfId: { not: null } } }),
    prisma.playerSpace.count({ where: { createdByCompanionId: { not: null } } }),
    prisma.playerSpace.count({ where: { owner: isGuest } }),
  ])

  // ── WHAT ARE THE 15k "users"? segment by real activity + email-domain pattern ──
  const [verified, withWorld, withSession, withAccount, withPasskey] = await Promise.all([
    prisma.user.count({ where: { ...notGuest, emailVerified: { not: null } } }),
    prisma.user.count({ where: { ...notGuest, ownedSpaces: { some: {} } } }),
    prisma.user.count({ where: { ...notGuest, sessions: { some: {} } } }),
    prisma.user.count({ where: { ...notGuest, accounts: { some: {} } } }),
    prisma.user.count({ where: { ...notGuest, passkeys: { some: {} } } }),
  ])
  const anyActivity = await prisma.user.count({ where: { ...notGuest, OR: [{ ownedSpaces: { some: {} } }, { sessions: { some: {} } }, { accounts: { some: {} } }, { passkeys: { some: {} } }] } })
  let topDomains: { domain: string; count: number }[] = []
  let signupsByDay: { day: string; count: number }[] = []
  try {
    topDomains = (await prisma.$queryRawUnsafe(`SELECT split_part(email,'@',2) AS domain, count(*) AS c FROM "User" WHERE email NOT LIKE '%@guest.cartridge.cafe' GROUP BY domain ORDER BY c DESC LIMIT 15`) as Record<string, unknown>[]).map(r => ({ domain: String(r.domain), count: n(r.c) }))
    signupsByDay = (await prisma.$queryRawUnsafe(`SELECT to_char(date_trunc('day',"createdAt"),'YYYY-MM-DD') AS day, count(*) AS c FROM "User" WHERE email NOT LIKE '%@guest.cartridge.cafe' AND "createdAt" >= now()-interval '45 days' GROUP BY day ORDER BY day DESC LIMIT 45`) as Record<string, unknown>[]).map(r => ({ day: String(r.day), count: n(r.c) }))
  } catch { /* raw query failed */ }
  const humans = { verified, everLoggedIn: withSession, withOAuth: withAccount, withPasskey, madeAWorld: withWorld, anyActivity }

  const recentWorlds = (await prisma.playerSpace.findMany({
    orderBy: { createdAt: 'desc' }, take: 15,
    select: { slug: true, name: true, createdAt: true, isPublic: true, createdByCompanionId: true, owner: { select: { email: true, name: true } } },
  })).map(w => ({
    slug: w.slug, name: w.name, at: w.createdAt,
    by: w.owner.email.endsWith(GUEST_SUFFIX) ? 'guest' : (w.owner.name || w.owner.email.split('@')[0]),
    guest: w.owner.email.endsWith(GUEST_SUFFIX), ai: !!w.createdByCompanionId, public: w.isPublic,
  }))

  // ── visitors (self-hosted Visit table; who IS NULL = anonymous stranger = growth) ──
  let visitors = { pv_1d: 0, pv_7d: 0, uniq_1d: 0, uniq_7d: 0, strangers_1d: 0, strangers_7d: 0 }
  let topPaths: { path: string; hits: number }[] = []
  let topRefs: { ref: string; hits: number }[] = []
  let liveNow = 0
  try {
    const v = (await prisma.$queryRawUnsafe(`
      SELECT
        count(*) FILTER (WHERE kind='page' AND ts >= now()-interval '24 hours') AS pv_1d,
        count(*) FILTER (WHERE kind='page' AND ts >= now()-interval '7 days')  AS pv_7d,
        count(DISTINCT vid) FILTER (WHERE kind='page' AND (who IS DISTINCT FROM 'headless') AND ts >= now()-interval '24 hours') AS uniq_1d,
        count(DISTINCT vid) FILTER (WHERE kind='page' AND (who IS DISTINCT FROM 'headless') AND ts >= now()-interval '7 days')  AS uniq_7d,
        count(DISTINCT vid) FILTER (WHERE kind='page' AND who IS NULL AND ts >= now()-interval '24 hours') AS strangers_1d,
        count(DISTINCT vid) FILTER (WHERE kind='page' AND who IS NULL AND ts >= now()-interval '7 days')  AS strangers_7d
      FROM "Visit"`) as Record<string, unknown>[])[0]
    visitors = { pv_1d: n(v.pv_1d), pv_7d: n(v.pv_7d), uniq_1d: n(v.uniq_1d), uniq_7d: n(v.uniq_7d), strangers_1d: n(v.strangers_1d), strangers_7d: n(v.strangers_7d) }
    topPaths = (await prisma.$queryRawUnsafe(`SELECT path, count(*) AS c FROM "Visit" WHERE kind='page' AND who IS NULL AND ts >= now()-interval '7 days' GROUP BY path ORDER BY c DESC LIMIT 10`) as Record<string, unknown>[]).map(r => ({ path: String(r.path), hits: n(r.c) }))
    topRefs = (await prisma.$queryRawUnsafe(`SELECT ref, count(*) AS c FROM "Visit" WHERE kind='page' AND who IS NULL AND ref IS NOT NULL AND ref <> '' AND ts >= now()-interval '7 days' GROUP BY ref ORDER BY c DESC LIMIT 8`) as Record<string, unknown>[]).map(r => ({ ref: String(r.ref), hits: n(r.c) }))
  } catch { /* Visit table not created yet (no visits) */ }
  try {
    liveNow = n((await prisma.$queryRawUnsafe(`SELECT count(DISTINCT id) AS c FROM cc_presence WHERE seen >= now()-interval '2 minutes'`) as Record<string, unknown>[])[0]?.c)
  } catch { /* presence table absent */ }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    users: { rows_nonGuest: usersReal, newRows_24h: usersReal1d, newRows_7d: usersReal7d, guests: guestUsers, newGuests_7d: guestUsers7d },
    humans,   // rows_nonGuest is just User table rows; THESE are the ones who actually did something
    userTopDomains: topDomains,
    signupsByDay,
    worlds: { total: worldsTotal, public: worldsPublic, new_24h: worlds1d, new_7d: worlds7d, guestMade: guestWorlds, aiMade: aiWorlds, forks },
    visitors,   // strangers_* = anonymous humans (real growth); uniq_* excludes our headless playtests
    liveNow,
    recentWorlds,
    topPaths, topRefs,
  })
}
