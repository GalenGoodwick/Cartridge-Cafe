import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { handleOf } from '@/lib/notify'
import { listScenes, hydrateAllScenes } from '../../engine/store'

export const dynamic = 'force-dynamic'

/** GET /api/spaces/mine — everything the signed-in maker has made, for the
 *  MANAGE list (⚙ on their own world): the WORLDS they own (PlayerSpace rows)
 *  and the BRANCHES they authored (scene:<BASE ⑂ handle · [label ·] vN>, which
 *  live scattered across every base world they've challenged). One place to
 *  open / rename / delete their own stuff. Owner-scoped: only ever your own. */
export async function GET() {
  const session = await getServerSession(authOptions).catch(() => null)
  const uid = session?.user?.id
  const email = session?.user?.email
  if (!uid || !email) return NextResponse.json({ error: 'sign in' }, { status: 401 })
  const handle = handleOf(email)

  const worldRows = await prisma.playerSpace.findMany({
    where: { ownerId: uid },
    select: { slug: true, name: true, isPublic: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
    take: 500,
  })
  const worlds = worldRows.map(w => ({
    slug: w.slug,
    name: w.name,
    isPublic: w.isPublic,
    updatedAt: w.updatedAt.getTime(),
  }))

  // BRANCHES — scene names of the shape `BASE ⑂ handle · [label ·] vN`. Filter to
  // this maker's handle, then parse base / label / version for the list rows.
  await hydrateAllScenes()   // bridge/other-lambda branches live in Neon, not this disk
  const branches = listScenes()
    .map(fullName => {
      const bi = fullName.indexOf(' ⑂ ')
      if (bi < 0) return null
      const base = fullName.slice(0, bi)
      const rest = fullName.slice(bi + 3)              // `handle · [label ·] vN`
      const parts = rest.split(' · ')
      if (parts[0] !== handle) return null             // not mine
      const vTok = parts[parts.length - 1]
      const version = /^v(\d+)$/.test(vTok) ? Number(vTok.slice(1)) : 1
      const label = parts.slice(1, /^v\d+$/.test(vTok) ? -1 : undefined).join(' · ') || null
      return { name: fullName, base, label, version }
    })
    .filter((b): b is { name: string; base: string; label: string | null; version: number } => !!b)
    // newest base groups first is nice, but names have no timestamp here; keep
    // stable alphabetical by base then version so the list doesn't jump around.
    .sort((a, b) => a.base.localeCompare(b.base) || a.version - b.version)

  return NextResponse.json({ handle, worlds, branches })
}
