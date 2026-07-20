import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** GET — the browser needs the VAPID public key to subscribe. */
export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  if (!publicKey) return NextResponse.json({ error: 'push not configured' }, { status: 503 })
  return NextResponse.json({ publicKey })
}
