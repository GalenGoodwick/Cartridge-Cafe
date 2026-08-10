import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/adminAuth'
import { prisma } from '@/lib/prisma'
import { clampHours, sceneWorldLabel } from '@/lib/analytics-window'

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
  const wantAll = searchParams.get('alltime') === '1'
  const wantRefs = searchParams.get('refs') === '1'
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

    // PLAYTIME — how long bodies actually stayed (from play_session, the durable
    // heartbeat consumer). newcomerSeconds = time logged by visitors whose first
    // page-visit was in the window. Table may not exist until the first beat ever
    // lands — tolerate that with an empty result.
    type PlayRow = { scene: string; sessions: number; total_seconds: number; median_seconds: number; newcomer_seconds: number }
    const playtimeRows: PlayRow[] = wantPaths
      ? await prisma.$queryRawUnsafe<PlayRow[]>(`
          WITH firsts AS (
            SELECT vid, min(ts) AS first_seen FROM "Visit"
            WHERE kind = 'page' AND vid IS NOT NULL GROUP BY vid
          )
          SELECT p.scene,
                 count(*)::int AS sessions,
                 sum(p.seconds)::int AS total_seconds,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY p.seconds)::int AS median_seconds,
                 coalesce(sum(p.seconds) FILTER (WHERE f.first_seen > now() - interval '${hours} hours'), 0)::int AS newcomer_seconds
          FROM play_session p
          LEFT JOIN firsts f ON f.vid = p.vid
          WHERE p.last_beat_at > now() - interval '${hours} hours' AND p.seconds > 0
          GROUP BY p.scene
          ORDER BY total_seconds DESC
          LIMIT 40`).catch(() => [] as PlayRow[])
      : []

    // ALL-TIME — the lifetime picture. NOTE: vid is a salted DAILY hash, so
    // `distinct vid` counts a returning person once PER DAY → visitorDays is an
    // UPPER BOUND on unique humans, not a head-count (there is no lifetime-person
    // id, by privacy design). strangerDays excludes signed-in `who`.
    type AllRow = { pages: bigint; visitor_days: bigint; stranger_days: bigint; since: Date | null }
    const [allTime] = wantAll
      ? await prisma.$queryRaw<AllRow[]>`
          SELECT count(*) FILTER (WHERE kind = 'page') AS pages,
                 count(DISTINCT vid) FILTER (WHERE kind = 'page' AND (who IS DISTINCT FROM 'headless')) AS visitor_days,
                 count(DISTINCT vid) FILTER (WHERE kind = 'page' AND who IS NULL) AS stranger_days,
                 min(ts) FILTER (WHERE kind = 'page') AS since
          FROM "Visit"`
      : [undefined]

    // REFERRERS — where the traffic comes from, over the window. Reduce each
    // referrer to its host (reddit.com, google.com, t.co…); a missing referrer is
    // (direct) — a typed URL, a bookmark, or an app with no Referer header.
    type RefRow = { source: string; hits: number; visitors: number }
    const referrers = wantRefs
      ? await prisma.$queryRawUnsafe<RefRow[]>(`
          SELECT coalesce(nullif(split_part(regexp_replace(ref, '^https?://(www\\.)?', ''), '/', 1), ''), '(direct)') AS source,
                 count(*)::int AS hits,
                 count(DISTINCT vid)::int AS visitors
          FROM "Visit"
          WHERE kind = 'page' AND ts > now() - interval '${hours} hours'
          GROUP BY 1 ORDER BY hits DESC LIMIT 25`).catch(() => [] as RefRow[])
      : null

    return NextResponse.json({
      summary: {
        pages: Number(summary?.pages ?? 0),
        strangerUniques: Number(summary?.strangers ?? 0),
        agents: Number(summary?.agents ?? 0),
      },
      bridgePerHour: perHour.map(r => ({ hour: r.hour.toISOString(), n: Number(r.n) })),
      topTalkers: talkers.map(r => ({ who: r.who ?? 'untagged', hits: Number(r.n), last: r.last.toISOString() })),
      ...(wantPaths ? {
        window: { hours },
        worldPaths: worldPaths ?? [],
        playtime: playtimeRows.map(r => ({
          world: sceneWorldLabel(r.scene),
          scene: r.scene,
          sessions: r.sessions,
          totalSeconds: r.total_seconds,
          medianSeconds: r.median_seconds,
          newcomerSeconds: r.newcomer_seconds,
        })),
      } : {}),
      ...(wantAll ? {
        allTime: {
          pages: Number(allTime?.pages ?? 0),
          visitorDays: Number(allTime?.visitor_days ?? 0),   // distinct daily-vids — UPPER BOUND on unique people
          strangerDays: Number(allTime?.stranger_days ?? 0),
          since: allTime?.since ? new Date(allTime.since).toISOString() : null,
        },
      } : {}),
      ...(wantRefs ? { referrers: (referrers ?? []).map(r => ({ source: r.source, hits: r.hits, visitors: r.visitors })) } : {}),
    })
  } catch {
    return NextResponse.json({ error: 'analytics unavailable' }, { status: 500 })
  }
}
