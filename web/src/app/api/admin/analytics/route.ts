import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/adminAuth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/** GET /api/admin/analytics — the keeper's passive traffic & bridge watch.
 *  Session-authed (same guard as /api/admin/worlds), so the browser needs no
 *  bearer token. Reads the self-hosted Visit log:
 *    - summary: humans vs agents over 48h
 *    - bridgePerHour: agent/mcp volume per hour (48h) — spot a runaway spike
 *    - topTalkers: agent/mcp hits per token tag (24h) — spot WHICH token is hot
 *  Token tags are 'type:hash8' (see bridge tokenTag) — never the raw token. */
export async function GET(req: NextRequest) {
  if (!(await isAdmin(req.headers.get('authorization')))) {
    return NextResponse.json({ error: 'not the keeper' }, { status: 403 })
  }
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

    return NextResponse.json({
      summary: {
        pages: Number(summary?.pages ?? 0),
        strangerUniques: Number(summary?.strangers ?? 0),
        agents: Number(summary?.agents ?? 0),
      },
      bridgePerHour: perHour.map(r => ({ hour: r.hour.toISOString(), n: Number(r.n) })),
      topTalkers: talkers.map(r => ({ who: r.who ?? 'untagged', hits: Number(r.n), last: r.last.toISOString() })),
    })
  } catch {
    return NextResponse.json({ error: 'analytics unavailable' }, { status: 500 })
  }
}
