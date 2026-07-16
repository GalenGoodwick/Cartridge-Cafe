import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validateCompanionKey, mintSpaceToken, bearer, slugify } from '@/lib/companion'

export const dynamic = 'force-dynamic'

// Companion-facing: the self-serve world gateway. A companion presents its OWN
// uc_ck_ personal key and creates / lists ITS OWN worlds. It can never touch
// main or another owner's world — creation only, born private, quota-bounded.

/** GET /api/companion/world — list the worlds this companion created */
export async function GET(req: NextRequest) {
  const raw = bearer(req)
  const auth = raw ? await validateCompanionKey(raw) : null
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const spaces = await prisma.playerSpace.findMany({
    where: { createdByCompanionId: auth.companionId },
    select: { id: true, slug: true, name: true, isPublic: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return NextResponse.json({ companion: { handle: auth.handle, name: auth.name }, spaces })
}

/** POST /api/companion/world — the companion creates its own world. */
export async function POST(req: NextRequest) {
  const raw = bearer(req)
  const auth = raw ? await validateCompanionKey(raw) : null
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const name = (body.name || '').trim() || `${auth.name} — untitled`
  const brief = (body.brief || '').trim()

  // Quota: worlds created by THIS companion in the last 24h (the runaway leash).
  if (auth.worldsPerDay > 0) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const made = await prisma.playerSpace.count({
      where: { createdByCompanionId: auth.companionId, createdAt: { gte: since } },
    })
    if (made >= auth.worldsPerDay) {
      return NextResponse.json(
        { error: `Daily world quota reached (${auth.worldsPerDay}/24h)`, retryAfterHours: 24 },
        { status: 429 },
      )
    }
  }

  // Unique slug: prefix with the companion handle so its worlds are recognizably its.
  const base = (slugify(body.slug || name) || 'world').slice(0, 40)
  let slug = `${auth.handle}-${base}`.slice(0, 60)
  for (let i = 0; i < 8; i++) {
    const exists = await prisma.playerSpace.findUnique({ where: { slug }, select: { id: true } })
    if (!exists) break
    slug = `${auth.handle}-${base}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 60)
  }

  // Born PRIVATE. The world carries who built it, and (if given) the brief the
  // companion is building to — the same creation-brief contract human worlds use.
  const worldData: Record<string, unknown> = { built_by: auth.name, built_by_companion: auth.handle }
  if (brief) worldData.creation_brief = { prompt: brief, by: auth.handle, at: Date.now() }

  const space = await prisma.playerSpace.create({
    data: {
      name,
      slug,
      ownerId: auth.ownerId,            // accountable human
      createdByCompanionId: auth.companionId,
      isPublic: false,                  // born private — commons entry still crosses a human
      snapshot: { fields: [], worldData } as never,
    },
    select: { id: true, slug: true, name: true, isPublic: true, createdAt: true },
  })

  // Mint the world-scoped token the companion uses to build it via the bridge.
  const tok = mintSpaceToken()
  await prisma.spaceToken.create({
    data: { name: `${auth.name} (self)`, tokenHash: tok.tokenHash, tokenPrefix: tok.tokenPrefix, spaceId: space.id },
  })

  const origin = new URL(req.url).origin
  return NextResponse.json(
    { space, token: tok.raw, viewUrl: `${origin}/space/${space.slug}`, bridgeUrl: `${origin}/api/engine/bridge` },
    { status: 201 },
  )
}
