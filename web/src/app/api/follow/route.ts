import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/** who am I, resolved to a user id (or null if signed out) */
async function meId(): Promise<string | null> {
  const session = await getServerSession(authOptions).catch(() => null)
  const email = session?.user?.email
  if (!email) return null
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  return u?.id ?? null
}

/** GET /api/follow?targetId=<uid> — does the signed-in viewer follow this creator?
 *  Also returns the creator's follower count. */
export async function GET(req: NextRequest) {
  const targetId = new URL(req.url).searchParams.get('targetId')?.trim()
  if (!targetId) return NextResponse.json({ error: 'targetId required' }, { status: 400 })
  try {
    const me = await meId()
    const [following, followers] = await Promise.all([
      me ? prisma.follow.findUnique({ where: { followerId_targetId: { followerId: me, targetId } }, select: { id: true } }) : Promise.resolve(null),
      prisma.follow.count({ where: { targetId } }),
    ])
    return NextResponse.json({ following: !!following, followers, signedIn: !!me })
  } catch {
    // table not migrated yet → degrade quietly instead of 500ing the world page
    return NextResponse.json({ following: false, followers: 0, signedIn: false })
  }
}

/** POST { targetId } — follow.  DELETE { targetId } — unfollow. */
export async function POST(req: NextRequest) {
  const me = await meId()
  if (!me) return NextResponse.json({ error: 'sign in to follow' }, { status: 401 })
  const targetId = (await req.json().catch(() => ({})))?.targetId
  if (!targetId || typeof targetId !== 'string') return NextResponse.json({ error: 'targetId required' }, { status: 400 })
  if (targetId === me) return NextResponse.json({ error: 'you cannot follow yourself' }, { status: 400 })
  try {
    await prisma.follow.upsert({
      where: { followerId_targetId: { followerId: me, targetId } },
      create: { followerId: me, targetId },
      update: {},
    })
    return NextResponse.json({ ok: true, following: true })
  } catch {
    return NextResponse.json({ error: 'could not follow' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const me = await meId()
  if (!me) return NextResponse.json({ error: 'sign in' }, { status: 401 })
  const targetId = (await req.json().catch(() => ({})))?.targetId
  if (!targetId || typeof targetId !== 'string') return NextResponse.json({ error: 'targetId required' }, { status: 400 })
  try {
    await prisma.follow.deleteMany({ where: { followerId: me, targetId } })
    return NextResponse.json({ ok: true, following: false })
  } catch {
    return NextResponse.json({ error: 'could not unfollow' }, { status: 500 })
  }
}
