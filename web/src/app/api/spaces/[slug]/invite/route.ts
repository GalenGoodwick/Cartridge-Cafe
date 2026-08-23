import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isAdminToken } from '@/lib/adminAuth'
import { loadGameSlot, saveGameSlot } from '../../../engine/store'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

/** ONE-TIME INVITE LINKS (task #5 — "sharing a link is sharing ownership").
 *  POST (owner/house): mint a single-use join link for this world. The secret
 *  is a bearer credential consumed on first use — safer than a standing key:
 *  a leaked used link is worthless, and every crew member traces to one mint.
 *  GET (owner/house): the ledger — outstanding + used invites.
 *  Storage: game slot invites:<spaceId> = [{h, at, used?}] (secret stored as
 *  a sha256 hash only, like every key on the platform). */

export type InviteRec = { h: string; at: number; used?: { by: string; at: number } }

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
  const secret = crypto.randomBytes(18).toString('base64url')
  const rec: InviteRec = { h: crypto.createHash('sha256').update(secret).digest('hex'), at: Date.now() }
  const slot = `invites:${sp.id}`
  const list = ((await loadGameSlot(slot)) as InviteRec[] | undefined) ?? []
  // prune stale used invites; cap outstanding to keep the slot small
  const keep = list.filter(i => !i.used || Date.now() - i.used.at < 30 * 24 * 3600_000).slice(-49)
  await saveGameSlot(slot, [...keep, rec])
  return NextResponse.json({
    ok: true,
    joinUrl: `${req.nextUrl.origin}/space/${encodeURIComponent(slug)}?join=${secret}`,
    note: 'ONE-TIME link: the first signed-in visitor becomes a member (their key mints, the link dies). Mint one per person.',
  }, { status: 201 })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const sp = await ownedSpace(req, slug)
  if (!sp) return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  const list = ((await loadGameSlot(`invites:${sp.id}`)) as InviteRec[] | undefined) ?? []
  return NextResponse.json({
    outstanding: list.filter(i => !i.used).length,
    used: list.filter(i => i.used).map(i => ({ by: i.used!.by, at: i.used!.at })),
  })
}
