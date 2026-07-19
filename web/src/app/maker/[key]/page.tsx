import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface MakerPageProps {
  params: Promise<{ key: string }>
}

/** Resolve a maker from either form the UI links with:
 *  - a User id (space owner links from the title box)
 *  - a branch handle (the email prefix branches are signed with) */
async function resolveMaker(key: string) {
  const byId = await prisma.user.findUnique({ where: { id: key }, select: { id: true, name: true, image: true } })
  if (byId) return byId
  return prisma.user.findFirst({
    where: { email: { startsWith: `${key}@` } },
    select: { id: true, name: true, image: true },
  })
}

export async function generateMetadata({ params }: MakerPageProps) {
  const { key } = await params
  const maker = await resolveMaker(decodeURIComponent(key))
  return { title: maker ? `${maker.name || 'a maker'} — worlds` : 'Maker not found' }
}

/** /maker/[key] — one maker, just their projects: every world they own that
 *  you are allowed to see (public for everyone; + private when it's your page). */
export default async function MakerPage({ params }: MakerPageProps) {
  const { key } = await params
  const maker = await resolveMaker(decodeURIComponent(key))
  if (!maker) notFound()

  const session = await getServerSession(authOptions).catch(() => null)
  const viewerId = session?.user?.email
    ? (await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } }))?.id
    : null
  const isSelf = viewerId === maker.id

  const spaces = await prisma.playerSpace.findMany({
    where: { ownerId: maker.id, ...(isSelf ? {} : { isPublic: true }) },
    select: {
      slug: true, name: true, description: true, isPublic: true, updatedAt: true,
      forkOf: { select: { name: true, slug: true } },
      _count: { select: { versions: true, forks: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  })

  return (
    <main className="min-h-screen bg-[#0d0a08] text-white/80 font-sans px-6 py-10">
      <div className="max-w-2xl mx-auto">
        <a href="/?commons=1" className="font-mono text-[12px] tracking-[0.2em] text-white/40 hover:text-white transition-colors">⟵ CAFE</a>
        <div className="mt-6 mb-8 flex items-center gap-3">
          {maker.image && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={maker.image} alt="" className="w-10 h-10 rounded-full border border-[#b97a2a]/40" />
          )}
          <div>
            <h1 className="font-display italic text-2xl text-[#ffdba8]">{maker.name || 'a maker'}</h1>
            <div className="font-mono text-[12px] tracking-[0.2em] text-white/40 uppercase">
              {spaces.length} {spaces.length === 1 ? 'world' : 'worlds'}{isSelf ? ' · yours, private included' : ''}
            </div>
          </div>
        </div>

        {spaces.length === 0 && (
          <div className="font-mono text-[13px] text-white/40 border border-white/10 rounded-lg px-4 py-6 text-center">
            no worlds yet — the shelf is waiting
          </div>
        )}

        <div className="space-y-2">
          {spaces.map(s => (
            <a key={s.slug} href={`/space/${encodeURIComponent(s.slug)}`}
              className="block rounded-lg border border-[#b97a2a]/20 bg-[#171009]/70 px-4 py-3 hover:border-[#b97a2a]/50 hover:bg-[#171009] transition-colors">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-display italic text-[#ffdba8] text-lg truncate">{s.name}</span>
                <span className="font-mono text-[12px] tracking-[0.15em] text-white/35 shrink-0 uppercase">
                  {!s.isPublic && <span className="text-amber-300/70 mr-2">private</span>}
                  {new Date(s.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                </span>
              </div>
              <div className="font-mono text-[12px] text-white/40 mt-1 flex items-center gap-3">
                {s.forkOf && <span>⑂ remix of {s.forkOf.name}</span>}
                <span>{s._count.versions} {s._count.versions === 1 ? 'version' : 'versions'}</span>
                {s._count.forks > 0 && <span>{s._count.forks} {s._count.forks === 1 ? 'remix' : 'remixes'}</span>}
              </div>
              {s.description && <div className="text-[14px] text-white/50 mt-1 line-clamp-2">{s.description}</div>}
            </a>
          ))}
        </div>
      </div>
    </main>
  )
}
