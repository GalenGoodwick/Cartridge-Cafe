import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleOf } from '@/lib/notify'
import { prisma } from '@/lib/prisma'
import MyWorldsList from './MyWorldsList'

export const dynamic = 'force-dynamic'

/** /mine — YOUR ACCOUNT PAGE: the game list + management (Galen, Aug 27:
 *  "delete world should probably go onto user account page with game list —
 *  but multiple edit worlds are protected"). Deletion lives HERE now, off the
 *  world page entirely. Open (co-built) worlds show a lock — the server
 *  refuses their deletion until the world is made solo. The pretty public
 *  shelf stays at /u/<handle>; this is the workbench. */
export default async function Mine() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) redirect('/auth/signin?callbackUrl=/mine')
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
  if (!user) redirect('/auth/signin?callbackUrl=/mine')

  // one query: the game list + each world's open-build flag + declared fit
  const rows = await prisma.$queryRaw<{
    slug: string; name: string; isPublic: boolean; updatedAt: Date
    build: string | null; access: string | null; fit: string | null; forks: bigint
  }[]>`
    SELECT s.slug, s.name, s."isPublic", s."updatedAt",
           s.snapshot->'worldData'->>'build'  AS build,
           s.snapshot->'worldData'->>'access' AS access,
           s.snapshot->'worldData'->>'fit'    AS fit,
           (SELECT COUNT(*) FROM "PlayerSpace" c WHERE c."forkOfId" = s.id) AS forks
    FROM "PlayerSpace" s WHERE s."ownerId" = ${user.id}
    ORDER BY s."updatedAt" DESC`

  const worlds = rows.map(r => ({
    slug: r.slug, name: r.name, isPublic: r.isPublic,
    updatedAt: r.updatedAt.toISOString(),
    open: r.build === 'anyone' || r.access === 'open',
    fit: r.fit === 'mobile' || r.fit === 'desktop' ? r.fit : 'universal',
    forks: Number(r.forks),
  }))

  return <MyWorldsList worlds={worlds} handle={handleOf(session.user.email)} />
}
