import { NextResponse } from 'next/server'
import { loadGameSlot } from '@/app/api/engine/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// A builder heartbeats 'builder-seen' each time it polls /api/builds/next
// (~every 20s). If one polled within this window, the swarm is live.
const FRESH_MS = 90_000

/** GET /api/builds/availability — is a swarm builder (house AI or a volunteer)
 *  actively looking for work right now? Public; powers the create flow's
 *  "have the house AI build it" button. */
export async function GET() {
  const seen = (await loadGameSlot('builder-seen')) as { at?: number } | undefined
  const at = seen?.at ?? 0
  return NextResponse.json({ available: Date.now() - at < FRESH_MS, lastSeen: at || null })
}
