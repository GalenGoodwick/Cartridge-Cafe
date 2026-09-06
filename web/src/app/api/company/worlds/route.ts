import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getCompanyByHandle } from '@/lib/company'

export const dynamic = 'force-dynamic'

/** GET /api/company/worlds?handle=X — the company's PRIVATE LINE, for the
 *  engine window (Galen, Sep 5: the company door opens a private engine view).
 *  Gate: the owner, a member-seat holder on any company world, or the keeper.
 *  Only isPublic:false worlds — shipped work lives on the main shelf. */
export async function GET(req: NextRequest) {
  const handle = (req.nextUrl.searchParams.get('handle') || '').toLowerCase()
  const company = await getCompanyByHandle(handle)
  if (!company) return NextResponse.json({ error: 'no such company' }, { status: 404 })

  const session = await getServerSession(authOptions)
  const me = session?.user?.email
    ? await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, email: true } })
    : null
  if (!me) return NextResponse.json({ error: 'sign in' }, { status: 401 })

  let inside = me.id === company.ownerId
  if (!inside) {
    const { isAdminUserId } = await import('@/lib/adminAuth')
    inside = await isAdminUserId(me.id)
  }
  if (!inside && me.email) {
    const h = me.email.split('@')[0].replace(/[^a-z0-9_-]/gi, '')
    const seat = await prisma.spaceToken.count({
      where: { name: `member:${h}`, revokedAt: null, space: { ownerId: company.ownerId } },
    })
    inside = seat > 0
  }
  if (!inside) return NextResponse.json({ error: 'member seats only' }, { status: 403 })

  const worlds = await prisma.playerSpace.findMany({
    where: { ownerId: company.ownerId, isPublic: false },
    select: { slug: true, name: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  })
  return NextResponse.json({ company: company.name, worlds })
}

/** POST /api/company/worlds {handle, name} — birth a PRIVATE world on the
 *  company's line, from inside the room (Galen: 'how do I create a world
 *  now?' — containment removed the public CREATE door without a room-internal
 *  one). Owner or keeper only; born isPublic:false, credits untouched
 *  (enterprise line — provisioning is the payment). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { handle?: string; name?: string }
  const handle = String(body.handle ?? '').toLowerCase()
  const name = String(body.name ?? '').trim().slice(0, 60)
  if (!handle || name.length < 2) return NextResponse.json({ error: 'handle and name (2+ chars) required' }, { status: 400 })
  const company = await getCompanyByHandle(handle)
  if (!company) return NextResponse.json({ error: 'no such company' }, { status: 404 })

  const session = await getServerSession(authOptions)
  const me = session?.user?.email
    ? await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
    : null
  if (!me) return NextResponse.json({ error: 'sign in' }, { status: 401 })
  let allowed = me.id === company.ownerId
  if (!allowed) {
    const { isAdminUserId } = await import('@/lib/adminAuth')
    allowed = await isAdminUserId(me.id)
  }
  if (!allowed) return NextResponse.json({ error: 'the company line is born by its owner (or the keeper)' }, { status: 403 })

  const { birthWorld } = await import('@/lib/world-create')
  const { slugify } = await import('@/lib/slug')
  const { space, token } = await birthWorld({
    ownerId: company.ownerId, name, baseSlug: slugify(name), isPublic: false,
  })
  return NextResponse.json({ ok: true, slug: space.slug, name: space.name, token }, { status: 201 })
}
