import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
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
  const bearerTok = req.headers.get('authorization')?.slice(7)
  const isHouse = !!process.env.ENGINE_AGENT_TOKEN && bearerTok === process.env.ENGINE_AGENT_TOKEN
  const owned = isHouse
    ? await (async () => {
        const sp = await prisma.playerSpace.findUnique({ where: { slug }, select: { id: true, ownerId: true } })
        return sp ? { userId: sp.ownerId, spaceId: sp.id } : null
      })()
    : await getOwnedSpace(slug)
  if (!owned) {
    return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  }

  const body = await req.json()
  const { name } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  // Limit to 10 tokens per space
  const count = await prisma.spaceToken.count({
    where: { spaceId: owned.spaceId, revokedAt: null },
  })
  if (count >= 10) {
    return NextResponse.json({ error: 'Maximum 10 tokens per space' }, { status: 400 })
  }

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
