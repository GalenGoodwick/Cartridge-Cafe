import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { slugify } from '@/lib/slug'
import { canCreateWorld, createSpaceUniqueSlug } from '@/lib/world-create'
import { canForkWorld, normalizePolicy } from '@/lib/world-policy'
import { GEN_PRICE_USD, hasIpControl, refundGenCredit, spendGenCredit, stripeConfigured } from '@/lib/stripe'
import { isAdminUserId } from '@/lib/adminAuth'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** POST /api/spaces/:slug/fork — Remix a world: copy its live snapshot into a new space you own */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const source = await prisma.playerSpace.findUnique({
    where: { slug },
    select: { id: true, name: true, ownerId: true, isPublic: true, snapshot: true },
  })
  if (!source || (!source.isPublic && source.ownerId !== user.id)) {
    return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  }
  // THE FORK GATE (world-policy.canForkWorld) — FORK OFF BY DEFAULT (Galen,
  // Aug 30): every world forks EXCEPT premium, proprietary, and open live-edit
  // worlds, or a maker who opted out; bases always fork. Proprietary needs the
  // owner's IP-control standing (an account entitlement worldData can't carry),
  // so we look it up and pass it into the one gate.
  {
    const wd = (source.snapshot as { worldData?: Record<string, unknown> } | null)?.worldData
    const forkGate = canForkWorld(wd, await hasIpControl(source.ownerId))
    if (!forkGate.ok) return NextResponse.json({ error: forkGate.error }, { status: 403 })
  }

  // one gate for every create path — fork must not skip the world cap
  const gate = await canCreateWorld(user.id)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  // A FORK COSTS A BUILD CREDIT (Galen, Aug 30) — the same coin as a fresh
  // generation; the keeper forks free. Spent AFTER every refusal above so no
  // one pays for a fork that gets refused; refunded below if the copy fails.
  const isKeeper = await isAdminUserId(user.id)
  if (!isKeeper) {
    const spent = await spendGenCredit(user.id)
    if (spent === null) {
      return NextResponse.json(
        { error: 'forking a world costs one build credit', needPayment: true, buyable: stripeConfigured(), priceUsd: GEN_PRICE_USD },
        { status: 402 })
    }
  }

  // The copied snapshot must NOT inherit house-AI consent: __house_requested is
  // the source owner's explicit "have the house AI build it" — carried into a
  // remix it would auto-enroll the fork with the daemon (which then builds a
  // world nobody asked it to). Everything else (brief, brief_done) stays as
  // provenance; brief_done already blocks enrollment on finished worlds.
  if (source.snapshot && typeof source.snapshot === 'object') {
    const wd = (source.snapshot as { worldData?: Record<string, unknown> }).worldData
    if (wd && '__house_requested' in wd) delete wd.__house_requested
  }

  const body = await req.json().catch(() => ({}))
  const name = (typeof body.name === 'string' && body.name.trim())
    ? body.name.trim().slice(0, 60)
    : `${source.name} (remix)`
  // THE SOCIAL CONTRACT is chosen AT FORK (world-policy; immutable after).
  // A fork never inherits the source's contract — its terms are the forker's
  // to set, once. Malformed/absent → no policy key → the platform default.
  const policy = normalizePolicy(body.policy)
  if (source.snapshot && typeof source.snapshot === 'object') {
    const snapObj = source.snapshot as { worldData?: Record<string, unknown> }
    if (!snapObj.worldData) snapObj.worldData = {}
    delete snapObj.worldData.policy
    if (policy) snapObj.worldData.policy = policy
    // a fork is NEVER a base — __base is the house's declaration, not heritage
    // (inheriting it gave every fork of a base its own catalog tab)
    delete snapObj.worldData.__base
    // forkability is never INHERITED as an explicit flag: drop the source's
    // forkable choice so the fork starts at the platform default (fork off by
    // default) — its own maker may opt out later in World Tools
    delete snapObj.worldData.forkable
    // GRID DIMENSIONS SET AT FORK (Galen's ruling, task #20): the forker may
    // declare their world's coordinate space; otherwise the source's carries
    const gReq = Math.round(Number(body.gridSize))
    if (Number.isFinite(gReq) && gReq >= 64 && gReq <= 4096) {
      const so = source.snapshot as { worldParams?: Record<string, unknown> }
      so.worldParams = { ...(so.worldParams ?? {}), gridSize: gReq }
    }
    // THE FORK'S BRIEF (Galen, Aug 30): the "what should it become" prompt from
    // the FORK engine tab lands as creation_brief, so the AI you connect next
    // reads the intent. A fresh intent means the fork is not yet "done".
    if (typeof body.brief === 'string' && body.brief.trim()) {
      snapObj.worldData.creation_brief = { at: Date.now(), by: user.id, prompt: body.brief.trim().slice(0, 600) }
      delete snapObj.worldData.brief_done
    }
  }

  // race-safe unique slug (the old findUnique-then-create raced on the final
  // insert). A fork is born UNPUBLISHED (Galen's ruling): it reaches the shelf
  // only when its maker publishes it — never by inheritance from the source.
  try {
    const fork = await createSpaceUniqueSlug(slugify(name), (newSlug) => ({
      name,
      slug: newSlug,
      ownerId: user.id,
      forkOfId: source.id,
      isPublic: false,
      description: `Remix of ${source.name}`,
      ...(source.snapshot ? { snapshot: source.snapshot as Prisma.InputJsonValue } : {}),
    }))

    // the remix starts with its lineage recorded: version 1 = what was copied
    if (source.snapshot) {
      await prisma.spaceVersion.create({
        data: {
          spaceId: fork.id,
          version: 1,
          snapshot: source.snapshot as Prisma.InputJsonValue,
          authorId: user.id,
          note: `Remixed from ${slug}`,
        },
      })
    }

    // shape the response (the create returns the full row — don't leak snapshot)
    return NextResponse.json({ space: { id: fork.id, slug: fork.slug, name: fork.name, createdAt: fork.createdAt } }, { status: 201 })
  } catch (e) {
    if (!isKeeper) await refundGenCredit(user.id).catch(() => {})
    throw e
  }
}
