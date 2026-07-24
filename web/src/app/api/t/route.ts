import { isAdminToken } from '@/lib/adminAuth'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { logVisit, isHeadlessUA } from '@/lib/visits'

export const runtime = 'nodejs'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

/** POST /api/t — the page beacon. Body: { path, ref }. Fire-and-forget.
 *  sendBeacon carries the same-origin session cookie, so we can tag WHO is
 *  looking (owner / signed-in account / headless playtest / anonymous). */
export async function POST(req: NextRequest) {
  let body: { path?: string; ref?: string } = {}
  try { body = await req.json() } catch { /* sendBeacon may arrive as text */ }
  if (!body.path) return NextResponse.json({ ok: false }, { status: 400 })
  const ua = req.headers.get('user-agent')
  let who: string | null = null
  if (isHeadlessUA(ua)) {
    who = 'headless'
  } else {
    const email = (await getServerSession(authOptions).catch(() => null))?.user?.email?.toLowerCase()
    if (email) who = ADMIN_EMAILS.includes(email) ? 'owner' : 'account'
    // else null = an anonymous stranger — the number that means growth
  }
  await logVisit({
    kind: 'page',
    path: body.path,
    ref: body.ref || null,
    ua,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0] || null,
    who,
  })
  return NextResponse.json({ ok: true })
}

/** GET /api/t — summary for the admin (Bearer ENGINE_AGENT_TOKEN).
 *  ?hours=48 window. Counts by referrer host, top paths, uniques, agent hits. */
export async function GET(req: NextRequest) {
  if (!isAdminToken(req.headers.get('authorization'))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const hours = Math.min(24 * 30, Math.max(1, Number(req.nextUrl.searchParams.get('hours')) || 48))
  try {
    const [totals] = await prisma.$queryRaw<Array<{ pages: bigint; agents: bigint; mcp: bigint; uniques: bigint }>>`
      SELECT count(*) FILTER (WHERE kind = 'page') AS pages,
             count(*) FILTER (WHERE kind = 'agent') AS agents,
             count(*) FILTER (WHERE kind = 'mcp') AS mcp,
             count(DISTINCT vid) FILTER (WHERE kind = 'page') AS uniques
      FROM "Visit" WHERE ts > now() - make_interval(hours => ${hours})`
    // OUTSIDE — the honest answer to "any NEW visitors?". `who IS NULL` is an
    // anonymous stranger: not the owner, not a signed-in account, not one of our
    // headless playtests/probes. strangerUniques is the number that means reach.
    // (Older rows predate the `who` column and read NULL — so within a window
    // that straddles this deploy, treat strangerUniques as a floor, not gospel.)
    const [outside] = await prisma.$queryRaw<Array<{ owner: bigint; account: bigint; headless: bigint; stranger: bigint; strangerUniques: bigint }>>`
      SELECT count(*) FILTER (WHERE who = 'owner') AS owner,
             count(*) FILTER (WHERE who = 'account') AS account,
             count(*) FILTER (WHERE who = 'headless') AS headless,
             count(*) FILTER (WHERE who IS NULL) AS stranger,
             count(DISTINCT vid) FILTER (WHERE who IS NULL) AS "strangerUniques"
      FROM "Visit" WHERE ts > now() - make_interval(hours => ${hours}) AND kind = 'page'`
    // activation: worlds AND accounts actually created in the window (did people
    // BUILD or JOIN, not just look — the metrics that matter more than raw views).
    const [act] = await prisma.$queryRaw<Array<{ worlds: bigint }>>`
      SELECT count(*) AS worlds FROM "PlayerSpace" WHERE "createdAt" > now() - make_interval(hours => ${hours})`
    const [signups] = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM "User" WHERE "createdAt" > now() - make_interval(hours => ${hours})`
    const refs = await prisma.$queryRaw<Array<{ host: string; n: bigint }>>`
      SELECT COALESCE(NULLIF(split_part(split_part(ref, '://', 2), '/', 1), ''), '(direct)') AS host, count(*) AS n
      FROM "Visit" WHERE ts > now() - make_interval(hours => ${hours}) AND kind = 'page'
      GROUP BY 1 ORDER BY n DESC LIMIT 20`
    const paths = await prisma.$queryRaw<Array<{ path: string; kind: string; n: bigint }>>`
      SELECT path, kind, count(*) AS n
      FROM "Visit" WHERE ts > now() - make_interval(hours => ${hours})
      GROUP BY 1, 2 ORDER BY n DESC LIMIT 25`
    const j = (rows: object[]) => JSON.parse(JSON.stringify(rows, (_, v) => (typeof v === 'bigint' ? Number(v) : v)))
    return NextResponse.json({
      hours,
      totals: j([totals])[0] ?? { pages: 0, agents: 0, mcp: 0, uniques: 0 },
      outside: j([outside])[0] ?? { owner: 0, account: 0, headless: 0, stranger: 0, strangerUniques: 0 },
      activation: { worldsCreated: Number(act?.worlds ?? 0), signups: Number(signups?.n ?? 0) },
      referrers: j(refs),
      paths: j(paths),
    })
  } catch {
    return NextResponse.json({ hours, totals: { pages: 0, agents: 0, mcp: 0, uniques: 0 }, outside: { owner: 0, account: 0, headless: 0, stranger: 0, strangerUniques: 0 }, activation: { worldsCreated: 0, signups: 0 }, referrers: [], paths: [], note: 'no visits logged yet' })
  }
}
