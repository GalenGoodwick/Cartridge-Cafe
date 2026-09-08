import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { slugify } from '@/lib/slug'
import crypto from 'crypto'
import { canCreateWorld, sweepAbandonedDrafts, findOwnWorldByName, resolveBirthExtras } from '@/lib/world-create'
import { buildSpecFromCreateBody, specToWorldData, specToBirthParams, specIsPublic } from '@/lib/build-spec'
import { createWorldIdempotent } from '@/lib/create-world-service'

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
  // ONE CONTRACT (item 2): body → canonical BuildSpec → birth, the SAME mapping
  // every door uses. draft forces private (invisible until ENTER WORLD).
  const spec0 = buildSpecFromCreateBody(body)
  const spec = draft ? { ...spec0, visibility: 'private' as const } : spec0
  const specWd = specToWorldData(spec, { by: user.id, at: Date.now(), ...(extras.forkOfId ? { format: String(body?.base ?? '').trim() } : {}) })
  const worldData: Record<string, unknown> = { ...extras.birthData, ...specWd }
  // spec + brief ride the base snapshot too (extras merged only facet keys)
  const baseSnapshot = extras.baseSnapshot
    ? { ...(extras.baseSnapshot as Record<string, unknown>), worldData: { ...((extras.baseSnapshot as { worldData?: Record<string, unknown> }).worldData ?? {}), ...specWd } } as typeof extras.baseSnapshot
    : undefined
  const worldParams = Object.keys(extras.birthParams).length ? extras.birthParams : specToBirthParams(spec)

  // ONE CREATION, ONE PRICE + IDEMPOTENT (Galen, Aug 27): credit-spend and birth
  // are atomic in the shared service; a retry never double-charges or double-
  // creates, and a failed birth refunds in-place. keeper demos free.
  const { isAdminUserId } = await import('@/lib/adminAuth')
  const { stripeConfigured, GEN_PRICE_USD, hasIpShield } = await import('@/lib/stripe')
  const isKeeper = await isAdminUserId(user.id)
  const idempotencyKey = typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim() ? body.idempotencyKey.trim().slice(0, 120) : crypto.randomUUID()
  const outcome = await createWorldIdempotent({
    ownerId: user.id, idempotencyKey, isKeeper,
    birth: {
      ownerId: user.id, name: name.trim(), baseSlug, description: description?.trim() || null,
      isPublic: specIsPublic(spec, await hasIpShield(user.id)),
      ...(Object.keys(worldData).length ? { worldData } : {}),
      ...(Object.keys(worldParams).length ? { worldParams } : {}),
      ...(baseSnapshot !== undefined ? { snapshot: baseSnapshot } : {}),
      ...(extras.forkOfId ? { forkOfId: extras.forkOfId } : {}),
    },
  })
  if (!outcome.ok) {
    if (outcome.reason === 'needPayment') return NextResponse.json({ error: 'creating a world costs one generation credit', needPayment: true, buyable: stripeConfigured(), priceUsd: GEN_PRICE_USD }, { status: 402 })
    if (outcome.reason === 'inFlight') return NextResponse.json({ error: 'a create with this idempotency key is in progress — retry', retryable: true }, { status: 409 })
    return NextResponse.json({ error: outcome.message }, { status: 500 })
  }
  const s = outcome.space
  const shaped = { id: s.id, slug: s.slug, name: s.name, description: s.description, isPublic: s.isPublic, createdAt: s.createdAt }
  return NextResponse.json({ space: shaped, token: outcome.token, replayed: outcome.replayed }, { status: 201 })
}
