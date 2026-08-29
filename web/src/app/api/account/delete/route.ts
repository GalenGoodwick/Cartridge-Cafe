import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { findActiveSubscriptions, cancelSubscriptionNow } from '@/lib/stripe'
import { loadGameSlot, saveGameSlot } from '@/app/api/engine/store'

export const dynamic = 'force-dynamic'

/** POST /api/account/delete — the erasure right (GDPR art. 17, CCPA).
 *  Body: { confirm: "<the account's email, typed>" } — deletion is destructive
 *  and must be deliberate.
 *
 *  What happens, in order:
 *  1. Active Stripe subscriptions are CANCELED IMMEDIATELY — a deleted account
 *     is never billed again.
 *  2. Owned worlds: ALL PRESERVED (Galen, Aug 29: "deleting an account
 *     doesn't delete worlds") — every world survives under the anonymized
 *     account, carrying no personal data. Private worlds stay private
 *     (unreachable, but the work is never destroyed).
 *  3. Sign-in surface erased: oauth links, sessions, passkeys, push
 *     subscriptions, AI builder registrations.
 *  4. Community + purchase records wiped: follows (both directions),
 *     entitlements, generation credits, notifications.
 *  5. The user row is ANONYMIZED (status DELETED, email replaced, name/image/
 *     password removed) — kept only so preserved worlds and foreign-key
 *     history don't dangle, holding zero personal data. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true },
  })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const body = (await req.json().catch(() => null)) as { confirm?: string } | null
  if (!body?.confirm || body.confirm.trim().toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json({ error: 'type your account email to confirm deletion' }, { status: 400 })
  }

  // 1 — stop the money FIRST (billing a deleted account is the one unforgivable bug)
  const subs = await findActiveSubscriptions(user.id)
  for (const s of subs) await cancelSubscriptionNow(s.id)

  // 2 — worlds: ALL preserved (Galen, Aug 29) — the erasure right covers the
  // PERSON (sign-in, billing, community records, the name on the row), never
  // the worlds. They ride the anonymized row; private ones stay private.
  const spaces = await prisma.playerSpace.findMany({
    where: { ownerId: user.id }, select: { slug: true },
  })
  const preserved: string[] = spaces.map(s => s.slug)
  const deleted: string[] = []

  // 2b — the person's MEMBER SEATS on other people's worlds: revoked (the
  // seat is an access credential carrying their handle; their landed WORK —
  // save points, nodes — stays in those worlds, attributed to the anonymized
  // row, exactly like history should)
  const handle = user.email.split('@')[0].replace(/[^a-z0-9_-]/gi, '')
  if (handle) {
    await prisma.spaceToken.updateMany({
      where: { name: `member:${handle}`, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }

  // 3 — the sign-in surface
  await prisma.$transaction([
    prisma.account.deleteMany({ where: { userId: user.id } }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
    prisma.passkey.deleteMany({ where: { userId: user.id } }),
    prisma.pushSubscription.deleteMany({ where: { userId: user.id } }),
    prisma.builder.deleteMany({ where: { ownerId: user.id } }),
  ])

  // 4 — community + purchase records
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM "CafeFollow" WHERE "followerId" = $1 OR "followeeId" = $1`, user.id)
  } catch { /* table may not exist yet */ }
  await saveGameSlot('entitlements:' + user.id, {})
  await saveGameSlot('gencredits:' + user.id, {})
  try {
    if (await loadGameSlot('notifications:' + user.id)) await saveGameSlot('notifications:' + user.id, {})
  } catch { /* slot shape unknown — best effort */ }

  // 5 — anonymize the row (kept so preserved worlds + history never dangle)
  await prisma.user.update({
    where: { id: user.id },
    data: {
      email: `deleted-${user.id}@deleted.invalid`,
      name: null,
      image: null,
      passwordHash: null,
      status: 'DELETED',
      deletedAt: new Date(),
    },
  })

  return NextResponse.json({ ok: true, deletedWorlds: deleted, preservedWorlds: preserved })
}
