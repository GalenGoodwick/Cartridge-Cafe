import { isAdminToken } from '@/lib/adminAuth'
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { logVisit } from '@/lib/visits'

export const runtime = 'nodejs'

/** POST /api/t — the page beacon. Body: { path, ref }. Fire-and-forget. */
export async function POST(req: NextRequest) {
  let body: { path?: string; ref?: string } = {}
  try { body = await req.json() } catch { /* sendBeacon may arrive as text */ }
  if (!body.path) return NextResponse.json({ ok: false }, { status: 400 })
  await logVisit({
    kind: 'page',
    path: body.path,
    ref: body.ref || null,
    ua: req.headers.get('user-agent'),
    ip: req.headers.get('x-forwarded-for')?.split(',')[0] || null,
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
    // activation: worlds actually created in the window (the metric that matters
    // more than raw visits — did people BUILD, not just look).
    const [act] = await prisma.$queryRaw<Array<{ worlds: bigint }>>`
      SELECT count(*) AS worlds FROM "PlayerSpace" WHERE "createdAt" > now() - make_interval(hours => ${hours})`
    const refs = await prisma.$queryRaw<Array<{ host: string; n: bigint }>>`
      SELECT COALESCE(NULLIF(split_part(split_part(ref, '://', 2), '/', 1), ''), '(direct)') AS host, count(*) AS n
      FROM "Visit" WHERE ts > now() - make_interval(hours => ${hours}) AND kind = 'page'
      GROUP BY 1 ORDER BY n DESC LIMIT 20`
    const paths = await prisma.$queryRaw<Array<{ path: string; kind: string; n: bigint }>>`
      SELECT path, kind, count(*) AS n
      FROM "Visit" WHERE ts > now() - make_interval(hours => ${hours})
      GROUP BY 1, 2 ORDER BY n DESC LIMIT 25`
    const j = (rows: object[]) => JSON.parse(JSON.stringify(rows, (_, v) => (typeof v === 'bigint' ? Number(v) : v)))
    return NextResponse.json({ hours, totals: j([totals])[0] ?? { pages: 0, agents: 0, mcp: 0, uniques: 0 }, activation: { worldsCreated: Number(act?.worlds ?? 0) }, referrers: j(refs), paths: j(paths) })
  } catch {
    return NextResponse.json({ hours, totals: { pages: 0, agents: 0, mcp: 0, uniques: 0 }, activation: { worldsCreated: 0 }, referrers: [], paths: [], note: 'no visits logged yet' })
  }
}
