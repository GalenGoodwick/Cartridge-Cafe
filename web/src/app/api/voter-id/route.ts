import { NextRequest, NextResponse } from 'next/server'
import { ipOf, voterIdFromIp } from '@/lib/voter-id'

export const dynamic = 'force-dynamic'

/** A spectator's voting identity (Galen: spectators can vote — track by IP).
 *  The hash itself now lives in lib/voter-id so the ♥ upvote route shares the
 *  exact same handle — one IP, one voice, everywhere. Output is byte-identical
 *  to what this route has always served. */
export async function GET(req: NextRequest) {
  return NextResponse.json({ id: voterIdFromIp(ipOf(req.headers)) })
}
