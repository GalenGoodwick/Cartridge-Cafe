import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { setFieldSnapshots, getFieldSnapshot, getEngineState, claimWriter } from '../store'
import { setSpaceSnapshot } from '../space-store'
import type { FieldSnapshot, SceneSnapshot } from '@/app/engine/types'

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
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const envToken = process.env.ENGINE_AGENT_TOKEN || process.env.ANTHROPIC_API_KEY
    if (envToken && token === envToken) return true
  }

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
  if (!(await checkAuth(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const fields: FieldSnapshot[] = body.fields
    if (!Array.isArray(fields)) {
      return NextResponse.json({ error: 'Expected { fields: FieldSnapshot[] }' }, { status: 400 })
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

    // Space-scoped: persist to database (behind a per-space writer lease —
    // two of the owner's tabs must not clobber each other every 2s)
    if (body.spaceId) {
      if (typeof body.clientId === 'string' &&
          !claimSpaceWriter(body.spaceId, body.clientId, body.takeover === true)) {
        return NextResponse.json({ error: 'world-locked' }, { status: 409 })
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
