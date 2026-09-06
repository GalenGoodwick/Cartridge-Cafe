// A tiny in-memory fake of the ATOMIC credit ledger's SQL surface (Sep 5) —
// unit tests exercise the REAL stripe.ts logic; only the database is faked.
// The fake honors the same semantics the live proof verified on Postgres:
// conditional decrement, PK'd grant idempotency, GREATEST floor.

export function makeFakeCreditDb() {
  const credits = new Map<string, number>()
  const grants = new Map<string, { userId: string; qty: number }>()
  const prisma = {
    async $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number> {
      if (sql.includes('CREATE TABLE')) return 0
      if (sql.startsWith('INSERT INTO cc_credits')) {
        const [uid, n] = args as [string, number]
        if (credits.has(uid)) return 0
        credits.set(uid, n); return 1
      }
      if (sql.startsWith('INSERT INTO cc_credit_grants')) {
        const [gid, uid, qty] = args as [string, string, number]
        if (grants.has(gid)) return 0
        grants.set(gid, { userId: uid, qty }); return 1
      }
      if (sql.includes('SET n = n + 1')) { const [uid] = args as [string]; credits.set(uid, (credits.get(uid) ?? 0) + 1); return 1 }
      if (sql.includes('SET n = n +')) { const [q, uid] = args as [number, string]; credits.set(uid, (credits.get(uid) ?? 0) + q); return 1 }
      if (sql.includes('GREATEST(0, n -')) { const [q, uid] = args as [number, string]; credits.set(uid, Math.max(0, (credits.get(uid) ?? 0) - q)); return 1 }
      throw new Error('fake-credit-db: unhandled execute — ' + sql.slice(0, 60))
    },
    async $queryRawUnsafe(sql: string, ...args: unknown[]): Promise<unknown[]> {
      if (sql.startsWith('SELECT n FROM cc_credits')) {
        const [uid] = args as [string]
        return credits.has(uid) ? [{ n: credits.get(uid) }] : []
      }
      if (sql.includes('SET n = n - 1 WHERE') && sql.includes('RETURNING')) {
        const [uid] = args as [string]
        const n = credits.get(uid) ?? 0
        if (n < 1) return []
        credits.set(uid, n - 1); return [{ n: n - 1 }]
      }
      throw new Error('fake-credit-db: unhandled query — ' + sql.slice(0, 60))
    },
  }
  return { prisma, credits, grants }
}
