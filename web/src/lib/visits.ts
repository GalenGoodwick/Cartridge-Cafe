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
  tableReady = true
}

export function visitorId(ip: string, ua: string): string {
  const day = new Date().toISOString().slice(0, 10)
  const salt = process.env.NEXTAUTH_SECRET || 'cafe'
  return createHash('sha256').update(`${day}|${salt}|${ip}|${ua}`).digest('hex').slice(0, 16)
}

export async function logVisit(v: { kind: 'page' | 'agent' | 'mcp'; path: string; ref?: string | null; ua?: string | null; ip?: string | null }) {
  try {
    await ensureTable()
    const vid = visitorId(v.ip || '', v.ua || '')
    await prisma.$executeRaw`INSERT INTO "Visit" (kind, path, ref, ua, vid)
      VALUES (${v.kind}, ${v.path.slice(0, 300)}, ${(v.ref || '').slice(0, 300) || null}, ${(v.ua || '').slice(0, 300) || null}, ${vid})`
  } catch { /* logging must never break the page */ }
}
