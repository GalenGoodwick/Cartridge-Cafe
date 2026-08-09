import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resetWorld } from '@/lib/worldSave'

export const dynamic = 'force-dynamic'

/** POST /api/spaces/:slug/reset — the R-key's SERVER half (owner only).
 *
 *  The owner tab's 2s sync persists live run state (a world's __-keys, the
 *  uniform whiteboard) into the space snapshot. A client-only R reset was
 *  therefore undone seconds later: the reload's rev-watcher merged the
 *  un-reset SERVER copy back over the fresh boot and put the player right
 *  back where they were (veilfire-3d, Aug 9). This resets the STORED
 *  snapshot through lib/worldSave.resetWorld — the same category-law reset
 *  as the reset_world bridge verb — and its __bridge_rev bump makes every
 *  other stale open tab reload instead of syncing its old state back.
 *
 *  Owner-gated on purpose: a guest's state never syncs into the snapshot,
 *  so their client-only reset already holds — and a guest must not be able
 *  to wipe a world's stored game state for everyone. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  const space = await prisma.playerSpace.findUnique({
    where: { slug },
    select: { id: true, ownerId: true },
  })
  if (!user || !space || space.ownerId !== user.id) {
    return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  }
  const out = await resetWorld(space.id)
  return NextResponse.json(out, { status: out.ok ? 200 : 500 })
}
