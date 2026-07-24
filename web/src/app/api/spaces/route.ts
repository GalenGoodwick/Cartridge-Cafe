import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { slugify } from '@/lib/companion'
import { canCreateWorld, createSpaceUniqueSlug, sweepAbandonedDrafts } from '@/lib/world-create'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

/** GET /api/spaces — List authenticated user's spaces */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // NOTE: LISTING is never gated by the build quota — a guest who hit their
  // 3-build limit must still be able to SEE the worlds they made. The quota
  // lives on the create paths only (canCreateWorld).

  const spaces = await prisma.playerSpace.findMany({
    where: { ownerId: user.id },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      isPublic: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { tokens: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ spaces })
}

/** POST /api/spaces — Create a new space */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // one gate for every create path: world cap + (for guests) the 3-build limit
  const gate = await canCreateWorld(user.id, { isGuest: session.user.isTemp, email: session.user.email })
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const body = await req.json()
  const { name, slug: rawSlug, description, brief } = body
  // draft: true — a brew in progress. The row must exist so the AI key can
  // hang on something, but the world stays INVISIBLE (private) until the
  // wizard's three gates pass and ENTER WORLD flips it public.
  const draft = body.draft === true

  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  // opportunistic cleanup: retire the caller's OWN abandoned drafts so they
  // don't hoard slugs + the world cap forever (best-effort, never blocks)
  await sweepAbandonedDrafts(user.id).catch(() => {})

  // Generate slug from name if not provided
  const baseSlug = slugify(rawSlug?.trim() || name.trim())
  if (!baseSlug) {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
  }

  // the creation brief rides in the world itself: the FIRST thing a connecting
  // AI reads is what the player asked for — it builds that, not its own idea
  const snapshot = brief?.trim()
    ? { fields: [], worldData: { creation_brief: { prompt: brief.trim(), by: user.id, at: Date.now() } } }
    : undefined

  // race-safe: the DB unique constraint arbitrates the slug, not a prior read
  const space = await createSpaceUniqueSlug(baseSlug, (slug) => ({
    name: name.trim(),
    slug,
    description: description?.trim() || null,
    ownerId: user.id,
    isPublic: !draft,
    ...(snapshot ? { snapshot } : {}),
  }))

  // connect-AI-first: the world is born with its first companion key
  const rawToken = `uc_st_${crypto.randomBytes(16).toString('hex')}`
  await prisma.spaceToken.create({
    data: {
      name: 'first companion',
      tokenHash: crypto.createHash('sha256').update(rawToken).digest('hex'),
      tokenPrefix: rawToken.slice(0, 12) + '...',
      spaceId: space.id,
    },
  })

  // shape the response (the create returns the full row now — don't leak
  // snapshot / ownerId to the client)
  const shaped = { id: space.id, slug: space.slug, name: space.name, description: space.description, isPublic: space.isPublic, createdAt: space.createdAt }
  return NextResponse.json({ space: shaped, token: rawToken }, { status: 201 })
}
