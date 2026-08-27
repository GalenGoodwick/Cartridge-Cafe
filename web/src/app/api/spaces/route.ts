import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { slugify } from '@/lib/slug'
import { canCreateWorld, birthWorld, sweepAbandonedDrafts, findOwnWorldByName } from '@/lib/world-create'

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

  // NOTE: LISTING is never gated by the world cap — an account that hit it
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

  // one gate for every create path: the world cap
  const gate = await canCreateWorld(user.id)
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

  // GUARD: don't silently mint a same-name twin for the same owner (the
  // VEILFIRE-3D duplicates — five identically-named rows in /admin). Abandoned
  // same-name drafts were just swept above, so anything left is a real world:
  // point the user at it instead of quietly creating a confusing copy.
  const twin = await findOwnWorldByName(user.id, name.trim())
  if (twin) {
    return NextResponse.json({ error: `You already have a world named "${twin.name}" — open /space/${twin.slug}, or choose a different name.`, existingSlug: twin.slug }, { status: 409 })
  }

  // Generate slug from name if not provided
  const baseSlug = slugify(rawSlug?.trim() || name.trim())
  if (!baseSlug) {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
  }

  // THE ONE BIRTH PIPELINE (Galen's law: pipelines universal, no hand-rolls).
  // The creation brief rides in the world itself: the FIRST thing a connecting
  // AI reads is what the player asked for — it builds that, not its own idea.
  // THE GENERATE FLOW (Galen, Aug 27): creation answers three questions, each a
  // facet set AT BIRTH through this ONE pipeline — BASE (blank | fork a shelf
  // world), DIMENSIONS (targets → worldData.fit), PEOPLE (access model).
  const targets = body.targets === 'desktop' || body.targets === 'mobile' ? body.targets : undefined  // universal = undeclared
  const access = body.access === 'invite' || body.access === 'open' ? body.access : undefined         // solo = undeclared
  const birthData: Record<string, unknown> = {
    ...(brief?.trim() ? { creation_brief: { prompt: brief.trim(), by: user.id, at: Date.now() } } : {}),
    ...(targets ? { fit: targets } : {}),
    ...(access ? { access } : {}),
    ...(access === 'open' ? { build: 'anyone' } : {}),   // open world = live editing for members
  }

  // BASE: fork a forkable shelf world (or your own) as the starting snapshot —
  // fork-from-here at CREATION, lineage recorded (forkOfId), one pipeline.
  let baseSnapshot: import('@prisma/client').Prisma.InputJsonValue | undefined
  let forkOfId: string | undefined
  const baseWorld = typeof body.base === 'string' && body.base.trim() ? body.base.trim() : null
  if (baseWorld) {
    const src = await prisma.playerSpace.findUnique({
      where: { slug: baseWorld }, select: { id: true, ownerId: true, isPublic: true, snapshot: true },
    })
    if (!src) return NextResponse.json({ error: `base world "${baseWorld}" not found` }, { status: 404 })
    const wd = ((src.snapshot as { worldData?: Record<string, unknown> } | null)?.worldData) ?? {}
    const mayFork = src.ownerId === user.id || (src.isPublic && wd['forkable'] === true)
    if (!mayFork) return NextResponse.json({ error: `"${baseWorld}" is not forkable — its maker has not enabled forking` }, { status: 403 })
    const snap = (src.snapshot && typeof src.snapshot === 'object') ? src.snapshot as Record<string, unknown> : { fields: [] }
    baseSnapshot = { ...snap, worldData: { ...(snap.worldData as Record<string, unknown> ?? {}), ...birthData } } as import('@prisma/client').Prisma.InputJsonValue
    forkOfId = src.id
  }

  const { space, token: rawToken } = await birthWorld({
    ownerId: user.id,
    name: name.trim(),
    baseSlug,
    description: description?.trim() || null,
    isPublic: !draft,   // brew wizard: a draft stays invisible until ENTER WORLD flips it
    worldData: Object.keys(birthData).length ? birthData : undefined,
    ...(baseSnapshot !== undefined ? { snapshot: baseSnapshot } : {}),
    ...(forkOfId ? { forkOfId } : {}),
  })

  // shape the response (the create returns the full row now — don't leak
  // snapshot / ownerId to the client)
  const shaped = { id: space.id, slug: space.slug, name: space.name, description: space.description, isPublic: space.isPublic, createdAt: space.createdAt }
  return NextResponse.json({ space: shaped, token: rawToken }, { status: 201 })
}
