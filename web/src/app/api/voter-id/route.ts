import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** A spectator's voting identity (Galen: spectators can vote — track by IP).
 *  Stable, anonymous: a salted hash of the caller's IP. The raw IP never
 *  leaves this handler — the tournament doc (publicly readable) only ever
 *  sees the short `v-…` handle, and the hash is one-way. One IP = one voice;
 *  people sharing a NAT share a seat, which is the cost of no sign-in. */
const fnv = (s: string) => {
  let h = 2166136261
  for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0 }
  return h >>> 0
}

export async function GET(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || req.headers.get('x-real-ip') || 'local'
  const salt = process.env.VOTER_ID_SALT || 'cc-voter-v1'
  return NextResponse.json({ id: 'v-' + fnv(salt + ':' + ip).toString(36) })
}
