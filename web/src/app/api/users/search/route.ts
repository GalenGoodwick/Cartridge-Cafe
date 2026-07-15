import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/** GET /api/users/search?q=name — resolve display-name matches to { id, name, image }.
 *  Signed-in only. Used by a sub-main's founder/admins to find a player to kick or
 *  ban (the moderation tool). Returns display names, which already show publicly in
 *  worlds; capped and length-gated so it can't be walked as a directory. */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }
  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  if (q.length < 2) return NextResponse.json({ users: [] })

  const users = await prisma.user.findMany({
    where: { name: { contains: q, mode: 'insensitive' } },
    select: { id: true, name: true, image: true },
    take: 8,
    orderBy: { name: 'asc' },
  })

  return NextResponse.json({ users })
}
