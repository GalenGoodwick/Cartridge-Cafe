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
    users: { real: usersReal, newReal_24h: usersReal1d, newReal_7d: usersReal7d, guests: guestUsers, newGuests_7d: guestUsers7d },
    worlds: { total: worldsTotal, public: worldsPublic, new_24h: worlds1d, new_7d: worlds7d, guestMade: guestWorlds, aiMade: aiWorlds, forks },
    visitors,   // strangers_* = anonymous humans (real growth); uniq_* excludes our headless playtests
    liveNow,
    recentWorlds,
    topPaths, topRefs,
  })
}
