import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ensurePushTable } from '@/lib/push'

export const dynamic = 'force-dynamic'

/** POST — drop a subscription by endpoint (the browser unsubscribed). No auth
 *  needed: the endpoint is the secret, and removing a dead one is harmless. */
export async function POST(req: NextRequest) {
  try {
    const { endpoint } = await req.json()
    if (!endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 })
    await ensurePushTable()
    await prisma.pushSubscription.deleteMany({ where: { endpoint } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ success: true })   // best-effort — a failed cleanup is not fatal
  }
}
