import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { postCommandResult } from '../store'

export const dynamic = 'force-dynamic'

/**
 * POST /api/engine/compile-result
 * Browser (FieldEngine) posts shader compile results here.
 * The bridge route waits for these results via waitForCommandResult().
 * Body: { commandId: string, result: { ok: boolean, error?: string, ... } }
 */
export async function POST(req: NextRequest) {
  // Session auth only (not admin) — same as state route
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { commandId, result } = body
    if (!commandId || result === undefined) {
      return NextResponse.json({ error: 'Expected { commandId, result }' }, { status: 400 })
    }

    postCommandResult(commandId, result)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}
