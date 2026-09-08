// The ONE idempotent, credit-safe world-creation service. Every birth door
// (Create UI, POST /api/spaces, bridge create_world / MCP brew_world) funnels the
// credit-spend + birth through here so retries can neither double-charge nor
// double-create, and a failed birth never leaves a charge behind.
//
// Mechanism: a raw-SQL `cc_world_create` row keyed on the caller's idempotencyKey
// doubles as a claim-lock and a result pointer (→ space_id). CLAIM + CHARGE happen
// in one transaction (you cannot claim without charging, nor charge without
// claiming); the heavy birthWorld runs after and is compensated (refund + release
// the key) on failure. A retry with the same key REPLAYS: it returns the already
// created world with a fresh build key (a space may hold many keys) — never a
// second world, never a second charge. Matches the raw-SQL pattern the credit
// tables already use (see stripe.ts).

import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { birthWorld } from '@/lib/world-create'
import { readGenCredits, refundGenCredit } from '@/lib/stripe'

type BirthOpts = Parameters<typeof birthWorld>[0]

export type CreateOutcome =
  | { ok: true; space: Awaited<ReturnType<typeof birthWorld>>['space']; token: string; replayed: boolean }
  | { ok: false; reason: 'needPayment' }
  | { ok: false; reason: 'inFlight' }
  | { ok: false; reason: 'error'; message: string }

/** Age (seconds) after which a claimed-but-unfinished row is treated as a dead
 *  prior attempt and may be re-driven (the process died between charge and birth). */
const STALE_CLAIM_S = 45

async function ensureTable(): Promise<void> {
  const g = globalThis as unknown as { __ccWorldCreateTable?: boolean }
  if (g.__ccWorldCreateTable) return
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS cc_world_create (
    idem_key TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    space_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
  g.__ccWorldCreateTable = true
}

/** Mint a fresh uc_st_ build key for an existing space (a space may hold many —
 *  used on replay so a retried create still returns a working token). */
async function mintBuildKey(spaceId: string): Promise<string> {
  const token = `uc_st_${crypto.randomBytes(16).toString('hex')}`
  await prisma.spaceToken.create({
    data: { name: 'build key', tokenHash: crypto.createHash('sha256').update(token).digest('hex'), tokenPrefix: token.slice(0, 12) + '...', spaceId },
  })
  return token
}

/** Claim the idempotency key AND spend one credit in a single transaction.
 *  Returns 'claimed' (proceed to birth), 'replay' (key already taken — caller
 *  reads the existing result), or 'nocredit' (claim rolled back, key left free). */
async function claimAndCharge(ownerId: string, idemKey: string, isKeeper: boolean): Promise<'claimed' | 'replay' | 'nocredit'> {
  try {
    return await prisma.$transaction(async (tx) => {
      const inserted = await tx.$executeRawUnsafe(
        `INSERT INTO cc_world_create (idem_key, user_id) VALUES ($1, $2) ON CONFLICT (idem_key) DO NOTHING`, idemKey, ownerId)
      if (inserted === 0) return 'replay' as const
      if (isKeeper) return 'claimed' as const     // keepers build free — claim without charge
      const rows = await tx.$queryRawUnsafe<{ n: number }[]>(
        `UPDATE cc_credits SET n = n - 1 WHERE user_id = $1 AND n >= 1 RETURNING n`, ownerId)
      if (!rows.length) throw new Error('__NO_CREDIT__')  // roll back the claim: key stays free to retry
      return 'claimed' as const
    })
  } catch (e) {
    if (e instanceof Error && e.message === '__NO_CREDIT__') return 'nocredit'
    throw e
  }
}

/** Read an existing idempotency row's result (space_id + age). */
async function readClaim(idemKey: string): Promise<{ spaceId: string | null; ageS: number } | null> {
  const rows = await prisma.$queryRawUnsafe<{ space_id: string | null; age_s: number }[]>(
    `SELECT space_id, EXTRACT(EPOCH FROM (now() - created_at)) AS age_s FROM cc_world_create WHERE idem_key = $1`, idemKey)
  if (!rows.length) return null
  return { spaceId: rows[0].space_id, ageS: Number(rows[0].age_s) }
}

/** Replay lookup: if this key already produced a world, return it with a fresh
 *  build key (else null). Doors call this BEFORE their name twin-guard so a retry
 *  returns the existing world instead of a "you already own that name" rejection. */
export async function peekCreate(idempotencyKey: string): Promise<{ space: Awaited<ReturnType<typeof birthWorld>>['space']; token: string } | null> {
  await ensureTable()
  const claim = await readClaim(idempotencyKey)
  if (claim?.spaceId) {
    const space = await prisma.playerSpace.findUnique({ where: { id: claim.spaceId } })
    if (space) return { space, token: await mintBuildKey(space.id) }
  }
  return null
}

/**
 * Create a world idempotently. `idempotencyKey` MUST be stable across a caller's
 * retries of the SAME logical create. `birth` is the fully-resolved birthWorld
 * input (build it from a BuildSpec via the build-spec.ts mappers + any base/fork
 * resolution). `isKeeper` skips the credit charge.
 */
export async function createWorldIdempotent(args: {
  ownerId: string
  idempotencyKey: string
  isKeeper: boolean
  birth: BirthOpts
}): Promise<CreateOutcome> {
  const { ownerId, idempotencyKey, isKeeper, birth } = args
  await readGenCredits(ownerId) // seeds cc_credits row + ensures the credit tables exist
  await ensureTable()

  let disposition = await claimAndCharge(ownerId, idempotencyKey, isKeeper)

  if (disposition === 'nocredit') return { ok: false, reason: 'needPayment' }

  if (disposition === 'replay') {
    const claim = await readClaim(idempotencyKey)
    if (claim?.spaceId) {
      const space = await prisma.playerSpace.findUnique({ where: { id: claim.spaceId } })
      if (space) return { ok: true, space, token: await mintBuildKey(space.id), replayed: true }
    }
    // claimed but not yet finished
    if (claim && claim.ageS < STALE_CLAIM_S) return { ok: false, reason: 'inFlight' }
    // a dead prior attempt: take it over and drive the birth ourselves
    disposition = 'claimed'
  }

  // disposition === 'claimed' — charge is done (unless keeper); do the birth
  try {
    const { space, token } = await birthWorld(birth)
    await prisma.$executeRawUnsafe(`UPDATE cc_world_create SET space_id = $1 WHERE idem_key = $2`, space.id, idempotencyKey)
    return { ok: true, space, token, replayed: false }
  } catch (e) {
    // compensate: refund the credit and RELEASE the key so a clean retry can run
    if (!isKeeper) await refundGenCredit(ownerId).catch(() => {})
    await prisma.$executeRawUnsafe(`DELETE FROM cc_world_create WHERE idem_key = $1 AND space_id IS NULL`, idempotencyKey).catch(() => {})
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : 'world creation failed' }
  }
}
