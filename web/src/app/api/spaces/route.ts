import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { slugify } from '@/lib/slug'
import { canCreateWorld, birthWorld, sweepAbandonedDrafts, findOwnWorldByName, resolveBirthExtras } from '@/lib/world-create'

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
  // Parsed by the SHARED resolveBirthExtras so /api/spaces and /api/generate
  // can never drift (universal-pipelines law).
  let extras: Awaited<ReturnType<typeof resolveBirthExtras>>
  try {
    extras = await resolveBirthExtras(user.id, body)
  } catch (e) {
    const err = e as { status?: number; error?: string }
    return NextResponse.json({ error: err.error || 'bad base world' }, { status: err.status || 400 })
  }
  const birthData: Record<string, unknown> = {
    ...(brief?.trim() ? { creation_brief: { prompt: brief.trim(), by: user.id, at: Date.now() } } : {}),
    ...extras.birthData,
  }
  // brief must ride the base snapshot too (extras merged only facet keys)
  const baseSnapshot = extras.baseSnapshot && brief?.trim()
    ? { ...(extras.baseSnapshot as Record<string, unknown>), worldData: { ...((extras.baseSnapshot as { worldData?: Record<string, unknown> }).worldData ?? {}), creation_brief: birthData.creation_brief } } as typeof extras.baseSnapshot
    : extras.baseSnapshot

  // ONE CREATION, ONE PRICE (Galen, Aug 27: "birth and generate are the same
  // process — we have to charge $5 per world created to prevent clutter/
  // attacks"). The SAME credit gate as /api/generate — no free side door
  // through this route. Spent AFTER all validation (a 400 never charges);
  // keeper demos free; a failed birth refunds.
  const { isAdminUserId } = await import('@/lib/adminAuth')
  const { spendGenCredit, refundGenCredit, stripeConfigured, GEN_PRICE_USD } = await import('@/lib/stripe')
  const isKeeper = await isAdminUserId(user.id)
  if (!isKeeper) {
    const spent = await spendGenCredit(user.id)
    if (spent === null) {
      return NextResponse.json(
        { error: 'creating a world costs one generation credit', needPayment: true, buyable: stripeConfigured(), priceUsd: GEN_PRICE_USD },
        { status: 402 },
      )
    }
  }

  try {
    const { space, token: rawToken } = await birthWorld({
      worldParams: extras.birthParams,
      ownerId: user.id,
      name: name.trim(),
      baseSlug,
      description: description?.trim() || null,
      isPublic: !draft && !(await (await import('@/lib/stripe')).hasIpControl(user.id)),   // draft stays invisible until ENTER WORLD; a PROPRIETARY owner's worlds are never auto-shelved (Galen, Sep 5)
      worldData: Object.keys(birthData).length ? birthData : undefined,
      ...(baseSnapshot !== undefined ? { snapshot: baseSnapshot } : {}),
      ...(extras.forkOfId ? { forkOfId: extras.forkOfId } : {}),
    })

    // shape the response (the create returns the full row now — don't leak
    // snapshot / ownerId to the client)
    const shaped = { id: space.id, slug: space.slug, name: space.name, description: space.description, isPublic: space.isPublic, createdAt: space.createdAt }
    return NextResponse.json({ space: shaped, token: rawToken }, { status: 201 })
  } catch (e) {
    if (!isKeeper) void refundGenCredit(user.id).catch(() => {})   // birth failed — the credit comes back
    const msg = e instanceof Error ? e.message : 'world creation failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
