import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { slugify } from '@/lib/slug'
import crypto from 'crypto'
import { canCreateWorld, sweepAbandonedDrafts, resolveBirthExtras } from '@/lib/world-create'
import { GEN_BUNDLES, GEN_PRICE_USD, readGenCredits, stripeConfigured } from '@/lib/stripe'
import { buildSpecFromCreateBody, specToWorldData, specToBirthParams, specIsPublic } from '@/lib/build-spec'
import { createWorldIdempotent } from '@/lib/create-world-service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** PAID WORLD GENERATION (Galen, Aug 26: there is NO house AI — the person
 *  ALWAYS connects their own AI).
 *
 *  The player DESCRIBES a world, a paid credit is spent, and the world is BORN
 *  (private, with its slots + first build key) carrying creation_brief. The
 *  world page then hands the owner the CONNECT-YOUR-AI flow with their brief
 *  prefilled — their AI builds it live. No BuildJob queue, no phantom builder.
 *
 *  GET  — credits + whether the product is buyable (renders the GENERATE door)
 *  POST {brief, name?, base?} — spend a credit (admins free), birth the world;
 *       `base` = a base world's slug whose snapshot seeds the newborn (the
 *       chosen BLANK FORMAT), or absent = born empty with its slots.
 *       402 when broke (client sends them through /api/pay/checkout).
 */

export async function GET() {
  const session = await getServerSession(authOptions)
  const user = session?.user?.email
    ? await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
    : null
  const { isAdminUserId } = await import('@/lib/adminAuth')
  // THE FORMATS (Galen, Aug 27): generation starts from a chosen BLANK
  // FORMAT (a base world's snapshot) or from nothing — the picker's list.
  const bases = await prisma.$queryRawUnsafe<Array<{ slug: string; name: string }>>(
    `SELECT slug, name FROM "PlayerSpace"
     WHERE "isPublic" = true
       AND (snapshot->'worldData'->>'__base' = 'true' OR snapshot->'worldData'->>'forkable' = 'true')
     ORDER BY name ASC LIMIT 24`,
  ).catch(() => [] as Array<{ slug: string; name: string }>)
  return NextResponse.json({
    buyable: stripeConfigured(),   // ad-hoc priced — no per-product price id needed
    priceUsd: GEN_PRICE_USD,
    bundles: GEN_BUNDLES,          // {qty: totalUsd} — the discount table (one truth)
    credits: user ? await readGenCredits(user.id) : 0,
    free: user ? await isAdminUserId(user.id) : false,   // the keeper demos without credits
    signedIn: !!user,
    bases,
  })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, name: true } })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const brief = String(body?.brief ?? '').trim()
  if (brief.length < 20) {
    return NextResponse.json({ error: 'describe your world in at least a sentence (20+ characters)' }, { status: 400 })
  }
  if (brief.length > 2000) {
    return NextResponse.json({ error: 'brief too long (2000 max)' }, { status: 400 })
  }

  // the cap gates BEFORE the credit spends — never charge a credit for a world
  // that can't be born
  const gate = await canCreateWorld(user.id)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  // the generate flow's three answers (targets/access/base) — parsed by the
  // SHARED resolveBirthExtras, same as /api/spaces (universal-pipelines law).
  // Resolved BEFORE the credit spends — a bad base must never cost $5.
  let extras: Awaited<ReturnType<typeof resolveBirthExtras>>
  try {
    extras = await resolveBirthExtras(user.id, body)
  } catch (e) {
    const err = e as { status?: number; error?: string }
    return NextResponse.json({ error: err.error || 'bad base world' }, { status: err.status || 400 })
  }

  // ADMIN generates FREE (Galen, Aug 26: "as admin it should be free so I can
  // demo") — the keeper skips the credit spend entirely (and the catch below
  // never refunds a credit that was never spent).
  const { isAdminUserId } = await import('@/lib/adminAuth')
  const isKeeper = await isAdminUserId(user.id)

  await sweepAbandonedDrafts(user.id).catch(() => {})
  const name = String(body?.name ?? '').trim().slice(0, 60) || brief.slice(0, 40).replace(/\s+\S*$/, '')
  const baseSlug = slugify(name) || 'generated-world'

  // ONE CONTRACT (item 2): body → canonical BuildSpec → birth via the shared
  // mapper + idempotent, credit-safe service. SOLO launches private, OPEN public
  // (visibility from access); targets/base facets ride from resolveBirthExtras.
  // The FORMAT-seed hygiene lives inside resolveBirthExtras (the ONE base parser).
  const { hasIpShield } = await import('@/lib/stripe')
  const spec = buildSpecFromCreateBody({ ...body, name, brief })
  const specWd = specToWorldData(spec, { by: user.id, at: Date.now(), ...(extras.forkOfId ? { format: String(body?.base ?? '').trim() } : {}) })
  const worldData: Record<string, unknown> = { ...extras.birthData, ...specWd }
  const baseSnapshot = extras.baseSnapshot
    ? { ...(extras.baseSnapshot as Record<string, unknown>), worldData: { ...((extras.baseSnapshot as { worldData?: Record<string, unknown> }).worldData ?? {}), ...specWd } } as typeof extras.baseSnapshot
    : undefined
  const worldParams = Object.keys(extras.birthParams).length ? extras.birthParams : specToBirthParams(spec)
  const idempotencyKey = typeof body?.idempotencyKey === 'string' && body.idempotencyKey.trim() ? body.idempotencyKey.trim().slice(0, 120) : crypto.randomUUID()
  const outcome = await createWorldIdempotent({
    ownerId: user.id, idempotencyKey, isKeeper,
    birth: {
      ownerId: user.id, name, baseSlug, description: brief.slice(0, 140),
      isPublic: specIsPublic(spec, await hasIpShield(user.id)),
      ...(Object.keys(worldData).length ? { worldData } : {}),
      ...(Object.keys(worldParams).length ? { worldParams } : {}),
      ...(baseSnapshot !== undefined ? { snapshot: baseSnapshot } : {}),
      ...(extras.forkOfId ? { forkOfId: extras.forkOfId } : {}),
    },
  })
  if (!outcome.ok) {
    if (outcome.reason === 'needPayment') return NextResponse.json({ error: 'no generation credits', needPayment: true, buyable: stripeConfigured(), priceUsd: GEN_PRICE_USD }, { status: 402 })
    if (outcome.reason === 'inFlight') return NextResponse.json({ error: 'a create with this idempotency key is in progress — retry', retryable: true }, { status: 409 })
    return NextResponse.json({ error: outcome.message }, { status: 500 })
  }
  // NO BuildJob, NO phantom builder — the world is born with the brief; the
  // curtain hands the owner the CONNECT flow. Done.
  const remaining = isKeeper ? 0 : await readGenCredits(user.id)
  return NextResponse.json({ ok: true, slug: outcome.space.slug, name, credits: remaining, replayed: outcome.replayed }, { status: 201 })
}
