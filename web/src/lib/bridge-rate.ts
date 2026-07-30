import { prisma } from './prisma'
import { checkRateLimit } from './rate-limit'

/** Global (cross-instance) per-token rate cap for the bridge.
 *
 *  The in-memory limiter counts PER serverless instance, so Vercel spreading a
 *  token's requests across instances dilutes the real cap. This keeps ONE tally
 *  in the DB that every instance shares, via an atomic upsert per call — so the
 *  count is the token's TRUE volume "in the channel", not one instance's slice.
 *
 *  Tumbling 1-minute window: the count lives under a per-minute bucket keyed off
 *  the DB clock (consistent across instances). It's not a ban — a fresh minute
 *  resets the count, so a token regains full capacity within ~60s of easing off.
 *  No manual unban, no permanent lockout. */

const LIMIT = 180 // requests per token per minute — generous; only a runaway trips it

let tableReady = false
async function ensureTable(): Promise<void> {
  if (tableReady) return
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS cc_bridge_rate (
    k      text   NOT NULL,
    bucket bigint NOT NULL,
    n      int    NOT NULL DEFAULT 0,
    PRIMARY KEY (k, bucket)
  )`)
  tableReady = true
}

/** True if THIS call puts the token over the limit for the current minute.
 *  Atomic: the upsert increments and returns the new count in one statement, so
 *  concurrent instances can't race past the cap. Fails OPEN — a DB hiccup must
 *  never block a legit build, so it falls back to the per-instance limiter. */
export async function bridgeOverLimit(tokenKey: string): Promise<boolean> {
  try {
    await ensureTable()
    const rows = await prisma.$queryRaw<Array<{ n: number }>>`
      INSERT INTO cc_bridge_rate (k, bucket, n)
      VALUES (${tokenKey}, (extract(epoch FROM now())::bigint / 60), 1)
      ON CONFLICT (k, bucket) DO UPDATE SET n = cc_bridge_rate.n + 1
      RETURNING n`
    const n = Number(rows[0]?.n ?? 0)
    // First hit of a new bucket → opportunistically drop buckets >2 min old,
    // so the table never grows beyond the handful of currently-active tokens.
    if (n === 1) {
      prisma.$executeRawUnsafe(
        `DELETE FROM cc_bridge_rate WHERE bucket < (extract(epoch FROM now())::bigint / 60) - 2`,
      ).catch(() => {})
    }
    return n > LIMIT
  } catch {
    // DB unreachable → don't hard-fail the bridge; fall back to the in-memory
    // per-instance cap (a weaker but non-zero speed bump) rather than block all.
    return checkRateLimit('bridge', tokenKey)
  }
}
