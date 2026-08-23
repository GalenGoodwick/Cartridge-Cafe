import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isAdminToken } from '@/lib/adminAuth'
import { loadGameSlot, saveGameSlot } from '../../../engine/store'

export const dynamic = 'force-dynamic'

/** WORLD-SCOPED BAN (griefing defense, task #6). A kick that sticks:
 *  POST {handle} (owner/house) → revokes every live member:<handle> key on
 *  this world AND records a 30-day ban, so a fresh invite link or an open
 *  world's self-mint can't readmit them the same hour. DELETE {handle}
 *  lifts it early. GET lists. Storage: game slot bans:<spaceId>. */

const BAN_DAYS = 30
type BanRec = import('@/lib/world-bans').BanRec

async function ownedSpace(req: NextRequest, slug: string): Promise<{ id: string } | null> {
  const sp = await prisma.playerSpace.findUnique({ where: { slug }, select: { id: true, ownerId: true } })
  if (!sp) return null
  if (isAdminToken(req.headers.get('authorization'))) return { id: sp.id }
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const me = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  return me && me.id === sp.ownerId ? { id: sp.id } : null
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const sp = await ownedSpace(req, slug)
  if (!sp) return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  const handle = typeof body.handle === 'string' ? body.handle.replace(/[^a-z0-9_-]/gi, '') : ''
  if (!handle) return NextResponse.json({ error: 'ban needs a {handle} (the member name after "member:")' }, { status: 400 })
  // the kick: every live key they hold on this world dies now
  const revoked = await prisma.spaceToken.updateMany({
    where: { spaceId: sp.id, revokedAt: null, name: `member:${handle}` },
    data: { revokedAt: new Date() },
  })
  // the stick: they can't be re-admitted (invite, open-world self-mint) until it lapses
  const slot = `bans:${sp.id}`
  const now = Date.now()
  const list = (((await loadGameSlot(slot)) as BanRec[] | undefined) ?? []).filter(b => b.until > now && b.handle !== handle)
  list.push({ handle, at: now, until: now + BAN_DAYS * 24 * 3600_000 })
  await saveGameSlot(slot, list.slice(-100))
  return NextResponse.json({ ok: true, handle, keysRevoked: revoked.count, bannedForDays: BAN_DAYS })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const sp = await ownedSpace(req, slug)
  if (!sp) return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  const handle = typeof body.handle === 'string' ? body.handle.replace(/[^a-z0-9_-]/gi, '') : ''
  if (!handle) return NextResponse.json({ error: 'unban needs a {handle}' }, { status: 400 })
  const slot = `bans:${sp.id}`
  const list = (((await loadGameSlot(slot)) as BanRec[] | undefined) ?? []).filter(b => b.handle !== handle)
  await saveGameSlot(slot, list)
  return NextResponse.json({ ok: true, handle, lifted: true })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const sp = await ownedSpace(req, slug)
  if (!sp) return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  const now = Date.now()
  const list = (((await loadGameSlot(`bans:${sp.id}`)) as BanRec[] | undefined) ?? []).filter(b => b.until > now)
  return NextResponse.json({ bans: list })
}
