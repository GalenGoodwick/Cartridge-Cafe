import { createHash } from 'crypto'
import prisma from './prisma'

/** Self-hosted visit log — our data, our DB, no third party.
 *  One narrow table, raw SQL so it needs no Prisma migration lockstep:
 *  the table creates itself on first write. `kind` separates human page
 *  views (beacon) from agent API hits (guide/bridge). `vid` is a salted
 *  daily hash of ip+ua — uniques without storing anyone's address. */

let tableReady = false
async function ensureTable() {
  if (tableReady) return
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Visit" (
    id bigserial PRIMARY KEY,
    kind text NOT NULL DEFAULT 'page',
    path text NOT NULL,
    ref text,
    ua text,
    vid text,
    ts timestamptz NOT NULL DEFAULT now()
  )`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Visit_ts_idx" ON "Visit" (ts)`)
  // `who` splits page views by WHO is looking, so "any new visitors?" has a real
  // answer: 'owner' (the site's admin — me/Galen), 'account' (a signed-in
  // non-admin), 'headless' (an in-house playtest browser), or null (an
  // anonymous stranger — the number that actually means growth). Self-migrating
  // ADD COLUMN so no Prisma lockstep, like the table itself.
  await prisma.$executeRawUnsafe(`ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS who text`)
  tableReady = true
}

/** A headless/automated browser — our own playtests + probes, not a visitor.
 *  They load real pages and fire the beacon, so they inflate "uniques" unless
 *  tagged. Playwright/puppeteer default to a HeadlessChrome UA. */
export function isHeadlessUA(ua: string | null | undefined): boolean {
  if (!ua) return false
  return /headless|playwright|puppeteer|bot|crawl|spider|curl|node-fetch|python-requests/i.test(ua)
}

export function visitorId(ip: string, ua: string): string {
  const day = new Date().toISOString().slice(0, 10)
  const salt = process.env.NEXTAUTH_SECRET || 'cafe'
  return createHash('sha256').update(`${day}|${salt}|${ip}|${ua}`).digest('hex').slice(0, 16)
}

/** Realign the bigserial id sequence to the table's real max. A DB branch/copy
 *  (e.g. the Jul 2026 prod split) can leave "Visit_id_seq" behind max(id), so
 *  nextval hands out ids that already exist and every INSERT dies on the pkey.
 *  That is silent when swallowed — it dark-holed 2 days of analytics once. */
async function resyncSeq() {
  await prisma.$executeRawUnsafe(`SELECT setval('"Visit_id_seq"', (SELECT COALESCE(max(id), 1) FROM "Visit"))`)
}

// Rate-limit the error log so a persistently broken write path warns without
// flooding — one shout per minute is enough to notice in the dashboard.
let lastLoggedErrAt = 0

export async function logVisit(v: { kind: 'page' | 'agent' | 'mcp'; path: string; ref?: string | null; ua?: string | null; ip?: string | null; who?: string | null }) {
  const insert = () => {
    const vid = visitorId(v.ip || '', v.ua || '')
    return prisma.$executeRaw`INSERT INTO "Visit" (kind, path, ref, ua, vid, who)
      VALUES (${v.kind}, ${v.path.slice(0, 300)}, ${(v.ref || '').slice(0, 300) || null}, ${(v.ua || '').slice(0, 300) || null}, ${vid}, ${v.who ?? null})`
  }
  try {
    await ensureTable()
    try {
      await insert()
    } catch (e) {
      // A desynced sequence surfaces as a duplicate-key violation (pg 23505).
      // Self-heal: realign the sequence and retry once, so logging recovers on
      // its own instead of going dark until someone notices the flat line.
      if (String((e as { code?: string })?.code) === '23505' || /duplicate key/i.test(String(e))) {
        await resyncSeq()
        await insert()
      } else {
        throw e
      }
    }
  } catch (e) {
    // Logging must never break the page — but it must not fail SILENTLY either
    // (that hid the Jul 2026 sequence break for two days). Shout, rate-limited.
    const now = Date.now()
    if (now - lastLoggedErrAt > 60_000) {
      lastLoggedErrAt = now
      console.error('[visits] logVisit failed:', (e as Error)?.message || e)
    }
  }
}
