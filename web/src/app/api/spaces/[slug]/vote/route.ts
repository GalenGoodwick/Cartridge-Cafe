import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { loadGameSlot, saveGameSlotStrict } from '@/app/api/engine/store'
import { ipOf, voterIdFromIp } from '@/lib/voter-id'
import { readVoteDoc, toggleVote, voteCount } from '@/lib/votes'

export const dynamic = 'force-dynamic'

// ♥ UPVOTE — one vote per player per world, upvote ONLY (Galen's ruling: no
// downvote). GET reads { count, mine }; POST toggles YOUR vote (cast ⇄
// withdraw). Public worlds only — a private world has no shelf to rank.
//
// STORAGE: the `votes:<spaceId>` engine slot ({ up: { [voterId]: at } }),
// written saveGameSlotStrict so a vote is durable before we report it. The
// slot write is read-modify-write, not atomic — two simultaneous votes can
// race and drop one. Chosen anyway: traffic is a tap-per-player-per-world
// (nothing like chat's cadence), the loser can just tap again, and the slot
// rail needs no migration. If ♥ ever carries money or ranking stakes worth
// gaming, move it to a SQL table with a unique (spaceId, voterId) row.
// The slot is in save/route.ts's RESERVED_SLOT list, so the raw slot API can
// neither read voter handles nor forge counts — this route is the only door.
//
// IDENTITY: the signed-in user id (namespaced `u:`), else the same salted
// IP hash /api/voter-id serves (`v-…`). The two namespaces never collide; the
// known cost is that one human can vote once signed out and once signed in —
// accepted, same as the tournament's spectator-voting stance.

async function voterFor(req: NextRequest): Promise<string> {
  const uid = (await getServerSession(authOptions).catch(() => null))?.user?.id
  if (uid) return 'u:' + uid
  return voterIdFromIp(ipOf(req.headers))
}

/** Resolve slug → the space's id, public-only. Null = 404 (a private world
 *  404s rather than 403s, so the route never confirms it exists). */
async function publicSpaceId(slug: string): Promise<string | null> {
  const space = await prisma.playerSpace.findUnique({
    where: { slug },
    select: { id: true, isPublic: true },
  })
  return space?.isPublic ? space.id : null
}

/** GET /api/spaces/:slug/vote → { count, mine } */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const spaceId = await publicSpaceId(slug)
  if (!spaceId) return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  const voter = await voterFor(req)
  const doc = readVoteDoc(await loadGameSlot('votes:' + spaceId).catch(() => undefined))
  return NextResponse.json(
    { count: voteCount(doc), mine: voter in doc.up },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },   // the bar's live truth — never a stale mine
  )
}

/** POST /api/spaces/:slug/vote → toggle my vote → { count, mine } */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const spaceId = await publicSpaceId(slug)
  if (!spaceId) return NextResponse.json({ error: 'Space not found' }, { status: 404 })
  const voter = await voterFor(req)
  const cur = readVoteDoc(await loadGameSlot('votes:' + spaceId).catch(() => undefined))
  const { doc, count, mine } = toggleVote(cur, voter, Date.now())
  try {
    await saveGameSlotStrict('votes:' + spaceId, doc)
  } catch {
    return NextResponse.json({ error: 'vote did not persist — try again' }, { status: 503 })
  }
  return NextResponse.json({ count, mine })
}
