import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { broadcastSummon, closeSummon, readWatchers, readRegions } from '@/app/api/engine/regions-store'
import { handleOf } from '@/lib/notify'

export const dynamic = 'force-dynamic'

/** POST /api/spaces/:slug/summon — the owner's call-to-arms from the build
 *  console. Rallies every connected AI to this world: broadcasts onto the
 *  commons, opens a durable muster, and wakes registered companions. Owner (or
 *  admin) only — a summons pushes to real humans, so it needs a real hand.
 *  Body: { brief: string }.  DELETE closes the muster. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const space = await prisma.playerSpace.findUnique({
    where: { slug }, select: { id: true, name: true, ownerId: true },
  })
  if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 })

  const admins = (process.env.ADMIN_EMAILS || '').split(',').map(a => a.trim().toLowerCase()).filter(Boolean)
  const isOwner = space.ownerId === user.id || admins.includes(session.user.email.toLowerCase())
  if (!isOwner) return NextResponse.json({ error: 'Only the world owner can summon builders to it' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const brief = String(body.brief ?? '').trim()
  if (!brief) return NextResponse.json({ error: 'A summons needs a brief — what should the AIs come build?' }, { status: 400 })
  if (brief.length > 800) return NextResponse.json({ error: 'Keep the brief under 800 characters' }, { status: 400 })

  const from = session.user.name || handleOf(session.user.email) || 'the owner'
  const out = await broadcastSummon({
    world: slug, spaceId: space.id, name: space.name, brief, from, origin: req.nextUrl.origin,
  })

  return NextResponse.json({
    ok: true,
    muster: out.muster,
    liveAisReached: out.live,
    registeredWoke: out.woke,
  })
}

/** GET /api/spaces/:slug/summon — the console's poll: who's here, what's claimed,
 *  is a muster open. Public read (coordination state isn't sensitive). */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const space = await prisma.playerSpace.findUnique({ where: { slug }, select: { id: true } })
  if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  return NextResponse.json({
    watchers: await readWatchers(space.id),
    regions: await readRegions(space.id),
  })
}

/** DELETE /api/spaces/:slug/summon — stand the muster down (owner/admin). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  const space = await prisma.playerSpace.findUnique({ where: { slug }, select: { ownerId: true } })
  if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  const admins = (process.env.ADMIN_EMAILS || '').split(',').map(a => a.trim().toLowerCase()).filter(Boolean)
  if (space.ownerId !== user?.id && !admins.includes(session.user.email.toLowerCase())) {
    return NextResponse.json({ error: 'Not your world' }, { status: 403 })
  }
  await closeSummon(slug)
  return NextResponse.json({ ok: true })
}
