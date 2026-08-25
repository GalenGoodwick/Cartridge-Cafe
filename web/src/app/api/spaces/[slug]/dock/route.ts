import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasEditingMembership, canDock, dockstarsUsed, worldQuota, EDITOR_PRICE_USD, EDITOR_PRO_PRICE_USD } from '@/lib/stripe'
import { dockFlowPrompt } from '@/lib/connectPrompt'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** DOCK INTO A LIVE-EDITABLE WORLD (Galen, Aug 24). A player inside a game with
 *  proper node foundations clicks DOCK:
 *    · not signed in            → 401 (the button sends them to sign in)
 *    · no editing membership    → 402 needMembership (the button offers it)
 *    · out of dockstars         → 402 needDockstar (the button offers upgrade)
 *    · otherwise                → SPEND a dockstar, BIND the player to the world
 *      (mint their member: key = co-program access), and hand back the FLOW-IN
 *      prompt (which requests Fable for quality).
 *  Playing/testing never calls this — only joining the edit flow does. */

async function loadDockable(slug: string) {
  const space = await prisma.playerSpace.findUnique({
    where: { slug }, select: { id: true, name: true, ownerId: true, snapshot: true },
  })
  if (!space) return null
  const sn = space.snapshot as { worldData?: { __nodes?: Record<string, unknown> }; fields?: unknown[] } | null
  const nodes = sn?.worldData?.__nodes
  const hasNodes = !!nodes && typeof nodes === 'object' && Object.keys(nodes).length > 0
  // a BLANK world (no fields) is not a live-editable game (Galen, via the chair):
  // dockable = proper node foundations AND real content
  const hasContent = (sn?.fields?.length ?? 0) > 0
  return { space, dockable: hasNodes && hasContent }
}

const handleOf = (email: string) => email.split('@')[0].replace(/[^a-z0-9_-]/gi, '') || 'member'

/** GET — the DockButton's state: can I dock here, am I already docked, my stars. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const info = await loadDockable(slug.trim().toLowerCase())
  if (!info) return NextResponse.json({ error: 'no such world' }, { status: 404 })

  const session = await getServerSession(authOptions)
  const user = session?.user?.email
    ? await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, email: true } })
    : null

  const isOwner = !!user && user.id === info.space.ownerId
  let docked = false
  if (user && !isOwner) {
    const h = handleOf(user.email!)
    docked = !!(await prisma.spaceToken.findFirst({ where: { spaceId: info.space.id, revokedAt: null, name: `member:${h}` }, select: { id: true } }))
  }
  const [member, stars] = user ? await Promise.all([hasEditingMembership(user.id), dockstarsUsed(user.id)]) : [false, 0]
  const allowance = user ? await worldQuota(user.id) : 3
  return NextResponse.json({
    dockable: info.dockable && !isOwner,   // owners already edit freely
    docked, isOwner, member, signedIn: !!user,
    dockstars: { used: stars, allowance },
    prices: { basicUsd: EDITOR_PRICE_USD, proUsd: EDITOR_PRO_PRICE_USD },
  })
}

/** POST — perform the dock (or return the flow-in prompt if already docked). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = await params
  const slug = rawSlug.trim().toLowerCase()
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Sign in first', needSignIn: true }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, email: true } })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const info = await loadDockable(slug)
  if (!info) return NextResponse.json({ error: 'no such world' }, { status: 404 })
  if (!info.dockable) return NextResponse.json({ error: 'this world has no node foundations to co-build yet' }, { status: 400 })
  if (user.id === info.space.ownerId) return NextResponse.json({ error: 'you own this world — you already build it', isOwner: true }, { status: 400 })

  const h = handleOf(user.email!)
  const bindName = `member:${h}`

  // ALREADY DOCKED → re-issue a fresh seat key + the flow-in prompt (idempotent;
  // a member re-minting retires their older key — never a second dockstar spent)
  const existing = await prisma.spaceToken.findFirst({ where: { spaceId: info.space.id, revokedAt: null, name: bindName }, select: { id: true } })
  if (!existing) {
    // JOINING → membership + a free dockstar are required
    if (!(await hasEditingMembership(user.id))) {
      return NextResponse.json({ error: 'an editing membership binds you to a world', needMembership: true, prices: { basicUsd: EDITOR_PRICE_USD, proUsd: EDITOR_PRO_PRICE_USD } }, { status: 402 })
    }
    if (!(await canDock(user.id))) {
      const [used, allowance] = await Promise.all([dockstarsUsed(user.id), worldQuota(user.id)])
      return NextResponse.json({ error: 'no dockstars left — undock a world or upgrade to bind more', needDockstar: true, dockstars: { used, allowance } }, { status: 402 })
    }
  } else {
    // retire the old seat so the fresh one is the only live key (no extra spend)
    await prisma.spaceToken.updateMany({ where: { spaceId: info.space.id, revokedAt: null, name: bindName }, data: { revokedAt: new Date() } })
  }

  // BIND: mint the member seat key (this occupancy IS the spent dockstar)
  const raw = `uc_st_${crypto.randomBytes(16).toString('hex')}`
  await prisma.spaceToken.create({
    data: { name: bindName, tokenHash: crypto.createHash('sha256').update(raw).digest('hex'), tokenPrefix: raw.slice(0, 12) + '...', spaceId: info.space.id },
  })

  const origin = req.nextUrl.origin
  return NextResponse.json({
    ok: true,
    bound: true,
    token: raw,
    flowPrompt: dockFlowPrompt(raw, slug, info.space.name || slug, origin),
  })
}
