import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canCreateWorld, forkSnapshotToSpace } from '@/lib/world-create'
import { normalizePolicy, policyOf } from '@/lib/world-policy'
import { GEN_PRICE_USD, refundGenCredit, spendGenCredit, stripeConfigured } from '@/lib/stripe'
import { isAdminUserId } from '@/lib/adminAuth'
import { hydrateScene, loadScene } from '../../store'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** POST /api/engine/scene/fork { name, label? } — fork a HOUSE/scene world into
 *  a private playerSpace the signed-in user OWNS. The fork-paradigm replacement
 *  for "create branch": instead of an ownerless `BASE ⑂ handle · v1` scene, the
 *  remixer gets a real world — maker tag, forkOf lineage, shelf-capable. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'sign in to fork a world — the fork is yours, so it needs an owner' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const body = await req.json().catch(() => null) as { name?: string; label?: string } | null
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name required — which world are you forking?' }, { status: 400 })

  await hydrateScene(name)
  const scene = loadScene(name)
  if (!scene) return NextResponse.json({ error: `no world named "${name}"` }, { status: 404 })

  // NO FORKING LIVE-EDIT WORLDS (Galen, Aug 30): a communal open-building
  // world is ONE world by contract — house scenes are the catalog (fork-able
  // stock), but an open-ground scene never forks. Bases stay exempt.
  {
    const wd = (scene as { worldData?: Record<string, unknown> }).worldData
    if (policyOf(wd).build === 'anyone' && wd?.__base !== true) {
      return NextResponse.json({ error: 'this is a live-edit world — everyone builds the ONE world together; it cannot be forked' }, { status: 403 })
    }
  }

  const gate = await canCreateWorld(user.id)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  // A FORK COSTS A BUILD CREDIT (Galen, Aug 30) — same coin as a generation;
  // the keeper forks free. Spent after every refusal, refunded if the copy fails.
  const isKeeper = await isAdminUserId(user.id)
  if (!isKeeper) {
    const spent = await spendGenCredit(user.id)
    if (spent === null) {
      return NextResponse.json(
        { error: 'forking a world costs one build credit', needPayment: true, buyable: stripeConfigured(), priceUsd: GEN_PRICE_USD },
        { status: 402 })
    }
  }

  const label = typeof body?.label === 'string' ? body.label : undefined
  const policy = normalizePolicy((body as { policy?: unknown })?.policy)
  // fork from the BASE display name (a fork of someone's branch credits the base line)
  const baseName = name.split(' ⑂ ')[0]
  try {
    const space = await forkSnapshotToSpace({
      userId: user.id, baseName, label,
      snapshot: scene as unknown as Prisma.InputJsonValue,
      policy: policy ?? undefined,
    })
    return NextResponse.json({
      ok: true, forked: true, slug: space.slug, name: space.name,
      next: `your fork lives at /space/${space.slug} — private until you publish it`,
    }, { status: 201 })
  } catch (e) {
    if (!isKeeper) await refundGenCredit(user.id).catch(() => {})
    throw e
  }
}
