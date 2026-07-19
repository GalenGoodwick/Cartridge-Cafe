import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ensureBuilderTables } from '@/lib/builder-tables'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ── "Volunteer AI time" — enroll a Builder (DESIGN-builder-swarm.md §6–7) ────
// The signed-in human enrolls their AI as a swarm builder. Mints a `uc_bt_`
// token: scoped to swarm work only (claim jobs, get a per-job world token),
// never god-mode. Revocable. This is what the "Lend your AI" button calls.

async function currentUser() {
  await ensureBuilderTables()   // Builder table self-creates on prod (no migration)
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
}

/** GET — list my builders (control panel) */
export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  const builders = await prisma.builder.findMany({
    where: { ownerId: user.id, revokedAt: null },
    select: {
      id: true, displayName: true, tokenPrefix: true, enabled: true, idleOnly: true,
      maxConcurrent: true, reputation: true, jobsDone: true, abandons: true,
      lastSeenAt: true, createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ builders })
}

/** POST — enroll a new builder; returns the raw uc_bt_ token ONCE */
export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const displayName = (body.displayName || '').trim() || 'my AI'
  const idleOnly = body.idleOnly !== false
  const maxConcurrent = Math.min(Math.max(Number(body.maxConcurrent) || 1, 1), 4)

  // one accountable human, capped fleet — bounds a runaway enrollment
  const count = await prisma.builder.count({ where: { ownerId: user.id, revokedAt: null } })
  if (count >= 10) return NextResponse.json({ error: 'Maximum 10 builders' }, { status: 400 })

  const raw = `uc_bt_${crypto.randomBytes(16).toString('hex')}`
  try {
    const builder = await prisma.builder.create({
      data: {
        displayName: displayName.slice(0, 60),
        tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
        tokenPrefix: raw.slice(0, 12) + '...',
        ownerId: user.id,
        idleOnly,
        maxConcurrent,
      },
      select: { id: true, displayName: true, tokenPrefix: true },
    })
    // token shown once, never stored raw
    return NextResponse.json({ token: raw, builder }, { status: 201 })
  } catch (e) {
    // The most likely cause pre-launch: the builder-swarm migration hasn't run,
    // so the Builder table doesn't exist. Surface that instead of a bare 500.
    console.error('builder enroll failed:', e)
    return NextResponse.json(
      { error: 'enroll failed — is the builder-swarm DB migration applied?' },
      { status: 500 },
    )
  }
}

/** PATCH — toggle enabled / idle-only / concurrency from the control panel */
export async function PATCH(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const { id } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const owned = await prisma.builder.findFirst({ where: { id, ownerId: user.id, revokedAt: null }, select: { id: true } })
  if (!owned) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const data: { enabled?: boolean; idleOnly?: boolean; maxConcurrent?: number } = {}
  if (typeof body.enabled === 'boolean') data.enabled = body.enabled
  if (typeof body.idleOnly === 'boolean') data.idleOnly = body.idleOnly
  if (body.maxConcurrent != null) data.maxConcurrent = Math.min(Math.max(Number(body.maxConcurrent) || 1, 1), 4)
  await prisma.builder.update({ where: { id: owned.id }, data })
  return NextResponse.json({ ok: true })
}

/** DELETE — revoke a builder (Stop lending) */
export async function DELETE(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const { id } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const owned = await prisma.builder.findFirst({ where: { id, ownerId: user.id, revokedAt: null }, select: { id: true } })
  if (!owned) return NextResponse.json({ error: 'not found' }, { status: 404 })
  await prisma.builder.update({ where: { id: owned.id }, data: { revokedAt: new Date(), enabled: false } })
  return NextResponse.json({ ok: true })
}
