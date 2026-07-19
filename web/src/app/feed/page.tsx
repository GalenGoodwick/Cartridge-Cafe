import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ensureCommunityTables } from '@/lib/notify'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Your feed' }

type Item = { slug: string; name: string; owner: string; at: Date; kind: 'published' | 'edited' }

/** Worlds from the creators you follow — newly published, and freshly edited.
 *  Derived from PlayerSpace timestamps (no activity table): createdAt ≈ updatedAt
 *  means a fresh publish, a later updatedAt means an edit. */
async function loadFeed(): Promise<{ signedIn: boolean; items: Item[] }> {
  const session = await getServerSession(authOptions).catch(() => null)
  const email = session?.user?.email
  if (!email) return { signedIn: false, items: [] }
  try {
    const me = await prisma.user.findUnique({ where: { email }, select: { id: true } })
    if (!me) return { signedIn: true, items: [] }
    // the cafe's ONE follow store: CafeFollow (raw SQL, shared with the profile)
    await ensureCommunityTables()
    const follows = await prisma.$queryRaw<Array<{ followeeId: string }>>`
      SELECT "followeeId" FROM "CafeFollow" WHERE "followerId" = ${me.id}`
    const targetIds = follows.map(f => f.followeeId)
    if (targetIds.length === 0) return { signedIn: true, items: [] }
    const spaces = await prisma.playerSpace.findMany({
      where: { ownerId: { in: targetIds }, isPublic: true },
      select: { slug: true, name: true, createdAt: true, updatedAt: true, owner: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 60,
    })
    const items: Item[] = spaces.map(s => ({
      slug: s.slug,
      name: s.name,
      owner: s.owner?.name || 'someone',
      at: s.updatedAt,
      kind: s.updatedAt.getTime() - s.createdAt.getTime() < 60_000 ? 'published' : 'edited',
    }))
    return { signedIn: true, items }
  } catch {
    // Follow table not migrated yet → empty feed, never a 500
    return { signedIn: true, items: [] }
  }
}

function ago(d: Date): string {
  const s = Math.max(1, Math.floor((Date.now() - d.getTime()) / 1000))
  if (s < 60) return s + 's ago'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return Math.floor(s / 86400) + 'd ago'
}

export default async function FeedPage() {
  const { signedIn, items } = await loadFeed()
  return (
    <main className="min-h-screen bg-void text-crema/80" style={{ background: 'radial-gradient(120% 90% at 50% 0%, #17100b 0%, #0b0908 60%)' }}>
      <div className="mx-auto max-w-2xl px-6 py-14 font-mono">
        <Link href="/" className="text-[12px] tracking-[0.2em] text-brass hover:text-flame">◂ cartridge.cafe</Link>
        <h1 className="cafe-sign text-4xl text-glow mt-5 mb-1">your feed</h1>
        <div className="text-[13px] text-crema/40 mb-8">new worlds &amp; edits from the makers you follow</div>

        {!signedIn ? (
          <p className="text-[15px] text-crema/70">
            <Link href="/auth/signin" className="text-brass hover:text-flame underline">Sign in</Link> to follow makers and see their new worlds here.
          </p>
        ) : items.length === 0 ? (
          <p className="text-[15px] text-crema/60">
            You&rsquo;re not following anyone yet — open a world you like and hit <span className="text-amber-200">+ FOLLOW</span>. Their new worlds and edits will land here.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map(it => (
              <li key={it.slug + it.at.getTime()}>
                <Link href={`/space/${it.slug}`} className="flex items-baseline gap-3 rounded-lg border border-brass/15 hover:border-brass/40 bg-black/20 px-4 py-3 transition-colors">
                  <span className={`text-[11px] tracking-[0.15em] shrink-0 ${it.kind === 'published' ? 'text-emerald-300/80' : 'text-amber-200/70'}`}>
                    {it.kind === 'published' ? 'NEW' : 'EDIT'}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="text-glow">{it.name}</span>
                    <span className="text-crema/40"> · {it.owner}</span>
                  </span>
                  <span className="text-[12px] text-crema/35 shrink-0">{ago(it.at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
