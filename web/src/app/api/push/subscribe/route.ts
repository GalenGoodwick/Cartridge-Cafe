import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ensurePushTable } from '@/lib/push'

export const dynamic = 'force-dynamic'

/** POST — store this browser's push subscription for the signed-in user. */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const sub = await req.json()
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
    }

    await ensurePushTable()
    await prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      update: { userId: user.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth, lastUsedAt: new Date() },
      create: { userId: user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to save subscription', details: err instanceof Error ? err.message : 'unknown' }, { status: 500 })
  }
}
