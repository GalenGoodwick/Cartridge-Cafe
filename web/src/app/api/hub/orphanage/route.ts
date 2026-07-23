// THE ORPHANAGE (Galen) — a home in PLAYER WORLDS for HIDDEN worlds: the ones
// that never surface on main because they're still building, blank drafts, or
// unlisted. You can SEE an orphan exists here; you can't walk in (the tiles are
// non-clickable — a bubble with no launch). Search routes hidden hits here.
//
// Privacy is load-bearing: someone else's PRIVATE world is never listed — its
// existence is theirs to reveal. So the public orphanage shows only worlds that
// are public-but-not-yet-visible (building / blank / freshly unlisted-by-flag),
// and a signed-in caller additionally sees THEIR OWN hidden worlds.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type Orphan = { name: string; slug: string; why: 'building' | 'blank' | 'private' | 'unlisted'; mine: boolean }

export async function GET() {
  const session = await getServerSession(authOptions).catch(() => null)
  const uid = session?.user?.id

  // public worlds (to detect building/blank orphans) + the caller's own worlds
  const spaces = await prisma.playerSpace.findMany({
    where: uid ? { OR: [{ isPublic: true }, { ownerId: uid }] } : { isPublic: true },
    select: {
      slug: true, name: true, isPublic: true, ownerId: true, snapshot: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 300,
  })

  const orphans: Orphan[] = []
  for (const s of spaces) {
    const sn = s.snapshot as { fields?: unknown[]; stepHooks?: unknown[]; visualTypes?: unknown[]; worldData?: { creation_brief?: unknown; brief_done?: unknown } } | null
    const blank = !sn || (!(sn.fields?.length) && !(sn.stepHooks?.length) && !(sn.visualTypes?.length))
    const building = !!(sn?.worldData?.creation_brief) && !(sn?.worldData?.brief_done)
    const mine = !!uid && s.ownerId === uid
    const priv = s.isPublic === false

    // What makes it an orphan (i.e. absent from main's roster)?
    let why: Orphan['why'] | null = null
    if (building) why = 'building'
    else if (priv) why = 'private'     // only reaches here for the caller's own (query already filtered)
    else if (blank) why = 'blank'
    if (!why) continue                 // a normal public, built, visible world — not an orphan

    // never leak someone else's private world
    if (why === 'private' && !mine) continue

    orphans.push({ name: s.name, slug: s.slug, why, mine })
  }

  return NextResponse.json({
    ok: true,
    count: orphans.length,
    orphans,
    note: 'orphans are visible but not enterable — search routes here; entry still obeys each world’s own rules',
  })
}
