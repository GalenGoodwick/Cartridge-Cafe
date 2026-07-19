import { NextRequest, NextResponse } from 'next/server'
import { getWorldRev } from '../world-rev'

export const dynamic = 'force-dynamic'

// GET /api/engine/world-rev?key=space:<id>  |  scene:<name>
// Tiny, unauthenticated (returns only a number): a playing tab polls it to know
// when an AI has edited the world it is standing in, so it can adopt the change
// live. No world data crosses this endpoint — just the revision integer.
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key')
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })
  return NextResponse.json({ key, rev: getWorldRev(key) })
}
