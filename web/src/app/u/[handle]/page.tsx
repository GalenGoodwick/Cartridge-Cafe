import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { usersByHandle, handleOf } from '@/lib/notify'
import { hydrateAllScenes, listScenes } from '../../api/engine/store'
import ProfileActions from './ProfileActions'
import CafeShell from '@/app/CafeShell'

export const dynamic = 'force-dynamic'

/** /u/<handle> — a maker's page. TWO faces by who's looking:
 *  · the OWNER (signed in, viewing their own handle) gets the interactive cafe
 *    shelf filtered to their own worlds — "MY WORLDS" as a real, shareable URL.
 *  · everyone else gets the public profile: worlds, branches, follow.
 *  The handle is the same one stamped into every branch name (⑂ handle · vN). */
export default async function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params

  const session = await getServerSession(authOptions)
  const viewerHandle = session?.user?.email ? handleOf(session.user.email) : null
  if (viewerHandle && viewerHandle === handle) {
    // your own page IS your shelf — the same shell, filtered to your deeds
    return <CafeShell initialMine />
  }

  const users = await usersByHandle(handle)
  const display = users[0]?.name || handle

  const spaces = users.length
    ? await prisma.playerSpace.findMany({
        where: { ownerId: { in: users.map(u => u.id) }, isPublic: true },
        select: { slug: true, name: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      })
    : []

  await hydrateAllScenes()
  const branches = new Map<string, { name: string; v: number }>()
  for (const n of listScenes()) {
    const m = n.match(/^(.+) ⑂ (.+?)(?: · .+)? · v(\d+)$/)
    if (!m || m[2] !== handle) continue
    const base = n.replace(/ · v\d+$/, '')
    const cur = branches.get(base)
    if (!cur || +m[3] > cur.v) branches.set(base, { name: n, v: +m[3] })
  }

  return (
    <div className="min-h-screen bg-[#0d0906] text-[#e8d5b5] font-mono">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <a href="/" className="text-[11px] tracking-[0.25em] text-[#8a7454] hover:text-[#e8d5b5]">◂ THE CAFE</a>
        <div className="mt-6 flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] tracking-[0.4em] text-[#b9722a] uppercase">maker</div>
            <h1 className="text-4xl mt-1" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>{display}</h1>
            <div className="text-[11px] text-[#8a7454] mt-1">⑂ {handle}</div>
          </div>
          <ProfileActions handle={handle} />
        </div>

        <div className="mt-10">
          <div className="text-[11px] tracking-[0.3em] text-[#b9722a] uppercase mb-3">worlds · {spaces.length}</div>
          {spaces.length === 0 && <div className="text-[12px] text-[#8a7454]">no public worlds yet</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {spaces.map(s => (
              <a key={s.slug} href={`/space/${s.slug}`}
                className="block rounded-lg border border-[#b9722a]/25 bg-black/30 px-4 py-3 hover:border-[#f5b04c]/60 transition-colors">
                <div className="text-[14px]" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>{s.name}</div>
                <div className="text-[10px] text-[#8a7454] mt-0.5">enter ▸</div>
              </a>
            ))}
          </div>
        </div>

        <div className="mt-10">
          <div className="text-[11px] tracking-[0.3em] text-[#b9722a] uppercase mb-3">branches · {branches.size}</div>
          {branches.size === 0 && <div className="text-[12px] text-[#8a7454]">no branches yet — every world on the shelf can be branched</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[...branches.values()].map(b => (
              <a key={b.name} href={`/play/${encodeURIComponent(b.name)}`}
                className="block rounded-lg border border-[#b9722a]/25 bg-black/30 px-4 py-3 hover:border-[#f5b04c]/60 transition-colors">
                <div className="text-[13px]">{b.name.split(' ⑂ ')[0]} <span className="text-[#8a7454]">· v{b.v}</span></div>
                <div className="text-[10px] text-[#8a7454] mt-0.5">play the head ▸</div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
