import { NextRequest, NextResponse } from 'next/server'
import { getWorldRev } from '../world-rev'

export const dynamic = 'force-dynamic'

// GET /api/engine/world-rev?key=space:<id>  |  scene:<name>
// Tiny, unauthenticated (returns only a number): a playing tab polls it to know
// when an AI has edited the world it is standing in, so it can adopt the change
// live. No world data crosses this endpoint — just the revision integer.
const tabSeenStamped: Map<string, number> = ((globalThis as unknown as { __ccTabSeen?: Map<string, number> }).__ccTabSeen ??= new Map())

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key')
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })
  // DURABLE TAB HEARTBEAT (scalability audit, Sep 6): this poll IS proof a tab
  // is watching this world — stamp it (throttled 10s per lambda) so the bridge
  // stops telling AIs 'no live tab' when the tab merely lives on another
  // lambda than the SSE listener (the split-brain lie).
  if (key.startsWith('space:')) {
    const now = Date.now()
    if (now - (tabSeenStamped.get(key) ?? 0) > 10_000) {
      tabSeenStamped.set(key, now)
      const { saveGameSlot } = await import('@/app/api/engine/store')
      void saveGameSlot('tabseen:' + key.slice(6), now).catch(() => {})
    }
  }
  return NextResponse.json({ key, rev: await getWorldRev(key) })
}
