import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { slugify } from '@/lib/slug'
import { canCreateWorld, createSpaceUniqueSlug, sweepAbandonedDrafts } from '@/lib/world-create'
import { GEN_PRICE_USD, readGenCredits, spendGenCredit, stripeConfigured } from '@/lib/stripe'
import { ensureBuilderTables } from '@/lib/builder-tables'
import { commonsBus } from '@/lib/commons-bus'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** PAID WORLD GENERATION — the phone's native creation route.
 *
 *  A connected AI (Claude Code etc.) is the desktop way in; a phone can't run
 *  one. Here the player DESCRIBES a world, a paid credit is spent, and the
 *  HOUSE AI builds the brief: the world is born with creation_brief +
 *  __house_requested (the consent gate revalidate() enforces) and a BuildJob
 *  is enqueued directly — payment IS the explicit consent, same as the
 *  owner-authorized branch button (see lib/builds.ts).
 *
 *  GET  — credits + whether the product is buyable (renders the GENERATE door)
 *  POST {brief, name?} — spend a credit, create the world, queue the build.
 *       402 when broke (client sends them through /api/pay/checkout).
 */

export async function GET() {
  const session = await getServerSession(authOptions)
  const user = session?.user?.email
    ? await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
    : null
  return NextResponse.json({
    buyable: stripeConfigured(),   // ad-hoc priced — no per-product price id needed
    priceUsd: GEN_PRICE_USD,
    credits: user ? await readGenCredits(user.id) : 0,
    signedIn: !!user,
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

  const remaining = await spendGenCredit(user.id)
  if (remaining === null) {
    return NextResponse.json(
      { error: 'no generation credits', needPayment: true, buyable: stripeConfigured(), priceUsd: GEN_PRICE_USD },
      { status: 402 },
    )
  }

  try {
    await sweepAbandonedDrafts(user.id).catch(() => {})

    const name = String(body?.name ?? '').trim().slice(0, 60) || brief.slice(0, 40).replace(/\s+\S*$/, '')
    const baseSlug = slugify(name) || 'generated-world'

    // born public so the buyer can watch the house AI build it live; the brief
    // + house consent ride in the snapshot exactly where reconcile/revalidate look
    const space = await createSpaceUniqueSlug(baseSlug, (slug) => ({
      name,
      slug,
      description: brief.slice(0, 140),
      ownerId: user.id,
      isPublic: true,
      snapshot: {
        fields: [],
        worldData: {
          creation_brief: { prompt: brief, by: user.id, at: Date.now() },
          __house_requested: true,
        },
      },
    }))

    // BORN WITH ITS SLOTS (every create path)
    {
      const { applyCommandToSnapshot } = await import('../engine/space-store')
      const { placeholderSeedCommands } = await import('@/app/engine/placeholder-nodes')
      for (const seed of placeholderSeedCommands(Date.now())) {
        await applyCommandToSnapshot(space.id, seed).catch(() => {})
      }
    }

    // the world's first build key — the house builder's door in
    const rawToken = `uc_st_${crypto.randomBytes(16).toString('hex')}`
    await prisma.spaceToken.create({
      data: {
        name: 'first build key',
        tokenHash: crypto.createHash('sha256').update(rawToken).digest('hex'),
        tokenPrefix: rawToken.slice(0, 12) + '...',
        spaceId: space.id,
      },
    })

    // payment = consent: enqueue the BuildJob directly (reconcile never
    // auto-enrolls; this is the same explicit path as the branch button)
    await ensureBuilderTables()
    const job = await prisma.buildJob.create({
      data: {
        spaceId: space.id,
        spaceSlug: space.slug,
        brief,
        history: [{ at: new Date().toISOString(), by: 'owner', event: 'enqueued (paid generation)' }],
      },
      select: { id: true },
    })

    // ring the bus — a paid brief is work looking for a builder
    void commonsBus({ kind: 'system', who: 'cafe', text: `✧ paid generation: "${name}" (/space/${space.slug}) — a brief awaits a builder` })

    return NextResponse.json({ ok: true, slug: space.slug, name, jobId: job.id, credits: remaining }, { status: 201 })
  } catch (e) {
    // world creation failed AFTER the credit spent — refund it
    const { refundGenCredit } = await import('@/lib/stripe')
    void refundGenCredit(user.id).catch(() => {})
    const msg = e instanceof Error ? e.message : 'generation failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
