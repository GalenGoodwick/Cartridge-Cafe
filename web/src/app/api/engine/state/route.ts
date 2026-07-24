import { isAdminToken } from '@/lib/adminAuth'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { setFieldSnapshots, getFieldSnapshot, getEngineState, claimWriter } from '../store'
import { setSpaceSnapshot, getSpaceSnapshot, validateSpaceToken } from '../space-store'
import type { FieldSnapshot, SceneSnapshot } from '@/app/engine/types'

/** Writing a world's snapshot (fields, HOOKS, everything) demands authority
 *  for THAT world — never just "any logged-in session". Authority is:
 *   · the admin engine token, or
 *   · a uc_st_ space token minted FOR this space (the key you hand a friend/AI), or
 *   · the owner's session.
 *  Without this, any signed-in user could overwrite anyone's world (and inject
 *  JS hooks that run in every visitor's browser). */
async function mayWriteSpace(req: NextRequest, spaceId: string): Promise<boolean> {
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    if (token.startsWith('uc_st_')) {
      const v = await validateSpaceToken(token)
      return !!v && v.spaceId === spaceId   // a key opens only its own world
    }
    if (isAdminToken(authHeader, { allowLegacyAnthropicKey: true })) return true
  }
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return false
  const space = await prisma.playerSpace.findUnique({ where: { id: spaceId }, select: { ownerId: true } })
  return !!space && space.ownerId === session.user.id
}

export const dynamic = 'force-dynamic'

/** Per-space writer leases — same semantics as the global lease in store.ts:
 *  one tab syncs a space, any other tab gets 409 until the lease expires or is taken over. */
const SPACE_LEASE_MS = 8000
function claimSpaceWriter(spaceId: string, clientId: string, takeover: boolean): boolean {
  const g = globalThis as unknown as { __spaceWriters?: Map<string, { id: string; seen: number }> }
  if (!g.__spaceWriters) g.__spaceWriters = new Map()
  const now = Date.now()
  const cur = g.__spaceWriters.get(spaceId)
  if (!cur || cur.id === clientId || now - cur.seen > SPACE_LEASE_MS || takeover) {
    g.__spaceWriters.set(spaceId, { id: clientId, seen: now })
    return true
  }
  return false
}

/** Check session or bearer token auth */
async function checkAuth(req: NextRequest): Promise<boolean> {
  // Bearer token
  if (isAdminToken(req.headers.get('authorization'), { allowLegacyAnthropicKey: true })) return true

  // Session auth
  const session = await getServerSession(authOptions)
  return !!session?.user?.id
}

/**
 * POST /api/engine/state
 * Client pushes field snapshots every 2s
 * Body: { fields: FieldSnapshot[], spaceId?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const fields: FieldSnapshot[] = body.fields
    if (!Array.isArray(fields)) {
      return NextResponse.json({ error: 'Expected { fields: FieldSnapshot[] }' }, { status: 400 })
    }

    // Authority is gated PER BRANCH: the global world needs a session/admin;
    // a space needs owner/keyholder/admin (mayWriteSpace, below). A space token
    // must never be able to write the global world, so we don't broaden the
    // global gate to accept uc_st_.
    if (!body.spaceId && !(await checkAuth(req))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Writer lease on the global world — one session syncs, others get 409
    // instead of silently clobbering each other every 2s. Space-scoped syncs
    // are per-space rows and don't contend. clientId is REQUIRED: a stale tab
    // running an old bundle must not keep writing around the lease.
    if (!body.spaceId) {
      if (typeof body.clientId !== 'string') {
        return NextResponse.json({ error: 'clientId required — reload this tab to pick up the current bundle' }, { status: 400 })
      }
      if (!claimWriter(body.clientId, body.takeover === true)) {
        return NextResponse.json({ error: 'world-locked' }, { status: 409 })
      }
    }

    // Space-scoped: persist to database. AUTHORITY FIRST — only the owner, a
    // keyholder, or admin may write this world's snapshot; the lease is merely
    // concurrency between the owner's own tabs, never an authorization check.
    if (body.spaceId) {
      if (!(await mayWriteSpace(req, body.spaceId))) {
        return NextResponse.json({ error: 'Not authorized to write this world' }, { status: 403 })
      }
      if (typeof body.clientId === 'string' &&
          !claimSpaceWriter(body.spaceId, body.clientId, body.takeover === true)) {
        return NextResponse.json({ error: 'world-locked' }, { status: 409 })
      }
      // Bridge-write guard: if an AI bridge command just changed this world, hold
      // off the tab's 2s auto-sync for a few seconds so that change can propagate
      // to open tabs via SSE (they recompile) BEFORE a stale tab syncs its old
      // state back over it. Without this, a bridge deploy and a stale tab flip-flop
      // the world every 2s and the deploy never sticks.
      {
        const gb = globalThis as unknown as { __spaceBridgeWrite?: Map<string, number> }
        const lastBridge = gb.__spaceBridgeWrite?.get(body.spaceId) ?? 0
        if (Date.now() - lastBridge < 4000) {
          return NextResponse.json({ ok: true, deferred: 'bridge-write in flight', spaceId: body.spaceId })
        }
      }
      // STALE-WRITE GUARD (rev-based — the authoritative one). Every bridge write
      // bumps worldData.__bridge_rev. If this tab's snapshot is based on an OLDER
      // rev than the server already holds, it never ingested that write — so its
      // sync is stale and MUST NOT overwrite the newer state. Refuse it; the tab's
      // watcher hot-reloads to the new rev, then syncs cleanly. Unlike the 4s time
      // window above, this holds no matter how long the tab has been stale or
      // whether its build-flag is stuck — the newer write always wins.
      {
        const current = await getSpaceSnapshot(body.spaceId, true)
        const serverRev = Number((current?.worldData as Record<string, unknown> | undefined)?.__bridge_rev) || 0
        const clientRev = Number((body.worldData as Record<string, unknown> | undefined)?.__bridge_rev) || 0
        if (clientRev < serverRev) {
          return NextResponse.json({ ok: true, deferred: 'stale-rev', serverRev, clientRev, spaceId: body.spaceId })
        }
      }
      const snapshot: SceneSnapshot = {
        name: body.spaceId,
        fields,
        worldParams: body.worldParams || {},
        worldData: body.worldData || {},
        stepHooks: body.stepHooks || [],
        interactionRules: body.interactionRules || [],
        interactionEffects: body.interactionEffects || [],
        visualTypes: body.visualTypes || [],
        modules: body.modules || [],
        timestamp: Date.now(),
      }
      await setSpaceSnapshot(body.spaceId, snapshot)
      return NextResponse.json({ ok: true, fieldCount: fields.length, spaceId: body.spaceId })
    }

    // Global: persist to in-memory store
    setFieldSnapshots(fields, body.worldParams, body.stepHooks, body.worldData, body.renderedSamples, body.interactionEffects, body.visualTypes, body.modules)
    return NextResponse.json({ ok: true, fieldCount: fields.length })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}

/**
 * GET /api/engine/state
 * Returns engine state. Optional ?fieldId=xxx for single field.
 */
export async function GET(req: NextRequest) {
  if (!(await checkAuth(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const fieldId = req.nextUrl.searchParams.get('fieldId')
  if (fieldId) {
    const snap = getFieldSnapshot(fieldId)
    if (!snap) {
      return NextResponse.json({ error: 'Field not found' }, { status: 404 })
    }
    return NextResponse.json(snap)
  }

  return NextResponse.json(getEngineState())
}
