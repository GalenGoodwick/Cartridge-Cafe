import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readEntitlements, readGenCredits } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

/** GET /api/account/export — the signed-in user's data, as a JSON download.
 *  The access/portability right (GDPR arts. 15/20, CCPA): everything the cafe
 *  holds ABOUT the person, in one machine-readable file. Secrets (password
 *  hashes, token hashes, passkey credentials) are never exported — they are
 *  ours to store, not data about the person. */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true, name: true, image: true, createdAt: true, updatedAt: true, status: true },
  })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const [spaces, versions, passkeys, pushSubs, builders, accounts] = await Promise.all([
    prisma.playerSpace.findMany({
      where: { ownerId: user.id },
      select: { slug: true, name: true, description: true, isPublic: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.spaceVersion.count({ where: { authorId: user.id } }),
    prisma.passkey.findMany({ where: { userId: user.id }, select: { createdAt: true } }),
    prisma.pushSubscription.count({ where: { userId: user.id } }),
    prisma.builder.findMany({ where: { ownerId: user.id }, select: { displayName: true, createdAt: true } }),
    prisma.account.findMany({ where: { userId: user.id }, select: { provider: true } }),
  ])

  // the community layer (raw table by design — lib/notify.ts)
  let follows: { following: number; followers: number } = { following: 0, followers: 0 }
  try {
    const [a, b] = await Promise.all([
      prisma.$queryRawUnsafe<[{ n: bigint }]>(`SELECT COUNT(*)::bigint n FROM "CafeFollow" WHERE "followerId" = $1`, user.id),
      prisma.$queryRawUnsafe<[{ n: bigint }]>(`SELECT COUNT(*)::bigint n FROM "CafeFollow" WHERE "followeeId" = $1`, user.id),
    ])
    follows = { following: Number(a[0]?.n ?? 0), followers: Number(b[0]?.n ?? 0) }
  } catch { /* table may not exist yet on a fresh deploy */ }

  const [entitlements, genCredits] = await Promise.all([
    readEntitlements(user.id),
    readGenCredits(user.id),
  ])

  const body = {
    exportedAt: new Date().toISOString(),
    service: 'cartridge.cafe',
    scope: 'All personal data the service holds about this account. World CONTENT (shaders, hooks, snapshots) is exportable per-world via each world\'s cartridge export.',
    profile: user,
    signInMethods: accounts.map((a) => a.provider),
    worlds: spaces,
    savePointsAuthored: versions,
    passkeys: passkeys.map((p) => ({ createdAt: p.createdAt })),
    pushSubscriptions: pushSubs,
    aiBuilders: builders.map((b) => ({ name: b.displayName, createdAt: b.createdAt })),
    community: follows,
    purchases: { entitlements, generationCredits: genCredits },
  }

  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="cartridge-cafe-data-${new Date().toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
    },
  })
}
