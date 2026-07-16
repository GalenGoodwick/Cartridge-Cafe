import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { mintCompanionKey, slugify } from '@/lib/companion'

export const dynamic = 'force-dynamic'

// Human-facing: issue / list / revoke a personal key for an AI companion.
// The companion then uses that uc_ck_ key against /api/companion/world.

async function sessionUser() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
}

/** GET /api/companion — list my companions */
export async function GET() {
  const user = await sessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const companions = await prisma.companion.findMany({
    where: { ownerId: user.id, revokedAt: null },
    select: {
      id: true, name: true, handle: true, keyPrefix: true, provenance: true,
      worldsPerDay: true, lastActiveAt: true, createdAt: true,
      _count: { select: { createdSpaces: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ companions })
}

/** POST /api/companion — issue a personal key. Returns the raw uc_ck_ ONCE. */
export async function POST(req: NextRequest) {
  const user = await sessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const name = (body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  // one accountable human should not run an unbounded fleet
  const count = await prisma.companion.count({ where: { ownerId: user.id, revokedAt: null } })
  if (count >= 20) return NextResponse.json({ error: 'Maximum 20 companions per account' }, { status: 400 })

  // stable, unique handle (identity slug) — derive from name, add a short suffix
  const base = slugify(body.handle || name) || 'companion'
  let handle = base
  for (let i = 0; i < 6; i++) {
    const exists = await prisma.companion.findUnique({ where: { handle }, select: { id: true } })
    if (!exists) break
    handle = `${base}-${Math.random().toString(36).slice(2, 6)}`
  }

  const key = mintCompanionKey()
  const worldsPerDay = Number.isFinite(body.worldsPerDay) ? Math.max(0, Math.min(200, body.worldsPerDay)) : 20

  const companion = await prisma.companion.create({
    data: {
      name, handle,
      keyHash: key.keyHash, keyPrefix: key.keyPrefix,
      provenance: (body.provenance || '').trim() || null,
      ownerId: user.id, worldsPerDay,
    },
    select: { id: true, name: true, handle: true, keyPrefix: true, worldsPerDay: true, createdAt: true },
  })

  // the raw key is shown once and never stored
  return NextResponse.json({ companion, key: key.raw }, { status: 201 })
}

/** DELETE /api/companion — revoke a companion (its key stops working). */
export async function DELETE(req: NextRequest) {
  const user = await sessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const { companionId } = body
  if (!companionId) return NextResponse.json({ error: 'companionId is required' }, { status: 400 })
  const c = await prisma.companion.findUnique({ where: { id: companionId }, select: { id: true, ownerId: true } })
  if (!c || c.ownerId !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await prisma.companion.update({ where: { id: companionId }, data: { revokedAt: new Date() } })
  return NextResponse.json({ ok: true })
}
