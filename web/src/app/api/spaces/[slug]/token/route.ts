import { isAdminToken } from '@/lib/adminAuth'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { policyOf } from '@/lib/world-policy'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

/** Resolve space and verify ownership */
async function getOwnedSpace(slug: string) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!user) return null

  const space = await prisma.playerSpace.findUnique({
    where: { slug },
    select: { id: true, ownerId: true },
  })
  if (!space || space.ownerId !== user.id) return null

  return { userId: user.id, spaceId: space.id }
}

/** GET /api/spaces/:slug/token — List tokens for this space (owner only) */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const owned = await getOwnedSpace(slug)
  if (!owned) {
    return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  }

  const tokens = await prisma.spaceToken.findMany({
    where: { spaceId: owned.spaceId, revokedAt: null },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ tokens })
}

/** POST /api/spaces/:slug/token — Generate a new space token (owner only) */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  // the HOUSE AI: the admin engine token may mint a build key for any world —
  // this is how the resident builder answers creation briefs without the owner
  // pasting anything anywhere ("an AI lives here")
  const isHouse = isAdminToken(req.headers.get('authorization'))
  let owned = isHouse
    ? await (async () => {
        const sp = await prisma.playerSpace.findUnique({ where: { slug }, select: { id: true, ownerId: true } })
        return sp ? { userId: sp.ownerId, spaceId: sp.id } : null
      })()
    : await getOwnedSpace(slug)
  // OPEN GROUND (world-policy): a world whose contract says build:'anyone' lets
  // ANY signed-in player mint their own member key — the world is a public
  // construction site. The key is named member:<handle> (attribution + kick
  // target). 'invited' worlds mint through the link door (#5), never here.
  let memberHandle: string | null = null
  if (!owned) {
    const session = await getServerSession(authOptions)
    const email = session?.user?.email
    if (email) {
      const joiner = await prisma.user.findUnique({ where: { email }, select: { id: true } })
      const sp = await prisma.playerSpace.findUnique({ where: { slug }, select: { id: true, ownerId: true } })
      if (sp && joiner) {
        const rows = await prisma.$queryRaw<{ policy: unknown; premium: unknown }[]>`
          SELECT snapshot->'worldData'->'policy' AS policy, snapshot->'worldData'->'premium' AS premium FROM "PlayerSpace" WHERE id = ${sp.id}`
        const policy = policyOf({ policy: rows[0]?.policy })
        // THE SANDBOX LAW: membership build access resolves open on every world
        // except premium games and a proprietary owner's worlds
        const { hasIpShield } = await import('@/lib/stripe')
        const { effectiveBuild } = await import('@/lib/world-policy')
        const buildAccess = effectiveBuild({ policy: rows[0]?.policy, premium: rows[0]?.premium }, await hasIpShield(sp.ownerId))
        const handle = email.split('@')[0].replace(/[^a-z0-9_-]/gi, '') || 'member'
        // the handle BINDS to the first account that claims it on this world
        // (audit: email local-part collision = seat takeover + fee skip)
        const { claimMemberHandle } = await import('@/lib/member-identity')
        if (!(await claimMemberHandle(sp.id, handle, joiner.id))) {
          return NextResponse.json({ error: `the handle "${handle}" belongs to another member on this world` }, { status: 403 })
        }
        const { isBanned } = await import('@/lib/world-bans')
        if (await isBanned(sp.id, handle)) {
          return NextResponse.json({ error: 'you are banned from this world' }, { status: 403 })
        }
        // MEMBERSHIP gate (Galen, Aug 26 — dockstars removed): joining an open
        // world's EDIT flow takes the $10/mo editing membership — but only if
        // you're not ALREADY a builder here (re-entry is free) and don't own it.
        // Play/test never reaches this path. Admins are members automatically.
        const alreadyBuilder = await prisma.spaceToken.findFirst({
          where: { spaceId: sp.id, revokedAt: null, name: `member:${handle}` }, select: { id: true },
        })
        if (!alreadyBuilder && sp.ownerId !== joiner.id) {
          const { hasEditingMembership } = await import('@/lib/stripe')
          if (!(await hasEditingMembership(joiner.id))) {
            return NextResponse.json({ error: 'an editing membership ($10/mo) is the seat to join open build flows — play stays free' }, { status: 402 })
          }
        }
        if (buildAccess === 'anyone') {
          memberHandle = handle
          owned = { userId: sp.ownerId, spaceId: sp.id }
        } else {
          // an existing MEMBER re-mints their build key on ANY contract —
          // the invite itself is the authority ("sharing a link is sharing
          // ownership"): the owner minted that link, the roster row proves
          // it, so a default-contract world can't strand its own crew.
          const member = await prisma.spaceToken.findFirst({
            where: { spaceId: sp.id, revokedAt: null, name: `member:${handle}` }, select: { id: true } })
          if (member) { memberHandle = handle; owned = { userId: sp.ownerId, spaceId: sp.id } }
        }
      }
    }
  }
  if (!owned) {
    return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  }

  const body = await req.json()
  // a self-minted member key is ALWAYS named member:<handle> — the caller
  // doesn't choose (the name is the roster + the kick target)
  const name = memberHandle ? `member:${memberHandle}` : (typeof body.name === 'string' ? body.name.slice(0, 80) : body.name)

  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  // ATTRIBUTION IS ROUTE TRUTH (audit, Sep 5): an owner-chosen name may not
  // wear the member: prefix — a forged member:<victim> key would frame an
  // innocent handle in __provenance / the roster / the ban trail.
  if (!memberHandle && /^member:/i.test(String(name).trim())) {
    return NextResponse.json({ error: 'the member: prefix is minted only by the join path — name the key something else' }, { status: 400 })
  }

  // NO CAP (Galen, Aug 28: "remove the key cap") — instead ONE LIVE KEY PER
  // SEAT: re-minting a name (member:<handle>, 'AI agent', …) retires that
  // seat's older keys, so the roster is one key per user per world, never a
  // pile of dead duplicates.
  await prisma.spaceToken.updateMany({
    where: { spaceId: owned.spaceId, revokedAt: null, name: memberHandle ? `member:${memberHandle}` : name.trim() },
    data: { revokedAt: new Date() },
  })

  // Generate token: uc_st_ + 32 random hex chars
  const rawToken = `uc_st_${crypto.randomBytes(16).toString('hex')}`
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
  const tokenPrefix = rawToken.slice(0, 12) + '...'

  await prisma.spaceToken.create({
    data: {
      name: name.trim(),
      tokenHash,
      tokenPrefix,
      spaceId: owned.spaceId,
    },
  })

  // Return the raw token — shown ONCE, never stored
  return NextResponse.json({ token: rawToken, prefix: tokenPrefix }, { status: 201 })
}

/** DELETE /api/spaces/:slug/token — Revoke a token (owner only) */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const owned = await getOwnedSpace(slug)
  if (!owned) {
    return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  }

  const body = await req.json()
  const { tokenId } = body

  if (!tokenId) {
    return NextResponse.json({ error: 'tokenId is required' }, { status: 400 })
  }

  const token = await prisma.spaceToken.findUnique({
    where: { id: tokenId },
    select: { id: true, spaceId: true },
  })

  if (!token || token.spaceId !== owned.spaceId) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 })
  }

  await prisma.spaceToken.update({
    where: { id: tokenId },
    data: { revokedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
