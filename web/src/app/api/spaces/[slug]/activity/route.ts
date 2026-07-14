import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/** GET /api/spaces/:slug/activity — Is an AI currently working in this world?
 *  Derived from token lastUsedAt (updated on every bridge call). No secrets exposed. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const space = await prisma.playerSpace.findUnique({
    where: { slug },
    select: { id: true, ownerId: true, isPublic: true, snapshot: true },
  })
  if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 })

  if (!space.isPublic) {
    const session = await getServerSession(authOptions)
    const user = session?.user?.email
      ? await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
      : null
    if (user?.id !== space.ownerId) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 })
    }
  }

  const latest = await prisma.spaceToken.findFirst({
    where: { spaceId: space.id, revokedAt: null, lastUsedAt: { not: null } },
    orderBy: { lastUsedAt: 'desc' },
    select: { name: true, lastUsedAt: true },
  })

  const lastSeen = latest?.lastUsedAt ?? null
  const secondsAgo = lastSeen ? (Date.now() - lastSeen.getTime()) / 1000 : null

  const wd = (space.snapshot as { worldData?: Record<string, unknown> } | null)?.worldData || {}
  return NextResponse.json({
    aiActive: secondsAgo !== null && secondsAgo < 45,
    lastSeen,
    agentName: latest?.name ?? null,
    aiFocus: wd['ai_focus'] ?? null,
  })
}
