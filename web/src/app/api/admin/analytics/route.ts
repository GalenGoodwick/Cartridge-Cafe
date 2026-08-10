import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/adminAuth'
import { prisma } from '@/lib/prisma'
import { clampHours } from '@/lib/analytics-window'

export const dynamic = 'force-dynamic'

/** GET /api/admin/analytics — the keeper's passive traffic & bridge watch.
 *  Session-authed (same guard as /api/admin/worlds), so the browser needs no
 *  bearer token. Reads the self-hosted Visit log:
 *    - summary: humans vs agents over 48h
 *    - bridgePerHour: agent/mcp volume per hour (48h) — spot a runaway spike
 *    - topTalkers: agent/mcp hits per token tag (24h) — spot WHICH token is hot
 *  Token tags are 'type:hash8' (see bridge tokenTag) — never the raw token.
 *
 *  ?paths=1&hours=N — adds `worldPaths`: which WORLDS got visited in the last N
 *  hours (default 12 ≈ overnight), each with total hits, unique visitors, how
 *  many were anonymous STRANGERS, and how many were NEWCOMERS (their first-ever
 *  visit to the cafe fell inside the window). Answers "did new people play, and
 *  which games?" ordered by newcomers, then hits. */
export async function GET(req: NextRequest) {
  if (!(await isAdmin(req.headers.get('authorization')))) {
    return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  }
  const { searchParams } = new URL(req.url)
  const wantPaths = searchParams.get('paths') === '1'
  const hours = clampHours(searchParams.get('hours'))
  try {
    const [summary] = await prisma.$queryRaw<Array<{ pages: bigint; strangers: bigint; agents: bigint }>>`
      SELECT count(*) FILTER (WHERE kind = 'page') AS pages,
             count(DISTINCT vid) FILTER (WHERE kind = 'page' AND who IS NULL) AS strangers,
             count(*) FILTER (WHERE kind IN ('agent', 'mcp')) AS agents
      FROM "Visit" WHERE ts > now() - interval '48 hours'`

    const perHour = await prisma.$queryRaw<Array<{ hour: Date; n: bigint }>>`
      SELECT date_trunc('hour', ts) AS hour, count(*) AS n
      FROM "Visit" WHERE kind IN ('agent', 'mcp') AND ts > now() - interval '48 hours'
      GROUP BY 1 ORDER BY 1`

    const talkers = await prisma.$queryRaw<Array<{ who: string | null; n: bigint; last: Date }>>`
      SELECT who, count(*) AS n, max(ts) AS last
      FROM "Visit" WHERE kind IN ('agent', 'mcp') AND ts > now() - interval '24 hours'
      GROUP BY who ORDER BY 2 DESC LIMIT 12`

    // ?paths=1 — which WORLDS were visited in the window, and how much of that was
    // newcomers. `hours` is a clamped integer, so interpolating it into the SQL
    // interval is safe (no user string ever reaches the query). A "newcomer" is a
    // vid whose FIRST-EVER page visit landed inside the window.
    type PathRow = { path: string; hits: number; visitors: number; strangers: number; newcomers: number }
    const worldPaths = wantPaths
      ? await prisma.$queryRawUnsafe<PathRow[]>(`
          WITH firsts AS (
            SELECT vid, min(ts) AS first_seen FROM "Visit"
            WHERE kind = 'page' AND vid IS NOT NULL GROUP BY vid
          )
          SELECT v.path,
                 count(*)::int AS hits,
                 count(DISTINCT v.vid)::int AS visitors,
                 count(DISTINCT v.vid) FILTER (WHERE v.who IS NULL)::int AS strangers,
                 count(DISTINCT v.vid) FILTER (WHERE f.first_seen > now() - interval '${hours} hours')::int AS newcomers
          FROM "Visit" v
          LEFT JOIN firsts f ON f.vid = v.vid
          WHERE v.kind = 'page' AND v.ts > now() - interval '${hours} hours'
            AND (v.path LIKE '/space/%' OR v.path LIKE '/hub/%' OR v.path LIKE '/p/%')
          GROUP BY v.path
          ORDER BY newcomers DESC, hits DESC
          LIMIT 40`)
      : null

    return NextResponse.json({
      summary: {
        pages: Number(summary?.pages ?? 0),
        strangerUniques: Number(summary?.strangers ?? 0),
        agents: Number(summary?.agents ?? 0),
      },
      bridgePerHour: perHour.map(r => ({ hour: r.hour.toISOString(), n: Number(r.n) })),
      topTalkers: talkers.map(r => ({ who: r.who ?? 'untagged', hits: Number(r.n), last: r.last.toISOString() })),
      ...(wantPaths ? { window: { hours }, worldPaths: worldPaths ?? [] } : {}),
    })
  } catch {
    return NextResponse.json({ error: 'analytics unavailable' }, { status: 500 })
  }
}
